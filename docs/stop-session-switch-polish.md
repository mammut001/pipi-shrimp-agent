# Stop + session-switch product feel (soak knife 3)

**Principle:** prove + persist + observe — no `SessionRuntime` / `queryLoop` rewrite.

Companion plan: [`soak-polish-plan.md`](./soak-polish-plan.md) · scout: [`soak-polish-scout.md`](./soak-polish-scout.md)

## Claims

| Claim | Proof |
| --- | --- |
| **≤1s cancelled feel** | `stopGeneration` clears `isStreaming` / pending counters **before** awaiting `cancel_tool_execution` |
| **A ≠ B isolation** | Stop cancels only `owningSessionId` tools/messages; B history untouched |
| **Stop visible while streaming / long tool** | `shouldShowStopControl` — Stop when `isStreaming` **or** pending tools/results |
| **Session-switch / new chat busy binding** | `selectSession` and `startSession` clear selected-session stream chrome (and rebind/idle as appropriate); **do not** cancel/stop/scrub/fail the previous session's in-flight tools |
| **Permission approval isolation** | Pending `waitForPermission` promises are **session-scoped**; `startSession` / `selectSession` must **not** `clearAllPermissions` (that denies other sessions). UI shows only the selected session's queue entry. Stop / delete still clears the owning session via `clearPermissionsForSession`. Mode updates (`updateSessionPermissionMode` / `updateSessionExecutionMode`) settle **only** the owning `sessionId` queue entries, once (no cross-session resolve / no double-settle). **Swarm** `enqueuePermissionInUI` / `toUIPermissionRequest` must tag owning `sessionId` (same filter); otherwise the shell hides the modal and the bridge TTL (~60s) auto-denies. |
| **Background completion ≠ selected chrome** | Stream completion / cancel / reasoning chrome updates only when `ownsSelectedStreamChrome(owning, current)`; A completing in background must not flip B `isStreaming` / stream buffer / busy chrome / `streamingTimeoutId` (owner-gated timeout cleanup) |
| **Same-session Stop→send race** | Per-session turn epoch: `sendMessage` bumps; `stopGeneration` **eager-scrubs dangling tool_calls before slow native cancel**; `sendMessage` re-scrubs before `buildApiMessages` and **re-checks epoch after scrub await** plus **immediately before createChatTurnAbortController / runChatTurn** (stale post-scrub path must not take over the abort controller or abort a newer turn); cancel-notice `addMessageToSession` re-checks epoch after DB await and discards stale local append; stale cancel completion **re-checks epoch after every await** before placeholder/`stop_subprocess`/pending wipe; placeholder/message ops id-bound to stopped turn; diagnostics cancel uses Stop snapshot only |
| **Stop A leaves B runtime** | Stop cancels only A's executionIds; B unresolved tools / executionIds remain |

## Entry points

```
src/store/chat/chatActions.ts          # stopGeneration optimistic clear
src/store/chat/chatSelectors.ts        # shouldShowStopControl
src/components/ChatInput.tsx           # Send/Stop toggles on shouldShowStopControl
src/store/createChatStore.ts           # selectSession busy rebind + startSession
src/store/chat/sessionIsolation.ts     # resetTransientSessionStateForNewChat UI-only clear
src/store/chat/__tests__/chatSelectors.test.ts
src/store/chat/__tests__/sessionIsolation.test.ts
src/store/chat/__tests__/chatStoreSendMessage.test.ts  # knife 3 cases
src/store/chat/__tests__/startSessionPermissionIsolation.test.ts
src/store/chat/__tests__/modePermissionIsolation.test.ts
src/store/__tests__/permissionSessionIsolation.test.ts
src/store/uiStore.ts                       # clearPermissionsForSession + sessionId on PermissionRequest
src/store/createChatStore.ts               # mode updates settle only owning sessionId permissions
src/services/swarm/permissionBridge.ts     # Swarm UI perms tagged with owning sessionId
src/services/swarm/__tests__/permissionBridge.sessionId.test.ts
src/store/chat/chatToolExecution.ts        # enqueuePermissionInUI({ sessionId: activeSessionId })
```

## Intentionally not this knife

- Long-tool intermediate `cancelling` TaskStep status / vocabulary unify — **done** in [`cancelling-status-vocab.md`](./cancelling-status-vocab.md)
- Truncated replies / Project Folder UX / Danger defaults (scout leftovers)
- Playwright mega-framework; OTel; durable half-tool resume
- Shared module `currentStreamingBuffer` for true concurrent multi-session streams — not fully per-session; chrome is gated, buffer hardening is a follow-up
- Legacy FIFO permission modal in `Chat.tsx` (`permissionQueue[0]`) — not the main shell path (`ChatBrowserWorkspaceShell` is session-filtered)
