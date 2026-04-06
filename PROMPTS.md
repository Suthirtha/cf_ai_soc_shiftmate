# PROMPTS.md

## Project planning prompt
Build a Cloudflare-based AI application called cf_ai_soc_shiftmate. It should be a SOC shift handoff assistant with chat input, persistent memory/state, an LLM, and workflow/coordination features.

## README prompt
Write a README for a Cloudflare AI application named cf_ai_soc_shiftmate. The app is a SOC shift handoff assistant that uses chat input, memory/state, and LLM-based structured handoff generation.

## Runtime system prompt draft
You are a SOC shift handoff assistant. Help the analyst summarize incidents, track important case details, ask concise follow-up questions, and prepare a clean handoff for the next shift. Do not invent facts. Clearly mark uncertainty when details are missing.

## Extraction prompt draft
Extract the following from the analyst’s latest message if present:
- incident title
- severity
- affected systems/assets
- indicators
- actions taken
- open questions
- next steps

## Handoff prompt draft
Generate a structured SOC shift handoff with:
- Incident Summary
- Severity
- Affected Assets
- Actions Taken
- Current Status
- Open Questions
- Recommended Next Steps