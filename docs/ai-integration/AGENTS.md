# Task Memory

## Task Purpose

Define the provider-neutral AI and map-answer contract for QuickMap's open-ended questions. This is a development handoff, not evidence that the new provider is wired into the app.

## Upstream Context

- GitHub Issue #1: original Hormuz story and map chat requirements.
- GitHub Issue #3: open-ended map answers and desktop Codex control.
- Current implementation: `electron/map-codex.ts` starts local Codex app-server and restricts answers to the Hormuz story.

## File Map

- `README.md`: canonical connection, account-boundary, provider, and acceptance design.
- `../../src/shared/map-answer-plan.ts`: executable Zod schema for text, map layers, and vetted source records. Local CLI and UI now use it; model providers do not yet emit it.
- `../examples/arctic-dalian-answer.json`: canonical Arctic route demonstration document sent from the current Codex conversation through local CLI.

## Current Decisions

- The desktop Codex to map control path now saves a `MapAnswerDocument` and renders linked paragraphs and layers; map chat should reuse that format when broadened.
- The demo may use the independent DeepSeek API. The API key stays in the Electron main process and is never committed.
- The model is not limited to one topic; all map actions and source references are validated before display.

## Open Questions

- Which live-search service and source registry will supply verifiable source IDs?
- Which provider should be the default after both adapters are implemented?
- API pricing and model availability must be checked when enabling a provider.

## Handoff Notes

Local control can render and persist a researched answer. Implement provider adapters and trusted source resolution before describing the in-map chat as a working open-ended map assistant. No API credential was added or read for this handoff.
