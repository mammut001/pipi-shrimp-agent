# Test Gaps Backlog — Actionable Sprint Items

**Test-only** tasks extracted from the 10-round audit, sorted by priority. Can be converted directly into GitHub issues.

Chinese version: [../test-gaps-backlog.md](../test-gaps-backlog.md)

> **Note:** Several P0 backlog items (T-01–T-08) overlap findings that were **fixed in code** during remediation (R1-01/02, R1-03, R4-03, R5-01/05, R7-01/07/08). Regression tests for those fixes remain high priority even though CI is now green.

---

## P0 — Tests required before further code changes

| # | Module | Test description | Related finding | Remediation |
| --- | ------ | ---------------- | --------------- | ----------- |
| T-01 | Chat | `selectSession` during streaming: content does not leak across sessions; generator is cancelled | R1-01, R1-02 | Code fixed; regression test needed |
| T-02 | Shell | `browserDockMode=split`: `ChatInput` visible or explicit UX documented | R1-03 | Code fixed; regression test needed |
| T-03 | Core | `QueryEngine` tool_batch with no resolve → timeout/reject | R4-03 | Code fixed; regression test needed |
| T-04 | AutoResearch | `chatAdapter` AbortSignal propagated to `runHeadlessAgentTurn` | R5-01 | Code fixed; regression test needed |
| T-05 | AutoResearch | `deleteRun` + in-flight loop stops | R5-05 | Code fixed; regression test needed |
| T-06 | Workflow | `createRunDirectory` reject → run does not continue | R6-01 | **Still open** |
| T-07 | Security | `pathValidation.ts` sibling-prefix escape | R7-01 | Code fixed; regression test needed |
| T-08 | Security | `ChatMessage` / `MarkdownDocumentPreview` XSS vectors | R7-07, R7-08 | Code fixed; regression test needed |

---

## P1 — Main-path integration

| # | Module | Test description | Related |
| --- | ------ | ---------------- | ------- |
| T-09 | App | Bootstrap order, lazy routes, init failure UI | R10-01, R9-06 |
| T-10 | Shell | `ChatBrowserWorkspaceShell` permission queue FIFO | R10-02 |
| T-11 | Shell | Questionnaire `activeQuestionnaireSessionId` filtering | R1-15 |
| T-12 | Store | `listenerGuard` out-of-order unmount | R4-01 |
| T-13 | Store | `StreamingToolExecutor` requiresConfirmation path | R4-07 |
| T-14 | Workflow | `engine.stop()` then `getIsRunning()` and restart | R4-02, R6-02 |
| T-15 | Telegram | `telegramService` invoke vs `lib.rs` registry parity | R9-01, R10-05 |
| T-16 | Telegram | `allowedChats` enforced in commandRouter | R7-11 |
| T-17 | Browser | `stopTask` stops CDP loop | R3-05 |
| T-18 | Rust | Legacy `execute_tool` vs batch policy consistency | R2-01 |

---

## P2 — Components & hooks

| # | Module | Test description | Related |
| --- | ------ | ---------------- | ------- |
| T-19 | Hook | `useChatMessageScroll` debounce + unmount | R1-11, R10-13 |
| T-20 | Hook | `useResponsiveLayout` breakpoints | R9-08, R10-12 |
| T-21 | UI | `ScrollToBottomButton` visible when scrolled up | Recent feature |
| T-22 | UI | `TerminalPanel` shell profile + error banner | R8-13 |
| T-23 | UI | `Sidebar` bulk-delete confirmation | R8-12 |
| T-24 | UI | `AgentPanel` i18n key strings | R8-04 |
| T-25 | Error | `ExecutionModeDropdownErrorBoundary` fallback | R10-09 |
| T-26 | Error | `recoverToChatView` permission resolve false | R4-14, R10-11 |

---

## P3 — Tools & infrastructure

| # | Module | Test description |
| --- | ------ | ---------------- |
| T-27 | tools/impl | `BashTool` schema + policy |
| T-28 | tools/impl | `FileReadTool` / `FileWriteTool` path sandbox |
| T-29 | tools/impl | `WebFetchTool` SSRF limits |
| T-30 | streamAdapter | Full listen/invoke mock suite | R4-29 |
| T-31 | artifactDetector | workDir undefined + Windows paths | R7-03, R7-04 |
| T-32 | i18n | Settings button uses `settings.fetchModels` | R8-01 |
| T-33 | CI | Fix 24 failing suites + add regression tests | 00-baseline — **done** |

---

## Test infrastructure recommendations

1. **Add `@testing-library/react`** — project has `jest-environment-jsdom` but lacks RTL, making hook/component tests difficult (R10-13)
2. **Rust:** extend `#[cfg(test)]` in `src-tauri` for `session_memory`, `ssh_bridge`, `commands/tools.rs`
3. **Contract tests:** `tools/check-tauri-commands.mjs` scans TS `invoke('...')` vs `lib.rs` generated table
4. **CI sharding:** AutoResearch integration 380s+ should be a separate job to avoid blocking PRs

---

## Effort estimate

| Tier | Items | Rough person-days |
| ---- | ----- | ----------------- |
| P0 | 8 | 3–5 |
| P1 | 10 | 5–8 |
| P2 | 8 | 4–6 |
| P3 | 7 | 5–10 |
| CI stabilization | 24 suites | 2–4 — **completed** |

*Excludes bug fixes themselves; estimates cover test authoring and CI greening only.*