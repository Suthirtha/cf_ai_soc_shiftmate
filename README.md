# cf_ai_soc_shiftmate

cf_ai_soc_shiftmate is an AI-powered SOC shift handoff assistant built on Cloudflare. It uses chat for analyst input, Workers AI for LLM responses, persistent state for case memory, and agent-based coordination for structured handoff generation.

## Assignment requirements mapping

- **LLM:** Workers AI
- **Workflow / coordination:** Cloudflare Agents with coordinated report generation
- **User input:** Chat UI
- **Memory or state:** Persistent agent/session state

## Core idea

A SOC analyst can paste alerts, investigation notes, and incident updates into chat. The app remembers the case context across turns and produces a structured handoff summary for the next analyst.

## Planned features

- Chat-based incident intake
- Persistent incident memory across messages
- Severity, assets, actions taken, and next steps tracking
- Handoff summary generation
- Clean UI for current case state

## Running locally

```bash
npm install
npm run dev