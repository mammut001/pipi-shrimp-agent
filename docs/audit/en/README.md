# 10-Round Code Audit — 2026-06-23

> **Audit only — no fixes in the original pass.** This audit focused on bugs, security risks, architecture drift, and test gaps.  
> See the Chinese version: [../README.md](../README.md)  
> The prior full-codebase audit is at [`docs/audits/full-codebase.md`](../../audits/full-codebase.md) (includes items already fixed).

## Remediation (post-audit)

After the audit, a remediation pass addressed the highest-impact P0 findings in TypeScript/React and stabilized CI.

| Metric | Audit day (2026-06-23) | After remediation |
| ------ | ---------------------- | ----------------- |
| Test suites | 194 total — **24 failed**, 170 passed | **195 passed**, 0 failed |
| Tests | 1363 total — **34 failed**, 1 skipped, 1328 passed | **1381 passed**, 1 skipped, 0 failed |
| Duration | ~431s | ~528s |

### P0 items fixed in code

| ID | Module | Summary |
| --- | ------ | ------- |
| R1-01 | Chat | Streaming writes use `streamingSessionId` instead of `currentSessionId` — session switch no longer corrupts messages |
| R1-02 | Chat | `selectSession` cancels in-flight generation via `requestChatGenerationCancel` |
| R1-03 | Chat | Split mode now exposes chat panel / `ChatInput` (no longer browser-only) |
| R1-11 | Chat | `useChatMessageScroll` debounce timer cleared on unmount |
| R4-01 | Store | `listenerGuard` ref-count unmount order corrected — no Tauri listener leak |
| R4-02 | Store | Workflow `stop()` clears `engine.isRunning` — new runs no longer blocked |
| R4-03 | Core | `QueryEngine` tool_batch has timeout — consumers that never resolve no longer hang forever |
| R5-01 | AutoResearch | `chatAdapter` propagates `AbortSignal` to `runHeadlessAgentTurn` |
| R5-03 | AutoResearch | Agent failure stops `loopState` — iterations no longer continue after error |
| R5-05 | AutoResearch | `deleteRun` calls `stopExperimentLoop` for active runs |
| R7-07 | Security | `ChatMessage` markdown blocks `javascript:` links |
| R7-08 | Security | `MarkdownDocumentPreview` sanitizes via DOMPurify |
| R7-01 | Security | TypeScript `pathValidation.ts` uses `isWithinDir` (sibling-prefix escape fixed) |

### P0 / Critical items not yet fixed

| ID | Module | Summary |
| --- | ------ | ------- |
| R2-01 | Rust | Legacy `execute_tool` bypasses registry + `execution_policy` |
| R2-02 | Rust | `execute_single_tool` passes `session_id: None` — approval tokens cannot be consumed |
| R2-03 | Rust | `session_memory` discards `validate_work_dir` errors |
| R2-04 | Rust | SSH local-mode shell injection |
| R3-04 | Browser | Embedded WebView ≠ external CDP Chrome — user view ≠ agent surface |
| R3-05 | Browser | `stopTask` cannot stop native CDP loop |
| R3-06 | Browser | Rust `cdp_execute_script` has no policy gate |
| R6-01 | Workflow | `createRunDirectory` failure still allows run to continue |
| R6-02 | Workflow | `stop()` does not cancel in-flight `invoke` stream |
| R7-11 | Security | Telegram `allowedChats` defined but not enforced in router |

> Remaining Rust (R2-*), Browser (R3-*), Workflow (R6-*), and Telegram (R7-11) items require follow-up passes.

---

## Audit scope

| Round | Module | Report | Findings |
| ----- | ------ | ------ | -------- |
| 1 | Chat / Messaging | [round-01-chat-messaging.md](./round-01-chat-messaging.md) | 25 |
| 2 | Rust / Tauri Backend | [round-02-rust-backend.md](./round-02-rust-backend.md) | 34 |
| 3 | Browser Automation | [round-03-browser-automation.md](./round-03-browser-automation.md) | 27 |
| 4 | Store & Core Services | [round-04-store-services.md](./round-04-store-services.md) | 33 |
| 5 | AutoResearch | [round-05-autoresearch.md](./round-05-autoresearch.md) | 16 |
| 6 | Workflow & Headless | [round-06-workflow-headless.md](./round-06-workflow-headless.md) | 13 |
| 7 | Security | [round-07-security.md](./round-07-security.md) | 18 |
| 8 | i18n & UI | [round-08-i18n-ui.md](./round-08-i18n-ui.md) | 15 |
| 9 | Cross-Cutting Integration | [round-09-integration.md](./round-09-integration.md) | 13 |
| 10 | Test Coverage & Baseline | [round-10-test-coverage.md](./round-10-test-coverage.md) | 16 |

**Total: ~210 findings** (including Test-gap entries)

## Test baseline (audit day)

```
Test Suites: 24 failed, 170 passed, 194 total
Tests:       34 failed, 1 skipped, 1328 passed, 1363 total
Time:        ~431s
```

After remediation: **195 suites passed, 1381 tests passed** (see [00-baseline.md](./00-baseline.md)).  
Test backlog: [test-gaps-backlog.md](./test-gaps-backlog.md).

## Priority overview (P0 / Critical)

| ID | Module | Summary | Status |
| --- | ------ | ------- | ------ |
| R1-01 | Chat | Streaming wrote to `currentSessionId` instead of `streamingSessionId` — wrong session on switch | ✅ Fixed |
| R1-02 | Chat | `selectSession` did not cancel in-flight generation | ✅ Fixed |
| R1-03 | Chat | Split mode had no chat panel / input | ✅ Fixed |
| R2-01 | Rust | Legacy `execute_tool` bypasses registry + execution_policy | ❌ Open |
| R2-02 | Rust | `execute_single_tool` missing sessionId — approval token not consumed | ❌ Open |
| R2-03 | Rust | `session_memory` discards `validate_work_dir` errors | ❌ Open |
| R2-04 | Rust | SSH local-mode shell injection | ❌ Open |
| R3-04 | Browser | Embedded WebView vs external CDP Chrome split | ❌ Open |
| R3-05 | Browser | `stopTask` cannot stop native CDP loop | ❌ Open |
| R3-06 | Browser | Rust `cdp_execute_script` no policy gate | ❌ Open |
| R4-01 | Store | `listenerGuard` ref-count unmount order leaked Tauri listener | ✅ Fixed |
| R4-02 | Store | Workflow `stop()` left `engine.isRunning` true | ✅ Fixed |
| R4-03 | Core | `QueryEngine` tool_batch no timeout | ✅ Fixed |
| R5-01 | AutoResearch | `chatAdapter` did not pass `AbortSignal` to headless turn | ✅ Fixed |
| R5-03 | AutoResearch | Agent failure did not stop `loopState` | ✅ Fixed |
| R5-05 | AutoResearch | Deleting active run did not call `stopExperimentLoop` | ✅ Fixed |
| R6-01 | Workflow | `createRunDirectory` failure still continued run | ❌ Open |
| R6-02 | Workflow | `stop()` did not cancel in-flight invoke stream | ❌ Open |
| R7-07 | Security | `ChatMessage` markdown `javascript:` links not blocked | ✅ Fixed |
| R7-08 | Security | `MarkdownDocumentPreview` had no DOMPurify | ✅ Fixed |
| R7-11 | Security | Telegram `allowedChats` defined but not enforced in router | ❌ Open |

## Top 15 tests to add (priority)

1. Session switch during streaming — `chatActions` + `selectSession`
2. `ChatBrowserWorkspaceShell` split layout and `ChatInput` visibility
3. `useChatMessageScroll` — debounce, unmount cleanup, windowed history
4. `listenerGuard` ref-count concurrent register/unregister order
5. `QueryEngine` tool_batch timeout / no-resolve scenario
6. `StreamingToolExecutor` `requiresConfirmation` bypass path
7. Legacy `execute_tool` vs `execute_tool_batch` policy consistency (Rust)
8. `chatAdapter` AbortSignal propagation to headless turn
9. `loopEngine` stop / delete active run / continue after failure
10. `App.tsx` bootstrap + routing integration
11. `ChatBrowserWorkspaceShell` permission queue + questionnaire session isolation
12. `telegramService` invoke vs Rust `lib.rs` command table parity
13. `telegram/bindings` owner auth + `allowedChats` enforcement
14. `MarkdownDocumentPreview` / `ChatMessage` XSS vectors
15. `pathValidation.ts` sibling-prefix escape (TypeScript side)

## Relation to recent changes

This audit included the newly added **scroll-to-bottom** feature (`useChatMessageScroll` + `ScrollToBottomButton`):

- **R1-11**: debounce timer not cleared on unmount — **fixed**
- **R1-16**: `displayMessages` vs `visibleMessages` — expanding history does not trigger scroll-to-bottom
- **R10-13**: hook has no unit tests (project lacks `@testing-library/react`)

## Documentation conventions

- **Severity**: P0/Critical > High/P1 > Medium/P2 > Low/P3 > Info
- **Test-gap**: findings that specifically flag missing tests; not counted toward bug-fix priority
- Each finding includes a **Suggested test** — can be turned directly into an issue / sprint task