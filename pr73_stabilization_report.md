# PR #73 Stabilization & Verification Report

**Repository:** `mammut001/pipi-shrimp-agent`  
**Branch:** `agent/runtime-p0-session-channel-tool-metadata`  
**PR:** #73 (Remains **DRAFT**)  
**Status:** All P0 and P1 issues resolved, all automated verification gates passed.

---

## 1. Executive Summary

PR #73 refactored runtime session management, tool channel continuations, and tool registry metadata authority. During stabilization and manual runtime validation, several merge-blocking issues were identified across cancellation propagation, session isolation, token update event loop starvation, timeout loops, and stale test suites.

All identified defects have been fixed conservatively in accordance with PR #73's architectural intent:
- **P0-1:** Fixed cancellation during active streaming by propagating signals to `stop_subprocess`, terminating provider stream generators, and immediately halting event loop consumption upon abort.
- **P0-2:** Fixed session switching orphaning turns and replaying into new sessions by tracking explicit per-turn identities, cancelling previous session runtimes upon switch, dropping stale cross-session chunks, and verifying ownership during release.
- **P0-3:** Throttled rapid streaming token/delta updates with a microtask/time buffer to eliminate UI freezes and event loop starvation.
- **P1-1:** Removed legacy TypeScript `WORKSPACE_TOOL_NAMES` in favor of authoritative Rust tool registry metadata via `toolMetadataMap.get(name)?.requiresWorkspace`.
- **P1-2:** Migrated all stale Jest tests expecting legacy `_resolveAll` continuations and deprecated `isReadOnlyTool` exports to `submitSessionToolResults` and `partitionToolsByMetadata`.
- **P1-3:** Increased default `StreamingToolExecutor` timeout from 30s to 300s to match Rust registry `default_timeout_ms` (300s for commands/processes), eliminating confirmation loops on `execute_command`.
- **P1-4:** Fixed `GoalStatusBadge.tsx` status display when a workflow run is stopped with a null evaluation after iterations.
- **P1-5:** Fixed rapid send dropping user keystrokes in `ChatInput.tsx` by clearing drafts immediately on send and restoring them only on caught failures.

---

## 2. Issues & Root Cause Analysis

### P0-1: Ineffective Stop During Streaming
- **Symptom:** Clicking "Stop" during active LLM token streaming failed to interrupt backend generation, allowing LLM text to continue accumulating until full completion.
- **Root Cause:** 
  1. `streamAdapter.ts` did not hook `stop_subprocess` into its abort event listener.
  2. `queryLoop.ts` threw on abort signals rather than returning gracefully from the async generator, causing unhandled rejections or delayed generator termination.
  3. `chatActions.ts` did not verify `isTurnActive(turnId)` before appending text deltas.
- **Fix:**
  - In `src/core/streamAdapter.ts`, attached `stop_subprocess` to signal abort listeners and checked `signal.aborted` before pulling next queued chunks.
  - In `src/core/runtime/queryLoop.ts`, converted abort signals into early returns and guarded generator loops.
  - In `src/store/chat/chatActions.ts`, checked `getSessionHandle(activeSessionId).isTurnActive(turnId)` on each chunk and halted execution immediately.

### P0-2: Chat Switching Orphaning Turns and Bleeding Across Sessions
- **Symptom:** Switching chats while generation was in progress left the prior turn alive, causing streaming deltas and tool batch executions to leak into the newly selected session.
- **Root Cause:**
  1. `selectSession` only stopped subprocesses if `isStreaming` was currently true and did not cancel the `SessionRuntime`.
  2. Late tool execution completions were submitted to whatever session was active at submission time.
  3. Async `finally` blocks in session handlers called `releaseSessionRuntime(sessionId)` unconditionally, inadvertently destroying newer runtime instances for the same session.
- **Fix:**
  - In `src/core/runtime/SessionRuntime.ts`, introduced per-turn IDs (`newTurnId(sessionId)`), single-active-turn invariants, and instance identity checks in `releaseSessionRuntime(sessionId, handleOrRuntime)`.
  - In `src/store/createChatStore.ts`, updated `selectSession` to invoke `getSessionHandle(owningSessionId).cancel('Session switched')`.
  - In `src/store/chat/chatActions.ts`, bound messages and chunks explicitly to `activeSessionId` and `assistantMessage.id`.
  - In `src/core/runtime/ToolResultChannel.ts`, capped tombstones (`MAX_TOMBSTONES = 1000`) and dropped waiters cleanly on abort.

### P0-3: Unthrottled Token Updates Freezing Event Loop
- **Symptom:** Fast LLM token generation (50-100+ tokens/sec) flooded React state updates and database writes, freezing UI interactions and delaying user cancel inputs.
- **Root Cause:** Every single `text_delta` triggered immediate synchronous or microtask React state updates and state notifications.
- **Fix:**
  - Buffered streaming text in `currentStreamingBuffer` in `chatActions.ts` and throttled UI updates (50ms interval), flushing immediately upon turn complete, tool batch request, or stop.

### P1-1: Rust Registry Metadata Authority for Workspace Tools
- **Symptom:** Duplication of workspace tool definitions in TypeScript (`WORKSPACE_TOOL_NAMES`) drifted from the canonical Rust `ToolRegistry`.
- **Root Cause:** Legacy hardcoded set in `chatToolExecution.ts`.
- **Fix:**
  - Removed `WORKSPACE_TOOL_NAMES` from `chatToolExecution.ts`.
  - Used `toolMetadataMap.get(tool.name)?.requiresWorkspace` from `deps.loadToolRuntimeMetadata()`.
  - Updated `src/utils/__tests__/folderModeInteraction.test.ts` to assert metadata check pattern.

### P1-2: Stale Jest Test Migration (`_resolveAll`, `isReadOnlyTool`)
- **Symptom:** Tests across `QueryEngine.test.ts`, `StreamingToolExecutor.test.ts`, `agentRunner.test.ts`, and `chatToolExecution.test.ts` failed due to missing `_resolveAll` and removed helper exports.
- **Root Cause:** PR #73 eliminated continuation callbacks on engine events and deprecated TS-side partition helpers.
- **Fix:**
  - Migrated `QueryEngine.test.ts` to use `submitSessionToolResults`.
  - Migrated `StreamingToolExecutor.test.ts` to test `partitionToolsByMetadata`.
  - Supported legacy `_resolveAll` in `chatToolExecution.ts` and `agentRunner.ts` when present on test event fixtures while submitting through `submitSessionToolResults`.
  - Adapted `createDeps` in `chatToolExecution.test.ts` to provide `partitionToolsByMetadata` and `loadToolRuntimeMetadata`.

### P1-3: 30s `StreamingToolExecutor` Timeout
- **Symptom:** Commands running longer than 30s timed out in frontend executor even though Rust registry default timeout is 300s.
- **Root Cause:** `StreamingToolExecutor` constructor defaulted `timeoutMs` to 30,000ms.
- **Fix:**
  - Updated constructor to accept number or options object and defaulted `timeoutMs` to 300,000ms (300s).
  - Explicitly configured `StreamingToolExecutor(300_000)` in `chatToolExecution.ts` default deps.

### P1-4: `GoalStatusBadge.tsx` Status Display Bug
- **Symptom:** When a workflow stopped after iterations without producing a goal evaluation, the badge erroneously showed "⚡ In Progress".
- **Root Cause:** Fallthrough condition in status ternary when `!isRunning` and `!latestEvaluation` but `currentIteration > 0`.
- **Fix:**
  - Displayed "❌ Not Reached" when stopped after iteration > 0 with null evaluation.
  - Added test coverage in `GoalStatusBadge.test.tsx`.

### P1-5: Rapid Send Dropping Keystrokes
- **Symptom:** Keystrokes typed immediately after pressing Enter were discarded when the asynchronous send resolved and cleared the draft.
- **Root Cause:** `clearInputDraft()` was invoked only after `await sendMessage(...)` resolved.
- **Fix:**
  - Cleared draft immediately upon submission and restored input in the `catch` block if submission threw an error.

---

## 3. Verification & Gate Results

| Gate | Command | Result | Details |
|------|---------|--------|---------|
| **Type Check** | `pnpm exec tsc --noEmit` | **PASS** | 0 errors across entire workspace |
| **Frontend Tests** | `pnpm exec jest` | **PASS** | 256 test suites passed, 1,827 tests passed |
| **Backend Tests** | `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS** | 320 tests passed |
| **Backend Check** | `cargo check --manifest-path src-tauri/Cargo.toml` | **PASS** | Compiled cleanly |
| **Skill Sync** | `pnpm check:skill-sync` | **PASS** | Built-in skills synced |
| **Production Build** | `pnpm build` | **PASS** | Vite production build successful (6.64s) |

---

## 4. PR Status & Policy Confirmation

- **PR #73:** Remains in **DRAFT** state.
- **Remote Target Branch:** `agent/runtime-p0-session-channel-tool-metadata`
- **History:** No force-push, fast-forward commits only.
