# Task Memory

## Task Purpose

Define the provider-neutral AI and map-answer contract for QuickMap's open-ended questions. This is a development handoff, not evidence that the new provider is wired into the app.

## Upstream Context

- GitHub Issue #1: original Hormuz story and map chat requirements.
- GitHub Issue #3: open-ended map answers and desktop Codex control.
- Current implementation: `electron/map-codex.ts` starts local Codex app-server and restricts answers to the Hormuz story.

## File Map

- `README.md`: canonical connection, account-boundary, provider, and acceptance design.
- `../../src/shared/map-answer-plan.ts`: executable Zod schema for proposed text and map layers; not yet connected to the UI or model providers.

## Current Decisions

- Two entry points, map chat and desktop Codex, should save one map-answer artifact format.
- The demo may use the independent DeepSeek API. The API key stays in the Electron main process and is never committed.
- The model is not limited to one topic; all map actions and source references are validated before display.

## Open Questions

- Which live-search service and source registry will supply verifiable source IDs?
- Which provider should be the default after both adapters are implemented?
- API pricing and model availability must be checked when enabling a provider.

## Handoff Notes

The schema is a scaffold only. Implement provider adapters, trusted source resolution, persistence, rendering, and end-to-end tests before describing this as a working open-ended map assistant. No API credential was added or read for this handoff.
