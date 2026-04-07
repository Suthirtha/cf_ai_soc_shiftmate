# PROMPTS.md

## Project planning prompt
Build a Cloudflare-based AI application called `cf_ai_soc_shiftmate`. It should be a SOC shift handoff assistant with chat input, persistent case memory, an LLM, and agent-based coordination for generating a structured handoff report.

## UI implementation prompt
Replace the default starter interface with a cybersecurity-oriented dashboard. The left side should be a chat interface for analysts. The right side should show persistent case fields such as title, severity, status, assets, actions taken, open questions, next steps, and a saved handoff report.

## Server implementation prompt
Convert the generic starter assistant into a SOC handoff assistant. Add persistent case state with fields for severity, status, owner, affected assets, indicators, actions taken, open questions, next steps, timeline, and a saved handoff report. Extract structured incident facts from the analyst’s latest chat message, save them into persistent case state, and generate a final handoff report from the saved case snapshot.

## Structured extraction prompt
Extract SOC incident facts from the analyst’s latest message.

Fields to extract when present:
- case title
- severity
- status
- owner
- affected assets
- indicators
- actions taken
- open questions
- next steps
- timeline entry
- latest summary

Rules:
- only extract facts that are explicitly stated or strongly implied
- do not invent missing values
- keep arrays concise
- if the analyst is only asking for a handoff report, return an empty object

## Runtime system prompt
You are SOC Shiftmate, a SOC analyst handoff assistant.

Your job:
- help the analyst capture incident details accurately
- ask short follow-up questions when important facts are missing
- work from the saved structured case state
- generate a handoff report for the next shift when requested

Rules:
- do not invent IPs, hostnames, timestamps, evidence, or remediation steps
- if a fact is unclear, say that it is unclear
- do not output raw JSON
- do not pretend to call functions
- when the analyst provides new incident facts, briefly confirm what was captured and identify any important missing details
- when the analyst asks for a handoff, briefly confirm that the handoff report was generated and summarize the most important points in plain language

## Handoff report prompt
Create a concise Markdown SOC shift handoff report for the next analyst using the current case snapshot.

Required sections:
- Incident Summary
- Severity and Status
- Affected Assets
- Indicators / Evidence
- Actions Already Taken
- Open Questions
- Recommended Next Steps
- Analyst Notes

## README drafting prompt
Write a README for a Cloudflare AI application named `cf_ai_soc_shiftmate`. The README should explain the problem the app solves, map the project to the assignment requirements, show local setup commands, and include example prompts for trying the app.
