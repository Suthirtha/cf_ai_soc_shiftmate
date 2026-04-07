import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Schedule } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  generateObject,
  generateText,
  pruneMessages,
  stepCountIs,
  streamText,
  type ModelMessage
} from "ai";
import { z } from "zod";

export type Severity = "unknown" | "low" | "medium" | "high" | "critical";
export type CaseStatus =
  | "new"
  | "triage"
  | "investigating"
  | "contained"
  | "monitoring"
  | "handoff-ready";

export type ShiftState = {
  version: 1;
  caseTitle: string;
  severity: Severity;
  status: CaseStatus;
  owner: string;
  affectedAssets: string[];
  indicators: string[];
  actionsTaken: string[];
  openQuestions: string[];
  nextSteps: string[];
  timeline: string[];
  latestSummary: string;
  handoffReport: string;
  workflowStatus: "idle" | "updating" | "report-ready";
  lastUpdated: string;
};

const severityEnum = z.enum(["unknown", "low", "medium", "high", "critical"]);
const statusEnum = z.enum([
  "new",
  "triage",
  "investigating",
  "contained",
  "monitoring",
  "handoff-ready"
]);

const extractionSchema = z.object({
  caseTitle: z.string().optional(),
  severity: severityEnum.optional(),
  status: statusEnum.optional(),
  owner: z.string().optional(),
  affectedAssets: z.array(z.string()).optional(),
  indicators: z.array(z.string()).optional(),
  actionsTaken: z.array(z.string()).optional(),
  openQuestions: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  timelineEntry: z.string().optional(),
  latestSummary: z.string().optional()
});

type ExtractedPatch = z.infer<typeof extractionSchema>;

function freshState(): ShiftState {
  return {
    version: 1,
    caseTitle: "",
    severity: "unknown",
    status: "new",
    owner: "",
    affectedAssets: [],
    indicators: [],
    actionsTaken: [],
    openQuestions: [],
    nextSteps: [],
    timeline: [],
    latestSummary: "",
    handoffReport: "",
    workflowStatus: "idle",
    lastUpdated: new Date().toISOString()
  };
}

function uniqueValues(values: string[] = []): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function mergeArrays(current: string[], incoming?: string[]): string[] {
  if (!incoming || incoming.length === 0) return current;
  return uniqueValues([...current, ...incoming]);
}

function inlineDataUrls(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type !== "file" || typeof part.data !== "string") return part;
        const match = part.data.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return part;
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        return { ...part, data: bytes, mediaType: match[1] };
      })
    };
  });
}

function getLatestUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    if (typeof msg.content === "string") {
      const text = msg.content.trim();
      if (text) return text;
      continue;
    }

    const text = msg.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (text) return text;
  }

  return "";
}

function isHandoffRequest(text: string): boolean {
  return /handoff|hand off|handover|shift summary|next analyst|generate report|generate a .*report/i.test(
    text
  );
}

function hasMeaningfulPatch(patch: ExtractedPatch): boolean {
  return Boolean(
    patch.caseTitle?.trim() ||
      patch.severity ||
      patch.status ||
      patch.owner?.trim() ||
      patch.affectedAssets?.length ||
      patch.indicators?.length ||
      patch.actionsTaken?.length ||
      patch.openQuestions?.length ||
      patch.nextSteps?.length ||
      patch.timelineEntry?.trim() ||
      patch.latestSummary?.trim()
  );
}

export class ChatAgent extends AIChatAgent<Env, ShiftState> {
  maxPersistedMessages = 100;

  onStart() {
    this.ensureCaseState();
  }

  private ensureCaseState(): ShiftState {
    const state = this.state as ShiftState | undefined;
    if (state?.version === 1) return state;

    const initial = freshState();
    this.setState(initial);
    return initial;
  }

  private mergeCaseState(
    patch: Partial<ShiftState> & { timelineEntry?: string }
  ): ShiftState {
    const current = this.ensureCaseState();

    const next: ShiftState = {
      ...current,
      caseTitle: patch.caseTitle?.trim() || current.caseTitle,
      severity: patch.severity || current.severity,
      status: patch.status || current.status,
      owner: patch.owner?.trim() || current.owner,
      affectedAssets: mergeArrays(current.affectedAssets, patch.affectedAssets),
      indicators: mergeArrays(current.indicators, patch.indicators),
      actionsTaken: mergeArrays(current.actionsTaken, patch.actionsTaken),
      openQuestions: mergeArrays(current.openQuestions, patch.openQuestions),
      nextSteps: mergeArrays(current.nextSteps, patch.nextSteps),
      timeline: current.timeline,
      latestSummary: patch.latestSummary?.trim() || current.latestSummary,
      handoffReport:
        patch.handoffReport !== undefined
          ? patch.handoffReport
          : current.handoffReport,
      workflowStatus: patch.workflowStatus || current.workflowStatus,
      lastUpdated: new Date().toISOString(),
      version: 1
    };

    if (patch.timelineEntry?.trim()) {
      next.timeline = uniqueValues([...current.timeline, patch.timelineEntry]);
    }

    this.setState(next);
    return next;
  }

  @callable()
  async getCaseState() {
    return this.ensureCaseState();
  }

  @callable()
  async resetCaseState() {
    const reset = freshState();
    this.setState(reset);
    return reset;
  }

  private async extractCasePatch(text: string): Promise<ExtractedPatch> {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const { object } = await generateObject({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        sessionAffinity: this.sessionAffinity
      }),
      schema: extractionSchema,
      system: `Extract SOC incident facts from the user's latest message.

Rules:
- Only extract facts that are explicitly stated or very strongly implied.
- Do not invent missing values.
- Keep arrays concise.
- If the user is only asking for a handoff/report and not providing new facts, return an empty object.`,
      prompt: `User message:\n${text}`
    });

    return object;
  }

  private async buildHandoffReport(snapshot: ShiftState) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const { text } = await generateText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        sessionAffinity: this.sessionAffinity
      }),
      system:
        "You write SOC analyst handoff reports. Be concise, factual, structured, and operational. Never invent data. If a detail is missing, label it as Unknown or Needs confirmation.",
      prompt: `Create a concise Markdown SOC shift handoff report for the next analyst using this case snapshot.

Case snapshot:
${JSON.stringify(snapshot, null, 2)}

Required sections:
- Incident Summary
- Severity and Status
- Affected Assets
- Indicators / Evidence
- Actions Already Taken
- Open Questions
- Recommended Next Steps
- Analyst Notes`,
      maxOutputTokens: 700
    });

    return text.trim();
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    let state = this.ensureCaseState();
    const workersai = createWorkersAI({ binding: this.env.AI });

    const modelMessages = inlineDataUrls(
      await convertToModelMessages(this.messages)
    );

    const latestUserText = getLatestUserText(modelMessages);

    if (latestUserText) {
      if (isHandoffRequest(latestUserText)) {
        const current = this.mergeCaseState({ workflowStatus: "updating" });
        const report = await this.buildHandoffReport(current);

        state = this.mergeCaseState({
          handoffReport: report,
          workflowStatus: "report-ready",
          status:
            current.status === "new" ? "handoff-ready" : current.status
        });
      } else {
        const patch = await this.extractCasePatch(latestUserText);

        if (hasMeaningfulPatch(patch)) {
          state = this.mergeCaseState({
            ...patch,
            workflowStatus: "idle",
            handoffReport: ""
          });
        }
      }
    }

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        sessionAffinity: this.sessionAffinity
      }),
      system: `You are SOC Shiftmate, a SOC analyst handoff assistant.

The current saved SOC case state is:
${JSON.stringify(state, null, 2)}

Rules:
- Speak directly to the analyst in concise operational prose.
- Do not output JSON.
- Do not pretend to call functions.
- Do not wrap responses as tool calls.
- Do not invent IPs, hostnames, timestamps, evidence, or remediation steps.
- If details are missing, say what is missing.

Behavior:
- If the analyst just provided new incident facts, briefly confirm what you captured and mention any important missing details.
- If a handoff report was requested, briefly say that the handoff report was generated and saved, and summarize the most important points in plain English.`,
      messages: pruneMessages({
        messages: modelMessages,
        toolCalls: "before-last-2-messages"
      }),
      stopWhen: stepCountIs(4),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }

  async executeTask(description: string, _task: Schedule<string>) {
    this.broadcast(
      JSON.stringify({
        type: "scheduled-task",
        description,
        timestamp: new Date().toISOString()
      })
    );
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
