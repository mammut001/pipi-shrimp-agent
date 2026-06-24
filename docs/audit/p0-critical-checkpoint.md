# P0 / Critical Remediation Checkpoint — 2026-06-24

Checkpoint report after the focused PR sequence that closed all **P0 / Critical** audit anchors from Rounds 2, 3, 6, and 7 (Telegram). **No runtime or UI behavior changes in this document** — verification and backlog alignment only.

**Related:** [remediation-roadmap.md](./remediation-roadmap.md) · [remediation-backlog.json](./remediation-backlog.json) · [README](./README.md)

---

## Executive summary

| Metric | Value |
| ------ | ----- |
| **P0/Critical fixed (this wave)** | **13** |
| **P0/Critical fixed (all waves, incl. pre-2026-06-24)** | **24** |
| **Open P0/Critical in backlog** | **0** |
| **Open High in backlog JSON** | **5** (R5-02, R7-04, R7-06, R7-12, INFRA-01) |
| **Open High in round docs (not yet in JSON)** | **~12** (browser R3-07–R3-10, Rust R2-05–R2-12, etc.) |
| **Regression test gaps** | Most fixed items need guardrail tests (Top-15, T-* entries) |

All thirteen anchors from the remediation wave are **`fixed`** in `remediation-backlog.json` with `fixNote` timestamps **2026-06-24**. Each fix shipped with targeted unit/integration tests; several Top-15 regression suites remain open.

**Phase transition:** Critical closure is complete. Recommended next work shifts to **High-severity reliability** (browser executor gaps, artifact sandbox, AutoResearch abort hygiene), **security follow-ups** (Telegram Rust parity), **test infrastructure** (`@testing-library/react`, policy parity tests), and **architecture splits** on files that exceeded the 800 LOC governance cap during remediation.

---

## Fixed P0 / Critical — by lane

### A. Rust / Tauri backend

#### R2-04 — SSH local-mode shell injection

| Field | Detail |
| ----- | ------ |
| **Problem** | Local SSH bridge embedded `remote_work_dir` in a `cd … &&` shell prefix without escaping — metacharacters in paths allowed command injection. |
| **Fix summary** | Local mode uses process `cwd` instead of shell `cd` prefix; remote paths stay shell-quoted in cp/cat/ssh wrappers. SSH mode unchanged. |
| **Tests added** | `cargo test ssh_bridge::tests` — 16 unit tests including `shell_escape_*` and `local_mode_does_not_embed_cd_prefix_for_workdir`. |
| **Remaining risk** | SSH mode still uses shell composition; password visible in process list (R2-09). |
| **Follow-up** | R2-09 (SSHPASS in `ps`), R2-05–R2-12 High Rust hardening. |

#### R2-01 — Legacy `execute_tool` bypasses registry and execution_policy

| Field | Detail |
| ----- | ------ |
| **Problem** | `invoke('execute_tool')` ran registry-backed tools without schema validation, `execution_policy`, or approval gates. |
| **Fix summary** | New `legacy_execute_tool.rs` rejects registry tools; production callers migrated to `execute_single_tool`; legacy path retains browser/Typst/Skill with `enforce_request_policy`. `glob_search`/`grep_files` registered. |
| **Tests added** | `cargo test legacy_execute_tool`, `cargo test registry::tests`, `pnpm test toolExecutionPolicy.test.ts`. |
| **Remaining risk** | Direct `invoke('execute_tool')` for gated tools now errors — breaking change for external scripts. Policy parity test (TOP-15-07) not yet in CI. |
| **Follow-up** | TOP-15-07 legacy vs batch policy test; AG-03 split `chat.rs`; AG-17 doc alignment. |

#### R2-02 — `execute_single_tool` missing sessionId

| Field | Detail |
| ----- | ------ |
| **Problem** | `execute_single_tool` passed `session_id: None`, so preview-then-execute approval tokens could not be consumed. |
| **Fix summary** | Invoke accepts `sessionId`; validated for assistant/user sources; flows into `registry.execute_with_context`. Chat and AutoResearch bootstrap callers updated. |
| **Tests added** | `cargo test tools::tests`, `src/store/chat/__tests__/chatToolExecution.test.ts`. |
| **Remaining risk** | Headless/workflow paths may still omit sessionId on some invoke sites — needs grep audit. |
| **Follow-up** | Grep audit of all `execute_single_tool` invoke call sites. |

#### R2-03 — `session_memory` discards `validate_work_dir` errors

| Field | Detail |
| ----- | ------ |
| **Problem** | `validated_session_memory_dir` swallowed `validate_work_dir` failures, allowing memory writes with invalid or out-of-sandbox `work_dir`. |
| **Fix summary** | Validation errors propagate with `?`; all session_memory commands fail closed on invalid explicit `work_dir`; omitted `work_dir` still uses app fallback. |
| **Tests added** | `cargo test session_memory::tests` — invalid `/etc` and out-of-sandbox paths rejected. |
| **Remaining risk** | Windows path edge cases (R7-02, R7-16) not fully covered on TS side. |
| **Follow-up** | R7-02 `..` normalization; INFRA-02 expand Rust `#[cfg(test)]` matrix. |

---

### B. Browser automation

#### R3-05 — `stopTask` cannot stop native CDP loop

| Field | Detail |
| ----- | ------ |
| **Problem** | Stop button did not abort the native CDP/LLM loop; late results could commit `completed` status after user abort. |
| **Fix summary** | Per-run `AbortController` in `stopTask`; signal passed into `executeNativeBrowserTask`; late CDP/LLM results guarded from committing. |
| **Tests added** | `src/store/browser/__tests__/browserTaskStop.test.ts`, `src/__tests__/nativeBrowserAgent.test.ts`. |
| **Remaining risk** | `closeWindow` does not call `stopTask` (R3-08); overlay may stick on error (R3-07). |
| **Follow-up** | R3-08 `closeWindow` + stopTask; AG-05 split `browserAgentStore.ts`. |

#### R3-06 — Rust `cdp_execute_script` has no policy gate

| Field | Detail |
| ----- | ------ |
| **Problem** | Arbitrary JavaScript could execute via Rust CDP command, bypassing TS `browserActionPolicy`. |
| **Fix summary** | `cdp_execute_script` enforces `execution_policy` with source/sessionId/approvalToken; trusted browser-agent overlay probes allowed; arbitrary JS requires approval. |
| **Tests added** | `cargo test execution_policy`, `src/utils/__tests__/browserActionClient.test.ts`. |
| **Remaining risk** | Other CDP commands (navigate, etc.) may lack scheme allowlists (R2-10). |
| **Follow-up** | AG-10 split `web.rs`; R2-10 CDP goto scheme allowlist. |

#### R3-01 — `executeCdpTask` missing `approveAction` callback

| Field | Detail |
| ----- | ------ |
| **Problem** | Sensitive browser actions denied by default (`ask` mode) with no UI path to approve — agent could not complete login/form flows. |
| **Fix summary** | `approveAction` wired from store into native agent; pending approval state + `BrowserActionApprovalPrompt` UI; `stopTask` cancels pending approvals. |
| **Tests added** | `src/store/browser/__tests__/browserActionApproval.test.ts`, `browserTaskStop.test.ts`. |
| **Remaining risk** | Approval prompt only on CDP path; embedded WebView actions may differ. |
| **Follow-up** | E2E manual QA on login-page flows with auth + approval gates stacked. |

#### R3-02 — `observe_only` flag not passed into browser agent

| Field | Detail |
| ----- | ------ |
| **Problem** | `PIPI_BROWSER_ACTION_PERMISSION_MODE=observe_only` in localStorage had no effect on CDP agent — mutating actions still ran. |
| **Fix summary** | `resolveBrowserActionPermissionMode()` passed into `executeCdpTask`; `observe_only` blocks mutating actions before approval; read-only observation actions remain allowed. |
| **Tests added** | `src/store/browser/__tests__/browserObserveOnly.test.ts`, `src/__tests__/nativeBrowserAgent.test.ts`, `src/__tests__/browserActionPolicy.test.ts`. |
| **Remaining risk** | Mode only applies to CDP native path; Rust direct invokes bypass TS policy unless gated separately. |
| **Follow-up** | AG-17 execution-modes doc alignment; verify `execution-modes.md` reflects observe_only gate. |

#### R3-03 — CDP mode skips `auth_required` checks

| Field | Detail |
| ----- | ------ |
| **Problem** | `executeTask` CDP path started agent on login/auth pages without checking `auth_required` page state. |
| **Fix summary** | `evaluateBrowserAgentStartGate` runs before CDP/native agent start; `auth_required` blocks `executeNativeBrowserTask`; `forceResumeWithoutAuth` escape hatch preserved. |
| **Tests added** | `src/store/browser/__tests__/browserAuthRequired.test.ts`, `browserAgentStartGate.test.ts`. |
| **Remaining risk** | `forceResumeWithoutAuth` still bypasses auth (R3-13, documented escape hatch). |
| **Follow-up** | R3-13 audit force-resume usage; document operator intent in `execution-modes.md`. |

#### R3-04 — Embedded WebView ≠ external CDP Chrome surface

| Field | Detail |
| ----- | ------ |
| **Problem** | User-visible embedded/inspected preview URL could differ from the CDP-controlled Chrome tab — agent operated on wrong page. |
| **Fix summary** | `evaluateCdpSurfaceMatchGate` compares preview URL with live CDP URL via `getCurrentBrowserUrl()` before `executeNativeBrowserTask`; mismatch fail-closed; `forceResumeWithoutAuth` does not bypass surface gate. |
| **Tests added** | `src/store/browser/__tests__/browserSurfaceMatch.test.ts`, `browserSurfaceMismatch.test.ts`. |
| **Remaining risk** | URL normalization edge cases (trailing slash, hash-only diff, redirect mid-start). |
| **Follow-up** | Expand normalization table tests; light observation navigation_id refresh (R3-14). |

---

### C. Workflow / Headless

#### R6-01 — `createRunDirectory` failure still continues run

| Field | Detail |
| ----- | ------ |
| **Problem** | Workflow engine continued agent steps and artifact writes after `createRunDirectory` rejected — silent data loss. |
| **Fix summary** | Fail-fast: directory creation failure aborts workflow start, records error run, clears `isRunning`, skips agent/artifact execution. |
| **Tests added** | `src/services/workflowEngine/__tests__/engine.test.ts` — createRunDirectory failure cases. |
| **Remaining risk** | Partial directory creation (mkdir succeeds, write fails later) not covered. |
| **Follow-up** | R6-05 missing upstream agent graceful skip; AG split `engine.ts` (719 LOC, split soon). |

#### R6-02 — `stop()` does not cancel in-flight invoke stream

| Field | Detail |
| ----- | ------ |
| **Problem** | Workflow `stop()` waited for full streaming invoke completion; resources not released promptly; late results could commit. |
| **Fix summary** | Per-run `AbortController` in `WorkflowEngine.stop()`; signal passed to `runAgent`; `agentRunner` calls `stop_subprocess` on abort and ignores late invoke results. |
| **Tests added** | `src/services/workflowEngine/__tests__/engine.test.ts` — stop/cancel describe block. |
| **Remaining risk** | Tool batch loop (up to 120s) does not poll abort (R6-03). |
| **Follow-up** | R6-03 abort check during tool batch; T-14 regression guard. |

---

### D. Security / Telegram

#### R7-11 — Telegram `allowedChats` not enforced in commandRouter

| Field | Detail |
| ----- | ------ |
| **Problem** | `allowedChats` type and settings existed but inbound router never checked — any chat could command the bot. |
| **Fix summary** | Central `isTelegramInboundChatAuthorized` guard in `commandRouter` before dispatch; `connectorConfig` localStorage persistence wired to `telegramSetAllowedChats`; owner chat always allowed when allowlist is restrictive; empty allowlist denies all except owner. |
| **Tests added** | `src/services/telegram/__tests__/chatAuthorization.test.ts`, `commandRouter.test.ts`. |
| **Remaining risk** | Rust-side handlers may still lack parity with TS invokes (R7-12); token storage still XOR localStorage (R7-15). |
| **Follow-up** | R7-12 Telegram Rust handler parity; R7-10 token redaction in logs. |

---

## Backlog consistency verification

Checked `remediation-backlog.json` on **2026-06-24**:

| Check | Result |
| ----- | ------ |
| All 13 wave IDs marked `fixed` | ✅ R2-01, R2-02, R2-03, R2-04, R3-01, R3-02, R3-03, R3-04, R3-05, R3-06, R6-01, R6-02, R7-11 |
| No unrelated R2/R3/R6 wrongly marked `fixed` | ✅ Only listed IDs + pre-existing fixes (R1-*, R4-*, R5-01/03/05, R7-01/07/08) |
| Open Critical/P0 remain open | ✅ Zero open Critical/P0 entries in JSON |
| Duplicate open R3-04 entry | ✅ Removed — single `fixed` entry only |
| R3-07–R3-10 in JSON | ⚠️ Not tracked in JSON (documented in round-03 + roadmap lane D only) — intentional scope gap, not a status error |

---

## Remaining open — priority snapshot

### High (next phase targets)

| ID | Lane | Summary |
| --- | ---- | ------- |
| R3-07 | Browser | Overlay not removed on error path |
| R3-08 | Browser | `closeWindow` doesn't stop CDP task |
| R3-09 | Browser | Selector param ignored in executor |
| R3-10 | Browser | `press_enter` not wired to `pressBrowserKey` |
| R5-02 | AutoResearch | Preflight abort controller leak |
| R7-04 | Security | `artifactDetector` no filter when `workDir` undefined |
| R7-06 | Security | `outputDir` unused in artifactDetector |
| R7-12 | Security | Telegram invoke / Rust handler parity |
| INFRA-01 | Test | `@testing-library/react` devDependency missing |
| R2-05–R2-12 | Rust | High backend hardening (per round-02) |

### Test gaps on fixed Critical items

| ID | Summary |
| --- | ------- |
| TOP-15-07 | Legacy vs batch Rust policy parity |
| TOP-15-01 | Session switch streaming isolation |
| TOP-15-04 | `listenerGuard` ref-count order |
| TOP-15-05 | `QueryEngine` tool_batch timeout |
| T-14 | Workflow stop/cancel regression |
| T-17 | Browser stopTask regression |

---

## Next 10 PRs after Critical Closure

| # | Audit ID | Title | Likely files | Tests | Risk | Why next |
| --- | -------- | ----- | ------------ | ----- | ---- | -------- |
| 1 | R3-07 | **fix(browser): remove overlay on CDP error path** | `browserAgentStore.ts` | error-path overlay cleanup test | Medium | UX blocker — stuck full-screen overlay after agent failure |
| 2 | R3-08 | **fix(browser): stopTask in closeWindow** | `browserAgentStore.ts`, `BrowserPanel.tsx` | close stops loop test | Medium | Orphan CDP agent after window close — resource leak |
| 3 | R3-09 | **fix(browser): honor selector in native executor** | `nativeBrowserAgent.ts` | selector-used assertion | Medium | Silent no-op tool calls — agent reliability |
| 4 | R3-10 | **fix(browser): wire press_enter to pressBrowserKey** | `nativeBrowserAgent.ts` | enter key sent test | Medium | Form submit failures in common flows |
| 5 | R5-02 | **fix(autoresearch): clear abort controller on preflight fail** | `loopEngine.ts` | controller null after preflight fail | Medium | Blocks clean loop restart after setup failure |
| 6 | R7-12 | **fix(security): Telegram invoke / Rust handler parity** | `telegramService.ts`, `src-tauri/src/lib.rs`, `telegram.rs` | T-15 contract test, `check-tauri-commands.mjs` | High | Dead invokes cause runtime failures |
| 7 | R7-04 | **fix(security): reject artifacts when workDir undefined** | `artifactDetector.ts` | `/etc/passwd` rejected | High | Sandbox bypass for artifact registration |
| 8 | INFRA-01 | **chore(test): add @testing-library/react** | `package.json`, hook sample test | `useChatMessageScroll` sample | Low | Unblocks Top-15 component/hook regression PRs |
| 9 | TOP-15-01 | **test: chat P0 session isolation regression** | `src/store/chat/__tests__/` | T-01, T-02 | Low | Guard fixed R1-01/02/03 before chat refactors |
| 10 | AG-02 | **refactor: extract preflight from loopEngine.ts** | `loopEngine.ts` → new module | `loopEngine.integration.test.ts` | Low | 1920 LOC exceeds governance cap; aligns with R5-02 fix |

---

## Verification commands (checkpoint run)

Commands executed as part of this checkpoint (see final report for results):

```bash
npm run report:complexity
pnpm run build
npx tsc --noEmit
pnpm run check:repo-hygiene
pnpm run check:skill-sync
```

Full test suite **not** run — docs/checkpoint task only.

---

## Cross-references

- Concept docs updated during remediation: [execution-modes.md](../concepts/execution-modes.md) (CDP policy, observe_only, auth, surface gates)
- [folders-and-runs.md](../concepts/folders-and-runs.md) — workDir vs pipiOutputDir (AG-16 still open)
- [autoresearch-runtime.md](../concepts/autoresearch-runtime.md) — abort wiring (AG-18 after R5-02)