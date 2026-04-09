## 1. Information architecture and state

- [ ] 1.1 Replace the current `WIP` memory pages with a real memory overview page plus dedicated short-term and long-term settings pages.
- [ ] 1.2 Add a short-term memory store under `packages/stage-ui/src/stores/modules/` with persisted state, defaults, and a computed `configured` flag.
- [ ] 1.3 Add a long-term memory store under `packages/stage-ui/src/stores/modules/` with persisted state, defaults, and a computed `configured` flag.
- [ ] 1.4 Store short-term memory settings under `settings/memory/short-term/*` and long-term memory settings under `settings/memory/long-term/*`.
- [ ] 1.5 Ensure the persisted schema uses a memory-specific namespace without introducing `openclaw.*` naming; if implementation keeps a backend discriminator, it must be fixed to `mem0` for short-term memory and `llm-wiki` for long-term memory in the first release.
- [ ] 1.6 Add explicit validation state to both memory stores, including a status field and the latest validation result kept separate from `configured`.

## 2. Settings UI

- [ ] 2.1 Add memory-specific scenario components for the overview page, short-term settings page, long-term settings page, and validation alerts.
- [ ] 2.2 Implement the short-term memory page for mem0 technology so it can configure `mem0` fields including enablement, mode, user ID, connection fields, embedder settings, vector store settings, and recall/capture behavior, without exposing a backend selector in the first release.
- [ ] 2.3 Implement the long-term memory page for llm-wiki technology so it can configure `llm-wiki` fields including enablement, workspace paths, query mode, and promotion or review policy fields, without exposing a backend selector in the first release.
- [ ] 2.4 Implement the memory overview page so it summarizes short-term and long-term memory status and routes users into each detailed page.
- [ ] 2.5 Surface validation state or last validation result in the memory detail pages so `configured` is not mistaken for `validated`.

## 3. Module integration and copy

- [ ] 3.1 Update `packages/stage-ui/src/composables/use-modules-list.ts` so memory module `configured` states come from the new memory stores instead of hardcoded `false`.
- [ ] 3.2 Add i18n strings for short-term memory backend settings, long-term memory backend settings, validation states, and overview copy.
- [ ] 3.3 Ensure all naming in the UI refers to memory backends rather than OpenClaw-owned settings.
- [ ] 3.4 Update `packages/stage-ui/src/composables/use-data-maintenance.ts` so reset-module flows also reset the new memory stores.

## 4. Validation and rollout boundary

- [ ] 4.1 Define a minimal health-check or validation contract for short-term memory that distinguishes configured state from validated state.
- [ ] 4.2 Define a minimal health-check or validation contract for long-term memory that distinguishes configured state from validated state.
- [ ] 4.3 Keep first-release scope limited to settings persistence, configured status, basic health checks, and UI flows without blocking on full runtime recall, capture, query, or promotion automation.
- [ ] 4.4 Document the future runtime integration boundary so OpenClaw or other orchestrators can consume these settings without taking ownership of the schema.
