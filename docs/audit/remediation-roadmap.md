# Remediation Roadmap — 10-Round Audit (2026-06-23)

Actionable backlog derived from the [10-round audit](./README.md). **No code fixes in this document** — use it to schedule one focused PR per anchor.

**Machine-readable backlog:** [remediation-backlog.json](./remediation-backlog.json)  
**Governance rules:** [complexity-governance.md](../architecture/complexity-governance.md)  
**Test-only tasks:** [test-gaps-backlog.md](./test-gaps-backlog.md)  
**Checkpoint report:** [p0-critical-checkpoint.md](./p0-critical-checkpoint.md) (2026-06-24)

---

## P0 / Critical checkpoint (2026-06-24)

**Status: Critical closure complete.** All thirteen focused remediation PRs are merged locally and marked `fixed` in [remediation-backlog.json](./remediation-backlog.json).

### Fixed in this wave

| Lane | IDs |
| ---- | --- |
| Rust / Tauri | R2-01, R2-02, R2-03, R2-04 |
| Browser automation | R3-01, R3-02, R3-03, R3-04, R3-05, R3-06 |
| Workflow / Headless | R6-01, R6-02 |
| Security / Telegram | R7-11 |

Earlier post-audit fixes (still need regression tests): R1-01–03, R4-01–03, R5-01/03/05, R7-01/07/08.

### Remains open

| Category | Examples |
| -------- | -------- |
| **High — browser** | R3-07 overlay cleanup, R3-08 closeWindow+stopTask, R3-09 selector, R3-10 press_enter |
| **High — security** | R7-04 artifact sandbox, R7-06 outputDir, R7-12 Telegram Rust parity |
| **High — AutoResearch** | R5-02 preflight abort controller leak |
| **Test infra** | INFRA-01 `@testing-library/react`, TOP-15 regression suites |
| **Architecture** | AG-02 `loopEngine.ts`, AG-05 `browserAgentStore.ts`, AG-10 `web.rs` splits |
| **Rust High (round-02)** | R2-05–R2-12 — not yet in backlog JSON |

**Open P0/Critical in backlog:** 0.

### Recommended next phase

Shift from safety closure to **High reliability + test guardrails + governance splits**. See [Next 10 PRs after Critical Closure](./p0-critical-checkpoint.md#next-10-prs-after-critical-closure) in the checkpoint report.

---

## Recommended Next 10 PRs (Critical wave — complete)

Small, focused PRs ordered by safety impact and dependency chain. Each targets **one audit anchor** where possible; prefer **<20 files** and **<800 net LOC**.

| # | PR title | Audit IDs | Files likely touched | Tests to run | Risk | Why before next |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ~~**fix(rust): escape SSH local-mode commands (shell injection)**~~ ✅ **Done 2026-06-24** | R2-04 | `src-tauri/src/tools/ssh_bridge.rs` | `cargo test ssh_bridge::tests` | **High** (security) | Local mode uses process cwd instead of `cd … &&` shell prefix |
| 2 | ~~**fix(rust): reject or route legacy `execute_tool` through registry**~~ ✅ **Done 2026-06-24** | R2-01 | `legacy_execute_tool.rs`, `chat.rs`, `registry.rs`, TS callers | `cargo test legacy_execute_tool`, `pnpm test toolExecutionPolicy` | **High** | Registry tools disabled on legacy path; production uses `execute_single_tool` |
| 3 | ~~**fix(security): enforce Telegram `allowedChats` in commandRouter**~~ ✅ **Done 2026-06-24** | R7-11 | `commandRouter.ts`, `chatAuthorization.ts`, `connectorConfig.ts` | `pnpm test src/services/telegram`, T-16 | **High** | Central guard rejects unauthorized chats before dispatch; owner + allowlist semantics tested |
| 4 | ~~**fix(rust): pass session_id in `execute_single_tool` for approval tokens**~~ ✅ **Done 2026-06-24** | R2-02 | `tools.rs`, `chatToolExecution.ts`, `autoresearchBootstrap/index.ts` | `cargo test tools::tests`, `pnpm test chatToolExecution` | **Medium** | sessionId flows invoke → policy → approval token consumption |
| 5 | ~~**fix(rust): propagate `validate_work_dir` errors in session_memory**~~ ✅ **Done 2026-06-24** | R2-03 | `src-tauri/src/commands/session_memory.rs` | `cargo test session_memory::tests` | **Medium** | Invalid explicit work_dir fails closed; PiPi Output Folder fallback preserved when work_dir omitted |
| 6 | ~~**fix(workflow): abort run when `createRunDirectory` fails**~~ ✅ **Done 2026-06-24** | R6-01 | `src/services/workflowEngine/engine.ts` | `pnpm test src/services/workflowEngine`, T-06 | **Medium** | Fail-fast on run directory creation; no agent steps or artifact writes after disk init failure |
| 7 | ~~**fix(browser): wire `stopTask` to cancel native CDP loop**~~ ✅ **Done 2026-06-24** | R3-05 | `src/store/browserAgentStore.ts`, `nativeBrowserAgent.ts` | `pnpm test src/store/browser`, T-17 | **Medium** | Per-run AbortController stops CDP loop; late LLM/CDP results ignored |
| 8 | ~~**fix(rust): add policy gate to `cdp_execute_script`**~~ ✅ **Done 2026-06-24** | R3-06 | `web.rs`, `execution_policy.rs`, `browserActionClient.ts` | `cargo test execution_policy`, `browserActionClient.test.ts` | **High** | Rust command deny-by-default; arbitrary JS requires approval token |
| 9 | ~~**fix(browser): pass `approveAction` from `executeCdpTask`**~~ ✅ **Done 2026-06-24** | R3-01 | `browserAgentStore.ts`, `browserActionApproval.ts`, `BrowserActionApprovalPrompt.tsx` | `browserActionApproval.test.ts`, `browserTaskStop.test.ts` | **High** | Sensitive CDP actions prompt Allow/Deny; stop cancels pending approval |
| 10 | ~~**fix(workflow): cancel in-flight headless invoke on `stop()`**~~ ✅ **Done 2026-06-24** | R6-02 | `src/services/workflowEngine/engine.ts`, `agentRunner.ts` | `pnpm test src/services/workflowEngine`, T-14 | **Medium** | Per-run AbortController aborts streaming invoke via stop_subprocess; late results ignored |
| 11 | ~~**fix(browser): observe_only permission mode in CDP agent**~~ ✅ **Done 2026-06-24** | R3-02 | `browserAgentStore.ts`, `browserFeatureFlags.ts`, `browserActionPolicy.ts` | `browserObserveOnly.test.ts` | **High** | `resolveBrowserActionPermissionMode()` blocks mutating actions in observe_only |
| 12 | ~~**fix(browser): auth_required start gate before CDP**~~ ✅ **Done 2026-06-24** | R3-03 | `browserAgentStore.ts`, `browserAgentStartGate.ts` | `browserAuthRequired.test.ts` | **High** | `evaluateBrowserAgentStartGate` blocks agent on login pages |
| 13 | ~~**fix(browser): preview/CDP surface URL match gate**~~ ✅ **Done 2026-06-24** | R3-04 | `browserAgentStore.ts`, `browserAgentStartGate.ts` | `browserSurfaceMatch.test.ts`, `browserSurfaceMismatch.test.ts` | **High** | Fail-closed when embedded preview URL ≠ live CDP URL |

**Next wave (post-checkpoint):** see [p0-critical-checkpoint.md § Next 10 PRs](./p0-critical-checkpoint.md#next-10-prs-after-critical-closure).

---

## Status legend

| Status | Meaning |
| ------ | ------- |
| `fixed` | Remediated in post-audit pass; needs regression tests |
| `partially fixed` | Core path fixed; edge cases or tests remain |
| `open` | Not yet remediated |
| `needs verification` | Fix claimed; behavior should be re-validated |
| `test gap only` | Production path OK or fixed; missing automated coverage |

---

## Fixed / Verify Regression Tests

Items remediated per [README remediation section](./README.md#修复进展remediation). **Keep in backlog** until regression tests and guardrails exist.

### R1-01 — Streaming writes target wrong session on switch

| Field | Value |
| ----- | ----- |
| **Lane** | A. P0 / Safety / Data Loss |
| **Severity** | P0 |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | Streaming deltas could corrupt another session's message history — silent data loss |
| **Affected files** | `src/store/chat/chatActions.ts` |
| **Smallest PR scope** | Add `sessionIsolation` regression tests only (no behavior change) |
| **Suggested tests** | T-01: stream in session A, switch to B; B unchanged, A receives deltas |
| **Dependencies** | None |
| **Runtime behavior** | Yes (was) |
| **UI behavior** | No |
| **Split PRs?** | No — tests can be one PR |

### R1-02 — `selectSession` did not cancel in-flight generation

| Field | Value |
| ----- | ----- |
| **Lane** | A. P0 / Safety / Data Loss |
| **Severity** | P0 |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | Background `for await` continued after switch — wasted tokens, wrong-session side effects |
| **Affected files** | `src/store/createChatStore.ts`, `src/store/chat/chatActions.ts` |
| **Smallest PR scope** | Test `requestChatGenerationCancel` on `selectSession` |
| **Suggested tests** | T-01 (shared with R1-01) |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R1-03 — Split browser mode had no chat panel / input

| Field | Value |
| ----- | ----- |
| **Lane** | B. Chat Reliability |
| **Severity** | P1 (treated as P0 UX) |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | Users in split mode could not send messages at all |
| **Affected files** | `src/components/ChatBrowserWorkspaceShell.tsx` |
| **Smallest PR scope** | RTL or shell render test asserting `ChatInput` in split mode |
| **Suggested tests** | T-02 |
| **Dependencies** | May need `@testing-library/react` (R10-13) |
| **Runtime behavior** | No |
| **UI behavior** | Yes |
| **Split PRs?** | Yes — devDep PR separate from shell test PR |

### R1-11 — Scroll debounce timer leak on unmount

| Field | Value |
| ----- | ----- |
| **Lane** | B. Chat Reliability |
| **Severity** | P2 |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | setState-after-unmount warnings and memory leak |
| **Affected files** | `src/hooks/useChatMessageScroll.ts` |
| **Smallest PR scope** | Pure timer mock test |
| **Suggested tests** | T-19 |
| **Dependencies** | R10-13 (RTL optional) |
| **Runtime behavior** | No |
| **UI behavior** | Yes |
| **Split PRs?** | No |

### R4-01 — `listenerGuard` ref-count unmount order leaked Tauri listeners

| Field | Value |
| ----- | ----- |
| **Lane** | A. P0 / Safety / Data Loss |
| **Severity** | Critical |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | Duplicate event handlers → duplicate tool runs, memory growth |
| **Affected files** | `src/utils/listenerGuard.ts` |
| **Smallest PR scope** | Concurrent register/unregister order test |
| **Suggested tests** | T-12 |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R4-02 — Workflow `stop()` left `engine.isRunning` true

| Field | Value |
| ----- | ----- |
| **Lane** | F. Workflow / Headless |
| **Severity** | Critical |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | Blocked all subsequent workflow runs until app restart |
| **Affected files** | `src/services/workflowEngine/engine.ts` |
| **Smallest PR scope** | `stop()` → `getIsRunning() === false` test |
| **Suggested tests** | T-14 |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R4-03 — `QueryEngine` tool_batch hung forever without timeout

| Field | Value |
| ----- | ----- |
| **Lane** | A. P0 / Safety / Data Loss |
| **Severity** | Critical |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | UI freeze on stuck tool consumer — apparent hang with no recovery |
| **Affected files** | `src/core/QueryEngine.ts` |
| **Smallest PR scope** | Mock consumer that never resolves; assert timeout/reject |
| **Suggested tests** | T-03, Top-15 #5 |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R5-01 — `chatAdapter` did not pass `AbortSignal` to headless turn

| Field | Value |
| ----- | ----- |
| **Lane** | C. AutoResearch Runtime |
| **Severity** | P0 |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | Stop button could not interrupt in-flight AutoResearch agent turn |
| **Affected files** | `src/services/autoresearch/chatAdapter.ts` |
| **Smallest PR scope** | Abort mid-turn integration test |
| **Suggested tests** | T-04, Top-15 #8 |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R5-03 — Agent failure did not stop `loopState`

| Field | Value |
| ----- | ----- |
| **Lane** | C. AutoResearch Runtime |
| **Severity** | P0 |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | Iterations continued after agent error — runaway cost and corrupt state |
| **Affected files** | `src/services/autoresearch/loopEngine.ts` |
| **Smallest PR scope** | Throw path → no second `sendMessage` |
| **Suggested tests** | T-05, Top-15 #9 |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R5-05 — `deleteRun` did not call `stopExperimentLoop`

| Field | Value |
| ----- | ----- |
| **Lane** | C. AutoResearch Runtime |
| **Severity** | P0 |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | Deleting active run left SSH/LLM processes running |
| **Affected files** | `src/store/autoresearchStore.ts` |
| **Smallest PR scope** | Delete active run → loop stopped |
| **Suggested tests** | T-05 |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R7-01 — TypeScript `pathValidation.ts` sibling-prefix escape

| Field | Value |
| ----- | ----- |
| **Lane** | G. Security Hardening |
| **Severity** | High |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | `/project-evil` could pass as inside `/project` — path sandbox bypass |
| **Affected files** | `src/utils/pathValidation.ts` |
| **Smallest PR scope** | Table-driven sibling-prefix cases |
| **Suggested tests** | T-07, Top-15 #15 |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R7-07 — `ChatMessage` markdown allowed `javascript:` links

| Field | Value |
| ----- | ----- |
| **Lane** | G. Security Hardening |
| **Severity** | High |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | XSS via malicious assistant markdown in chat |
| **Affected files** | `src/components/ChatMessage.tsx` |
| **Smallest PR scope** | Render malicious link fixture; assert blocked |
| **Suggested tests** | T-08, Top-15 #14 |
| **Dependencies** | None |
| **Runtime behavior** | No |
| **UI behavior** | Yes |
| **Split PRs?** | No |

### R7-08 — `MarkdownDocumentPreview` had no DOMPurify

| Field | Value |
| ----- | ----- |
| **Lane** | G. Security Hardening |
| **Severity** | High |
| **Status** | `fixed` — needs regression tests |
| **Why it matters** | `<img onerror>` and similar vectors in doc preview |
| **Affected files** | `src/components/document/MarkdownDocumentPreview.tsx` |
| **Smallest PR scope** | XSS vector render test |
| **Suggested tests** | T-08, Top-15 #14 |
| **Dependencies** | None |
| **Runtime behavior** | No |
| **UI behavior** | Yes |
| **Split PRs?** | No |

### R2-04 — SSH local-mode shell injection (local `cd` prefix removed)

| Field | Value |
| ----- | ----- |
| **Lane** | A. P0 / Safety / Data Loss |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) — verify `cargo test ssh_bridge::tests` on Linux CI |
| **Why it matters** | Untrusted `remote_work_dir` in `cd … &&` allowed shell metacharacter injection |
| **Affected files** | `src-tauri/src/tools/ssh_bridge.rs` |
| **Smallest PR scope** | Local mode: process cwd + quoted path args only |
| **Suggested tests** | `cargo test ssh_bridge::tests` (16 unit tests) |
| **Dependencies** | None |
| **Runtime behavior** | Yes (hardening) |
| **UI behavior** | No |
| **Split PRs?** | No |

### R2-01 — Legacy `execute_tool` bypasses registry and execution_policy

| Field | Value |
| ----- | ----- |
| **Lane** | A. P0 / Safety / Data Loss |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) — verify `cargo test legacy_execute_tool` on Linux CI |
| **Why it matters** | Registry-backed tools could run without schema validation or `execution_policy` |
| **Affected files** | `legacy_execute_tool.rs`, `chat.rs`, `registry.rs`, `chatToolExecution.ts`, `autoresearchBootstrap/index.ts` |
| **Smallest PR scope** | Reject registry tools on legacy command; migrate callers to `execute_single_tool` |
| **Suggested tests** | `cargo test legacy_execute_tool`, `registry::tests`, `toolExecutionPolicy.test.ts` |
| **Dependencies** | None |
| **Runtime behavior** | Yes (hardening) |
| **UI behavior** | No |
| **Split PRs?** | No |
| **Compatibility** | Direct `invoke('execute_tool')` for `write_file` / `execute_command` / etc. now errors; browser/Typst/Skill still use legacy path with policy enforcement |

---

## A. P0 / Safety / Data Loss (fixed 2026-06-24 — regression tests still open)

### R2-02 — `execute_single_tool` missing sessionId

| Field | Value |
| ----- | ----- |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Approval tokens cannot be consumed after preview |
| **Affected files** | `tools.rs`, `chatToolExecution.ts`, `autoresearchBootstrap/index.ts` |
| **Smallest PR scope** | Pass `sessionId` invoke arg into `execute_with_context` |
| **Suggested tests** | `cargo test tools::tests`, `chatToolExecution.test.ts` |
| **Dependencies** | R2-01 |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R2-03 — `session_memory` discards `validate_work_dir` errors

| Field | Value |
| ----- | ----- |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Memory files can be written with invalid/out-of-sandbox work_dir |
| **Affected files** | `src-tauri/src/commands/session_memory.rs` |
| **Smallest PR scope** | `validated_session_memory_dir` propagates `validate_work_dir` with `?` |
| **Suggested tests** | `cargo test session_memory::tests`, invalid `/etc` or `C:\Windows` work_dir |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R3-04 — Embedded WebView ≠ external CDP Chrome

| Field | Value |
| ----- | ----- |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Preview/inspection URL could differ from CDP-controlled Chrome tab |
| **Affected files** | `browserAgentStore.ts`, `browserAgentStartGate.ts` |
| **Smallest PR scope** | Compare preview URL vs `getCurrentBrowserUrl()` before CDP start |
| **Suggested tests** | `browserSurfaceMatch.test.ts`, `browserSurfaceMismatch.test.ts` |
| **Dependencies** | R3-03 auth gate ordering |
| **Runtime behavior** | Yes |
| **UI behavior** | Yes |
| **Split PRs?** | No |

### R3-03 — CDP mode skips auth_required checks

| Field | Value |
| ----- | ----- |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | CDP `executeTask` skipped auth gate; agent started on login pages |
| **Affected files** | `browserAgentStore.ts`, `browserAgentStartGate.ts` |
| **Smallest PR scope** | `evaluateBrowserAgentStartGate` before `executeCdpTask` |
| **Suggested tests** | `browserAuthRequired.test.ts`, `browserAgentStartGate.test.ts` |
| **Dependencies** | None |
| **Runtime behavior** | Yes |
| **UI behavior** | Yes |
| **Split PRs?** | No |

### R3-02 — `observe_only` flag not passed into browser agent

| Field | Value |
| ----- | ----- |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | `PIPI_BROWSER_ACTION_PERMISSION_MODE=observe_only` had no effect on CDP agent |
| **Affected files** | `browserAgentStore.ts`, `browserFeatureFlags.ts`, `browserActionPolicy.ts` |
| **Smallest PR scope** | Pass `permissionMode` from localStorage into `executeCdpTask` |
| **Suggested tests** | `browserObserveOnly.test.ts`, `nativeBrowserAgent.test.ts`, `browserActionPolicy.test.ts` |
| **Dependencies** | R3-01 approval callback |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R3-01 — `executeCdpTask` missing `approveAction`

| Field | Value |
| ----- | ----- |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Sensitive browser actions denied by default with no approval UI |
| **Affected files** | `browserAgentStore.ts`, `browserActionApproval.ts`, `BrowserActionApprovalPrompt.tsx` |
| **Smallest PR scope** | Pass `approveAction` + minimal Allow/Deny prompt |
| **Suggested tests** | `browserActionApproval.test.ts`, `browserTaskStop.test.ts` |
| **Dependencies** | R3-05 stop/cancel semantics |
| **Runtime behavior** | Yes |
| **UI behavior** | Yes |
| **Split PRs?** | No |

### R3-05 — `stopTask` cannot stop native CDP loop

| Field | Value |
| ----- | ----- |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Stop button ineffective; runaway LLM/CDP after user abort |
| **Affected files** | `browserAgentStore.ts`, `nativeBrowserAgent.ts`, `browserTaskStop.test.ts`, `nativeBrowserAgent.test.ts` |
| **Smallest PR scope** | Wire abort signal through CDP task loop |
| **Suggested tests** | T-17, `browserTaskStop.test.ts`, `nativeBrowserAgent.test.ts` |
| **Dependencies** | None — **PR #7** |
| **Runtime behavior** | Yes |
| **UI behavior** | Yes |
| **Split PRs?** | No |

### R3-06 — Rust `cdp_execute_script` has no policy gate

| Field | Value |
| ----- | ----- |
| **Severity** | Critical |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Arbitrary JS execution bypasses TS `browserActionPolicy` |
| **Affected files** | `web.rs`, `execution_policy.rs`, `browserActionClient.ts`, `browserPageStateClient.ts` |
| **Smallest PR scope** | Deny-by-default + approval hook |
| **Suggested tests** | `cargo test execution_policy`, `browserActionClient.test.ts` |
| **Dependencies** | R2-01 policy alignment |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R6-01 — `createRunDirectory` failure still continues run

| Field | Value |
| ----- | ----- |
| **Severity** | P0 |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Workflow artifacts silently lost when disk init fails |
| **Affected files** | `src/services/workflowEngine/engine.ts`, `engine.test.ts` |
| **Smallest PR scope** | Early return to error state on reject |
| **Suggested tests** | T-06, `engine.test.ts` createRunDirectory failure cases |
| **Dependencies** | None — **PR #6** |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

### R6-02 — `stop()` does not cancel in-flight invoke stream

| Field | Value |
| ----- | ----- |
| **Severity** | P0 |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Stop waits for full completion; resources not released promptly |
| **Affected files** | `src/services/workflowEngine/engine.ts`, `agentRunner.ts`, `engine.test.ts` |
| **Smallest PR scope** | AbortController through streaming invoke |
| **Suggested tests** | T-14, `engine.test.ts` stop/cancel describe block |
| **Dependencies** | R4-02 (isRunning fix) |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No — **PR #10** |

### R7-11 — Telegram `allowedChats` not enforced in router

| Field | Value |
| ----- | ----- |
| **Severity** | High (P0 security) |
| **Status** | `fixed` (2026-06-24) |
| **Why it matters** | Allowlist is defined in types but never checked — any chat can command bot |
| **Affected files** | `commandRouter.ts`, `chatAuthorization.ts`, `connectorConfig.ts`, `telegramService.ts` |
| **Smallest PR scope** | Central `isTelegramInboundChatAuthorized` guard before dispatch |
| **Suggested tests** | T-16, Top-15 #13, `chatAuthorization.test.ts`, `commandRouter.test.ts` |
| **Dependencies** | None — **PR #3** |
| **Runtime behavior** | Yes |
| **UI behavior** | No |
| **Split PRs?** | No |

---

## B. Chat Reliability (open)

| ID | Title | Sev | Status | Why | Key files | Smallest PR | Tests | Runtime | UI | Split? |
| --- | ----- | --- | ------ | --- | --------- | ----------- | ----- | ------- | -- | ------ |
| R1-04 | `processMessagesForDisplay` hidden-filter drift | P1 | open | Hidden messages may leak in non-shell paths | `src/utils/chat.ts`, shell | Unify filter in `chat.ts` | hidden msg unit test | Yes | Yes | No |
| R1-05 | Duplicate display pipeline in shell vs `chat.ts` | P1 | open | Fix one path, break the other | shell, `chat.ts` | Extract shared `buildDisplayMessages` | Golden fixture | Yes | Yes | Yes |
| R1-06 | `retryLastMessage` retries hidden synthesis | P1 | open | Wrong user message resent | `chatActions.ts` | Skip `metadata.hidden` on retry | hidden+visible fixture | Yes | Yes | No |
| R1-07 | System compact boundary renders as assistant | P1 | open | Confusing UI bubble | `ChatMessage.tsx`, store | Filter compact boundaries | boundary not in DOM | No | Yes | No |
| R1-08 | Overlapping send across sessions | P1 | open | Concurrent turns corrupt state | `chatActions.ts` | Global streaming mutex | overlap send rejected | Yes | Yes | No |
| R1-09 | Diagnostics task leak on early exit | P2 | open | Stale task entries | `chatActions.ts` | finally-block cleanup | invalid config send | Yes | No | No |
| R1-10 | Terminal CWD promise unhandled rejection | P2 | open | Console noise / crash risk | shell, `Chat.tsx` | Add `.catch()` | mock reject | Yes | Yes | No |
| R1-12 | Terminal drag listener leak | P2 | open | Memory leak | shell | useEffect cleanup | unmount during drag | No | Yes | No |
| R1-13 | Input enabled while background turn runs | P2 | open | User can double-send | `ChatInput.tsx` | Tie disable to generation id | post-switch input state | Yes | Yes | No |
| R1-14 | `pages/Chat.tsx` dead code | P2 | open | Maintenance burden, drift | `pages/Chat.tsx` | Delete or archive | import graph check | No | No | Yes — delete separate PR |
| R1-15 | Questionnaire session filter (legacy Chat) | P2 | open | Cross-session questionnaire bleed | `Chat.tsx` | Align with shell filter | cross-session invisible | No | Yes | No |
| R1-16 | Scroll-to-bottom ignores windowed history | P2 | open | UX: expand history doesn't scroll | `useChatMessageScroll.ts` | Depend on `visibleMessages` | showFullHistory case | No | Yes | No |
| R1-17 | `addMessage` silent no-op | P2 | open | Silent failures hide bugs | `chatActions.ts` | Throw or log error | no-session path | Yes | No | No |
| R1-18–R1-25 | Low-priority chat polish | P3 | open | Consistency, a11y, perf | various | Batch by theme | per-item | Mixed | Mixed | Yes |

---

## C. AutoResearch Runtime (open)

| ID | Title | Sev | Status | Why | Key files | Smallest PR | Tests | Runtime | UI | Split? |
| --- | ----- | --- | ------ | --- | --------- | ----------- | ----- | ------- | -- | ------ |
| R5-02 | Preflight abort controller leak | High | open | Orphan AbortController after preflight fail | `loopEngine.ts` | try/finally around preflight | controller null after fail | Yes | No | No |
| R5-04 | Unmount doesn't stop `paused` loop | Med | open | Loop continues after navigate away | `AutoResearch.tsx` | Stop on any non-idle state | pause+unmount | Yes | Yes | No |
| R5-06 | SSH upload no transaction | Med | open | Partial upload corrupts remote state | `BootstrapChatView.tsx` | Rollback on Nth failure | partial upload | Yes | Yes | No |
| R5-07 | Handoff no lifecycle lock | Med | open | Two active runs possible | `BootstrapChatView.tsx` | Block handoff if running | active run blocks | Yes | Yes | No |
| R5-08 | `guessMetricDirection` vs plan | Med | open | Wrong metric optimization direction | `BootstrapChatView.tsx` | Use plan direction | direction matches plan | Yes | No | No |
| R5-09 | Pause 1s timeout not abortable | Low | open | Slow stop response | `loopEngine.ts` | AbortSignal on pause wait | stop <200ms | Yes | No | No |
| R5-10 | Copy leaks raw live output | Med | open | API keys in clipboard | `AutoResearchPanel.tsx` | Use redacted output | clipboard scan | No | Yes | No |
| R5-11 | Recovery button opens modal only | Med | open | Broken recovery UX | `AutoResearchPanel.tsx` | Wire handler | retry_iteration fires | Yes | Yes | No |
| R5-12 | `failureCount` inconsistency | Low | open | Wrong backoff / stop logic | `autoresearchStore.ts` | Unify counters | consecutive count | Yes | No | No |
| R5-13 | Close flush on failed persist | Low | open | Lost metrics on close | `autoresearchStore.ts` | Flush regardless of timer | close after fail | Yes | No | No |
| R5-14 | chatAdapter signal test gap | — | test gap only | R5-01 fixed, test thin | `chatAdapter.test.ts` | Add abort test | T-04 | — | — | No |
| R5-15 | loopEngine integration gaps | — | partially fixed | R5-03/05 fixed; preflight/stop thin | `loopEngine.integration.test.ts` | Add describe blocks | T-05, R5-02 | — | — | No |
| R5-16 | BootstrapChatView test gap | — | test gap only | SSH/double-start untested | `BootstrapChatView` | New test file | partial+duplicate | — | — | No |

---

## D. Browser Automation (open)

| ID | Title | Sev | Status | Why | Key files | Smallest PR | Tests | Runtime | UI | Split? |
| --- | ----- | --- | ------ | --- | --------- | ----------- | ----- | ------- | -- | ------ |
| R3-01 | `executeCdpTask` missing `approveAction` | Critical | fixed (2026-06-24) | Sensitive clicks denied with no UI | `browserAgentStore.ts`, `browserActionApproval.ts` | Pass approval callback + prompt | `browserActionApproval.test.ts` | Yes | Yes | No |
| R3-02 | `observe_only` flag not wired | Critical | fixed (2026-06-24) | Read-only mode ineffective | `browserAgentStore.ts`, `browserFeatureFlags.ts`, `browserActionPolicy.ts` | Pass `permissionMode` to executor | `browserObserveOnly.test.ts`, `nativeBrowserAgent.test.ts` | Yes | No | No |
| R3-03 | CDP mode skips auth check | Critical | fixed (2026-06-24) | Agent runs on login pages | `browserAgentStore.ts`, `browserAgentStartGate.ts` | Unified auth start gate | `browserAuthRequired.test.ts` | Yes | Yes | No |
| R3-07 | Overlay not removed on error | High | open | Full-screen stuck overlay | store | finally remove overlay | error path cleanup | No | Yes | No |
| R3-08 | `closeWindow` doesn't stop CDP | High | open | Orphan agent after close | store | stopTask in closeWindow | close stops loop | Yes | Yes | No |
| R3-09 | Selector ignored in executor | High | open | Tool calls no-op silently | `nativeBrowserAgent.ts` | Honor selector param | selector used | Yes | No | No |
| R3-10 | `press_enter` not wired | High | open | Form submit fails | agent | Call `pressBrowserKey` | enter key sent | Yes | No | No |
| R3-11–R3-27 | Medium/Low browser items | Med–Low | open | Perf, UX, edge cases | various | One anchor per PR | per round-03 | Mixed | Mixed | Yes |

---

## E. Rust / Tauri Backend (open)

Open **High** items (Critical covered in Lane A):

| ID | Title | Sev | Key files | Smallest PR | Tests | Split? |
| --- | ----- | --- | --------- | ----------- | ----- | ------ |
| R2-05 | Legacy typst path no `resolve_path` | High | `chat.rs` | Add resolve_path | outside work_dir rejected | No |
| R2-06 | Backup sibling-prefix escape | High | `database.rs` | Use `is_within_dir` | `backups-evil/` rejected | No |
| R2-07 | `/sys` exact root not blocked | High | `path_security.rs` | Normalize roots | `validate_path("/sys")` | No |
| R2-08 | Autoresearch bypass skips network | High | `execution_policy.rs` | Network check on bypass | curl needs confirm | No |
| R2-09 | SSHPASS in process list | High | `ssh_bridge.rs` | stdin/env file approach | password not in ps | No |
| R2-10 | CDP goto no scheme allowlist | High | `navigate.rs` | Deny `file://` | scheme table test | No |
| R2-11 | MCP stdio cwd unsandboxed | High | `mcp/stdio.rs` | validate cwd | `/etc` rejected | No |
| R2-12 | `mcp_call_tool` no policy | High | `commands/mcp.rs` | Policy wrapper | destructive needs approval | No |
| R2-13–R2-34 | Medium/Low Rust | Med–Low | various | One per PR | `#[cfg(test)]` | Yes |

---

## F. Workflow / Headless (open)

| ID | Title | Sev | Status | Key files | Smallest PR | Tests | Runtime | UI |
| --- | ----- | --- | ------ | --------- | ----------- | ----- | ------- | -- |
| R6-03 | Abort not checked during tool batch (120s) | Med | open | `agentRunner.ts` | Poll abort in batch loop | abort during batch | Yes | No |
| R6-04 | Streaming `finalText` O(n²) | Med | open | `agentRunner.ts` | Use array join | 10k chunks perf | Yes | No |
| R6-05 | Missing upstream agent throws | Med | open | `engine.ts` | Graceful skip | stale inputFrom | Yes | No |
| R6-06 | Goal preflight no AbortController | Med | open | `WorkflowGoalPreflightPanel` | Cancel on close | panel close aborts | Yes | Yes |
| R6-07 | Bootstrap orphan workflow run | Med | open | `BootstrapChatView.tsx` | Cleanup on AR fail | orphan run updated | Yes | Yes |
| R6-08 | `handleRun` no catch | Low | open | `WorkflowExecutionBar.tsx` | try/catch | engine throw handled | Yes | Yes |
| R6-09 | `getIsRunning()` after stop | Low | needs verification | `engine.ts` | Align with store | post-stop state | Yes | No |
| R6-10 | IPC passes raw apiKey | Low | open | `agentRunner.ts` | configId-only | no key in invoke | Yes | No |
| R6-11–R6-13 | Test gaps | — | test gap only | engine, agentRunner, UI | New describe blocks | T-14 | — | — |

Also see **R4-04–R4-24** (store/workflow cross-cuts) in [round-04](./round-04-store-services.md).

---

## G. Security Hardening (open)

| ID | Title | Sev | Status | Key files | Smallest PR | Tests |
| --- | ----- | --- | ------ | --------- | ----------- | ----- |
| R7-04 | artifactDetector no filter when workDir undefined | High | open | `artifactDetector.ts` | Reject absolute paths | `/etc/passwd` rejected |
| R7-06 | `outputDir` unused in artifactDetector | High | fixed | `artifactDetector.ts`, `chatArtifacts.ts`, `chatToolExecution.ts` | Honor workDir + outputDir roots | artifactDetector + chatArtifacts tests |
| R7-12 | telegram invoke / Rust handler parity | High | open | `telegramService.ts`, `lib.rs` | Register missing handlers | T-15 contract test |
| R7-02 | `isWithinDir` no `..` normalization | Med | open | `pathValidation.ts` | Canonicalize paths | `../` escape |
| R7-03 | artifactDetector Unix-only paths | Med | open | `artifactDetector.ts` | Windows path support | `C:\` paths |
| R7-05 | `addFileArtifact` no workDir check | Med | open | `artifactDetector.ts` | Sandbox check | outside workDir rejected |
| R7-09 | `ChatImage` arbitrary src | Med | open | `ChatImage.tsx` | Allowlist schemes | `javascript:` img blocked |
| R7-10 | Telegram token in URL logs | Med | open | `telegram.rs` | Redact in errors | log scan |
| R7-13 | `terminal_create` cwd no path_security | Med | open | terminal commands | validate cwd | `/etc` rejected |
| R7-15 | Telegram token in localStorage XOR | Med | open | settings | Keychain migration spike | — |
| R7-16 | TS BLOCKED_PREFIXES missing Windows | Med | open | `pathValidation.ts` | Add Windows roots | `C:\Windows` blocked |
| R7-14, R7-17, R7-18 | Low/Info | Low | open | various | Hardening batch | per item |

---

## H. Test Infrastructure

| ID | Title | Sev | Status | Key files | Smallest PR | Tests |
| --- | ----- | --- | ------ | --------- | ----------- | ----- |
| R10-01 | No `App.tsx` bootstrap test | Critical | test gap only | `App.tsx` | Mock stores integration test | view switch |
| R10-02 | No `ChatBrowserWorkspaceShell` test | Critical | test gap only | shell | split + permission tests | T-10, T-11 |
| R10-03 | No `MainLayout` responsive test | Critical | test gap only | `MainLayout.tsx` | breakpoint test | panel visibility |
| R10-04–R10-07 | Telegram store/service gaps | High | test gap only | telegram/* | Contract + poller tests | T-15, T-16 |
| R10-08 | 20/22 `tools/impl` untested | Critical | test gap only | `tools/impl/*` | One tool per PR | BashTool, FileRead, WebFetch |
| R10-09 | ExecutionModeDropdownErrorBoundary | Med | test gap only | boundary component | throw → fallback | R10-09 |
| R10-10–R10-16 | Medium/Low coverage gaps | Med–Low | test gap only | various | Incremental | per round-10 |
| T-33 | CI: stabilize 24 failing suites | P0 | **fixed** (CI green) | autoresearch tests | Keep green in CI | full suite on PR |
| INFRA-01 | Add `@testing-library/react` | High | open | `package.json` | devDep + sample hook test | R10-13 |
| INFRA-02 | Rust `#[cfg(test)]` expansion | High | open | `src-tauri` | session_memory, ssh tests | round-02 matrix |
| INFRA-03 | Tauri command parity checker | Med | open | `tools/check-tauri-commands.mjs` | CI job | R9-01 |
| INFRA-04 | CI shard AutoResearch integration | Med | open | `.github/workflows` | Separate job | 380s+ isolation |

### Top 15 suggested tests (tracking)

| # | Test | Audit IDs | Status |
| --- | ---- | --------- | ------ |
| 1 | Session switch streaming isolation | R1-01, R1-02 | test gap only |
| 2 | Shell split layout + ChatInput | R1-03 | test gap only |
| 3 | `useChatMessageScroll` debounce/unmount | R1-11, R10-13 | test gap only |
| 4 | `listenerGuard` ref-count order | R4-01 | test gap only |
| 5 | `QueryEngine` tool_batch timeout | R4-03 | test gap only |
| 6 | `StreamingToolExecutor` requiresConfirmation | R4-07 | test gap only |
| 7 | Legacy vs batch Rust policy | R2-01 | test gap only |
| 8 | `chatAdapter` AbortSignal propagation | R5-01 | partially addressed |
| 9 | `loopEngine` stop/delete/fail-continue | R5-03, R5-05 | partially addressed |
| 10 | `App.tsx` bootstrap + routing | R10-01, R9-06 | test gap only |
| 11 | Shell permission queue + questionnaire | R10-02, R1-15 | test gap only |
| 12 | telegramService ↔ lib.rs parity | R9-01, R10-05 | test gap only |
| 13 | Telegram allowedChats enforcement | R7-11 | fixed 2026-06-24 (`chatAuthorization.test.ts`, `commandRouter.test.ts`) |
| 14 | Markdown XSS vectors | R7-07, R7-08 | test gap only |
| 15 | `pathValidation` sibling-prefix | R7-01 | test gap only |

---

## I. Architecture Governance

Per [complexity-governance.md](../architecture/complexity-governance.md) and `npm run report:complexity`. **No new features** on `>800 LOC` files until split plan lands.

### Requires refactor plan (>800 LOC) — priority source files

| ID | File | LOC | Suggested action | Block feature work? | Split PRs? |
| --- | ---- | --- | ---------------- | ------------------- | ---------- |
| AG-01 | `src-tauri/src/database.rs` | 2473 | Extract backup/restore/migration modules | Yes | Yes — 3+ PRs |
| AG-02 | `src/services/autoresearch/loopEngine.ts` | 1920 | Extract preflight, iteration, metrics phases | Yes | Yes — aligns with R5-02 |
| AG-03 | `src-tauri/src/commands/chat.rs` | 1514 | Remove legacy path (R2-01) then split handlers | Yes | Yes — fix before split |
| AG-04 | `src/components/Sidebar.tsx` | 1499 | Extract session list, bulk actions, settings link | Yes | Yes |
| AG-05 | `src/store/browserAgentStore.ts` | 1413 | Extract CDP task runner (R3-05) | Yes | Yes — aligns with browser lane |
| AG-06 | `src/store/autoresearchStore.ts` | 1340 | Extract persistence, loop wiring | Yes | Yes |
| AG-07 | `src/utils/nativeBrowserAgent.ts` | 1267 | Extract action executor, observation | Yes | Yes |
| AG-08 | `src/store/createChatStore.ts` | 1261 | Extract session lifecycle | Yes | Yes |
| AG-09 | `src/store/chat/chatActions.ts` | 1250 | Extract streaming, tool, send paths | Yes | Yes — after R1 regression tests |
| AG-10 | `src-tauri/src/commands/web.rs` | 1219 | Extract CDP + policy (R3-06) | Yes | Yes |
| AG-11 | `src/store/workflowStore.ts` | 1211 | Extract run history, engine bridge | Yes | Yes |
| AG-12 | `src/services/autoresearch/chatAdapter.ts` | 1117 | Extract headless bridge | Yes | Yes |
| AG-13 | `src/components/ChatInput.tsx` | 1125 | Extract BlockComposer wiring | Yes | Yes |
| AG-14 | `src/pages/Settings.tsx` | 1131 | Extract provider panels | Yes | Yes |
| AG-15 | `src/components/ChatBrowserWorkspaceShell.tsx` | 695 | Split soon — extract terminal, browser dock | Watch | Yes — before shell tests |

### Concept doc alignment (governance)

| ID | Title | Sev | Status | Why | Docs | Action |
| --- | ----- | --- | ------ | --- | ---- | ------ |
| AG-16 | Two-folder vs three-folder drift | Med | open | Wrong cwd in tools/AR | [folders-and-runs.md](../concepts/folders-and-runs.md) | Audit `workDir` vs `pipiOutputDir` call sites |
| AG-17 | Execution mode gating inconsistency | Med | open | Legacy bypass (R2-01) | [execution-modes.md](../concepts/execution-modes.md) | Align Rust registry with mode docs |
| AG-18 | AutoResearch runtime doc vs code | Med | open | Abort wiring, loop state | [autoresearch-runtime.md](../concepts/autoresearch-runtime.md) | Update doc after R5-02 fix |
| AG-19 | `pages/Chat.tsx` parallel to shell | Low | open | Dead route (R1-14, R9-11) | folders-and-runs | Delete in dedicated PR |
| AG-20 | PR size regression guard | Low | open | >20 file PRs slip through | complexity-governance | CI warning on large diffs |

### Split soon (500–800 LOC) — sample

`engine.ts` (719), `ChatBrowserWorkspaceShell.tsx` (695), `BootstrapChatView.tsx` (632), `QueryEngine.ts` (535) — full list in complexity report output.

---

## Summary counts

| Category | Count |
| -------- | ----- |
| **Fixed (need regression tests)** | 24 (incl. R2/R3/R6/R7-11 wave, 2026-06-24) |
| **Open P0 / Critical** | 0 |
| **Open High+** | ~17 in backlog JSON + ~12 in round docs |
| **Test gap / infra only** | ~40 |
| **Architecture governance** | 20 |
| **Total tracked in backlog JSON** | 95 |

---

## Cross-references

- [Audit README](./README.md)
- [English audit index](./en/README.md)
- [Test gaps backlog](./test-gaps-backlog.md)
- [Prior full audit](../audits/full-codebase.md)