import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { ChatAgent, ShiftState } from "./server";
import {
  ArrowClockwiseIcon,
  BroomIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  PaperPlaneRightIcon,
  ShieldCheckIcon,
  ClipboardTextIcon,
  PulseIcon
} from "@phosphor-icons/react";

const EMPTY_STATE: ShiftState = {
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
  lastUpdated: ""
};

const SUGGESTED_PROMPTS = [
  "New alert: multiple failed VPN logins followed by one successful login from a new ASN. Affected asset is vpn-gw-02.",
  "Severity should be medium for now. Actions taken: disabled the account and opened an investigation ticket.",
  "Open questions: confirm whether MFA was bypassed and whether any admin actions occurred after the login.",
  "Generate a shift handoff report for the next analyst."
];

function isShiftState(value: unknown): value is ShiftState {
  if (!value || typeof value !== "object") return false;
  const v = value as ShiftState;
  return (
    v.version === 1 &&
    typeof v.caseTitle === "string" &&
    Array.isArray(v.affectedAssets) &&
    Array.isArray(v.indicators) &&
    Array.isArray(v.actionsTaken) &&
    Array.isArray(v.openQuestions) &&
    Array.isArray(v.nextSteps) &&
    Array.isArray(v.timeline)
  );
}

function Section({
  title,
  children,
  action
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
      {label}
    </span>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("\n\n")
    .trim();

  if (!text) return null;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
          isUser
            ? "bg-slate-900 text-white"
            : "border border-slate-200 bg-white text-slate-900"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-6">{text}</div>
        ) : (
          <div className="prose prose-sm max-w-none prose-slate">
            <Streamdown parseIncompleteMarkdown plugins={[code]}>
              {text}
            </Streamdown>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [caseState, setCaseState] = useState<ShiftState>(EMPTY_STATE);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent<ChatAgent>({
    agent: "ChatAgent",
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), [])
  });

  const refreshCaseState = useCallback(async () => {
    try {
      const next = await agent.stub.getCaseState();
      setCaseState(next);
    } catch (error) {
      console.error("Failed to load case state", error);
    }
  }, [agent]);

  const { messages, sendMessage, clearHistory, status, stop } = useAgentChat({
    agent
  });

  const isBusy = status === "streaming" || status === "submitted";

  useEffect(() => {
    void refreshCaseState();
  }, [refreshCaseState]);

  useEffect(() => {
    let latestState: ShiftState | null = null;

    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== "output-available") continue;

        const toolName = getToolName(part);
        const output = part.output as unknown;

        if (toolName === "getCaseState" && isShiftState(output)) {
          latestState = output;
        }

        if (
          (toolName === "updateCaseState" ||
            toolName === "generateHandoffReport") &&
          output &&
          typeof output === "object" &&
          "state" in output &&
          isShiftState((output as { state?: unknown }).state)
        ) {
          latestState = (output as { state: ShiftState }).state;
        }
      }
    }

    if (latestState) {
      setCaseState(latestState);
    }
  }, [messages]);

  useEffect(() => {
    if (!isBusy) {
      void refreshCaseState();
      textareaRef.current?.focus();
    }
  }, [isBusy, refreshCaseState]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const severityTone = useMemo(() => {
    switch (caseState.severity) {
      case "critical":
        return "bg-red-100 text-red-700 border-red-200";
      case "high":
        return "bg-amber-100 text-amber-700 border-amber-200";
      case "medium":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "low":
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  }, [caseState.severity]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isBusy) return;
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isBusy, sendMessage]);

  const handleReset = useCallback(async () => {
    await agent.stub.resetCaseState();
    clearHistory();
    setInput("");
    await refreshCaseState();
  }, [agent, clearHistory, refreshCaseState]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                <ShieldCheckIcon size={18} className="text-sky-600" />
                AI-powered SOC shift handoff assistant
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                SOC Shiftmate
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Capture incident details in chat, keep case memory updated, and
                generate a structured handoff for the next analyst.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border px-3 py-1.5 text-slate-700">
                Connection: {connected ? "Live" : "Connecting"}
              </span>
              <span className="rounded-full border px-3 py-1.5 text-slate-700">
                Workflow: {caseState.workflowStatus}
              </span>
              <button
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => void refreshCaseState()}
                type="button"
              >
                <ArrowClockwiseIcon size={16} /> Refresh state
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => void handleReset()}
                type="button"
              >
                <BroomIcon size={16} /> New case
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
          <div className="flex min-h-[75vh] flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Analyst chat
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Use natural language to update the case and ask for a handoff.
                  </p>
                </div>
                <button
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => clearHistory()}
                  type="button"
                >
                  Clear chat
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 lg:px-5">
              {messages.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                    <PulseIcon size={18} className="text-sky-600" />
                    Try one of these prompts
                  </div>
                  <div className="flex flex-col gap-2">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                        onClick={() =>
                          sendMessage({
                            role: "user",
                            parts: [{ type: "text", text: prompt }]
                          })
                        }
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-slate-200 px-4 py-4 lg:px-5">
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() =>
                    sendMessage({
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          text: "Generate a concise shift handoff report for the next analyst using the current saved case details."
                        }
                      ]
                    })
                  }
                >
                  Generate handoff
                </button>
                <button
                  type="button"
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() =>
                    sendMessage({
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          text: "What key details are still missing for a clean SOC handoff?"
                        }
                      ]
                    })
                  }
                >
                  Missing details
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <textarea
                  ref={textareaRef}
                  className="min-h-[96px] w-full resize-none bg-transparent text-sm leading-6 outline-none"
                  placeholder="Paste incident notes, alerts, or analyst updates here..."
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    Press Enter to send. Shift + Enter for a new line.
                  </p>
                  <div className="flex items-center gap-2">
                    {isBusy && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => stop()}
                      >
                        <CircleNotchIcon size={16} className="animate-spin" /> Stop
                      </button>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={handleSend}
                      disabled={isBusy || !input.trim()}
                    >
                      <PaperPlaneRightIcon size={16} /> Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <Section
              title="Current case"
              action={
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${severityTone}`}
                >
                  {caseState.severity}
                </span>
              }
            >
              <div className="space-y-4 text-sm text-slate-700">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Case title
                  </div>
                  <div className="mt-1 font-medium text-slate-900">
                    {caseState.caseTitle || "Untitled incident"}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Status
                    </div>
                    <div className="mt-1 capitalize">{caseState.status}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Owner
                    </div>
                    <div className="mt-1">{caseState.owner || "Unassigned"}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Last summary
                  </div>
                  <p className="mt-1 leading-6 text-slate-700">
                    {caseState.latestSummary || "No case summary saved yet."}
                  </p>
                </div>
              </div>
            </Section>

            <Section title="Affected assets">
              <div className="flex flex-wrap gap-2">
                {caseState.affectedAssets.length > 0 ? (
                  caseState.affectedAssets.map((value) => (
                    <Pill key={value} label={value} />
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No assets captured yet.</p>
                )}
              </div>
            </Section>

            <Section title="Indicators / evidence">
              <div className="space-y-2">
                {caseState.indicators.length > 0 ? (
                  caseState.indicators.map((value) => (
                    <div
                      key={value}
                      className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    >
                      {value}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No indicators saved yet.</p>
                )}
              </div>
            </Section>

            <Section title="Actions taken">
              <div className="space-y-2">
                {caseState.actionsTaken.length > 0 ? (
                  caseState.actionsTaken.map((value) => (
                    <div
                      key={value}
                      className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    >
                      <CheckCircleIcon
                        size={16}
                        className="mt-0.5 text-emerald-600"
                      />
                      <span>{value}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No actions saved yet.</p>
                )}
              </div>
            </Section>

            <Section title="Open questions and next steps">
              <div className="space-y-4 text-sm">
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                    Open questions
                  </div>
                  <div className="space-y-2">
                    {caseState.openQuestions.length > 0 ? (
                      caseState.openQuestions.map((value) => (
                        <div
                          key={value}
                          className="rounded-xl bg-slate-50 px-3 py-2 text-slate-700"
                        >
                          {value}
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-500">No open questions saved.</p>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                    Next steps
                  </div>
                  <div className="space-y-2">
                    {caseState.nextSteps.length > 0 ? (
                      caseState.nextSteps.map((value) => (
                        <div
                          key={value}
                          className="rounded-xl bg-slate-50 px-3 py-2 text-slate-700"
                        >
                          {value}
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-500">No next steps saved.</p>
                    )}
                  </div>
                </div>
              </div>
            </Section>

            <Section
              title="Saved handoff report"
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  onClick={() =>
                    sendMessage({
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          text: "Generate a concise shift handoff report for the next analyst using the current saved case details."
                        }
                      ]
                    })
                  }
                >
                  <ClipboardTextIcon size={14} /> Refresh report
                </button>
              }
            >
              {caseState.handoffReport ? (
                <div className="prose prose-sm max-w-none prose-slate">
                  <Streamdown plugins={[code]}>{caseState.handoffReport}</Streamdown>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No handoff report saved yet. Use the Generate handoff action after
                  you capture the incident details.
                </p>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}