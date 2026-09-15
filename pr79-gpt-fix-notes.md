# PR #79 GPT FIX-FIRST notes

Branch: `fix/cancel-followup-rerequest`  
Base commit before this follow-up: `42c308a`

## Fixed (this commit)

1. **`tools_cancelled` dropped by Chat host `isTurnActive`**
   - `sendMessage` now observes `tools_cancelled` **before** the `!isTurnActive` gate (no longer throws away the event).
   - Durable path remains `stopGeneration` cancel notice in `session.messages` (strengthened text: terminal cancel, do NOT re-request same tool).
   - Test: follow-up history still contains notice even when host never relies on `tools_cancelled`.

2. **Race: executionId snapshot vs tools completing**
   - Added `listCancellableSessionExecutionIds` (unresolved + any non-terminal step with `executionId`).
   - Snapshot taken **before** `failUnresolvedSessionTools` clears unresolved state.
   - `cancel_tool_execution` is best-effort; `already_finished` / `not_found` do not fail Stop.

3. **dangling `tool_calls` scrub too narrow**
   - `scrubDanglingToolCalls` now walks **all** assistant messages and strips orphan `tool_calls` without matching results (not only the last message).
   - Unit tests cover multi-message orphan scrub + keep paired results.

4. **ownership-loss abort path**
   - Pre-`waitFor` ownership/abort now synthesizes cancelled `__TOOL_RESULT__` + yields `tools_cancelled`.
   - Post-`waitFor` ownership/abort does the same (no orphaned assistant `tool_calls`).
   - QueryEngine test covers ownership loss before waitFor (`reason: ownership_lost`).

5. **AbortError classification tightened**
   - `isChatGenerationCancelledError` and queryLoop abort checks only match real `AbortError` name / `ChatGenerationCancelledError` / `signal.aborted` / ownershipLost.
   - Loose `message.includes('aborted'|'cancelled')` removed so policy/upstream failures are not swallowed as cancel.
   - Test: `"request cancelled by upstream policy"` yields `error`, not `tools_cancelled`.

## Nice-to-have done

- Stronger cancel notice text (`do NOT re-request… Ask the user before retrying`).
- Extra follow-up test asserting notice without depending on host handling of `tools_cancelled`.

## Deferred (do not block)

- Full DB reload / crash recovery / session-switch matrix tests.
- End-to-end PERF-TOOL-CANCEL manual matrix beyond existing unit coverage.
- Persisting `__TOOL_RESULT__` rows into the chat store DB (still ephemeral in queryLoop; durable signal is the assistant cancel notice + scrub).

## Tests run

```
pnpm exec jest \
  src/store/chat/__tests__/chatStoreSendMessage.test.ts \
  src/core/__tests__/QueryEngine.test.ts \
  src/core/runtime/__tests__/SessionRuntime.test.ts \
  src/core/runtime/__tests__/SessionRuntime.concurrent.test.ts \
  src/store/chat/__tests__/scrubDanglingToolCalls.test.ts \
  --no-coverage
→ 5 suites, 65 passed

pnpm exec jest \
  src/store/chat/__tests__/chatToolExecution.test.ts \
  src/store/chat/__tests__/sessionIsolation.test.ts \
  --no-coverage
→ 2 suites, 39 passed
```

Total this round: **104 passed**.
