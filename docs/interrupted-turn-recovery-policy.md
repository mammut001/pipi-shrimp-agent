# Interrupted-turn recovery policy (GPT P1 #5)

**Principle:** After a restart (crash, kill, reload), unfinished work is
**terminalized**, never resumed. Re-execution requires an **explicit user**
retry (Send / Retry). No durable half-run tool resume.

Companion: [`interrupted-turn-persistence.md`](./interrupted-turn-persistence.md)
(hydrate scrub + cancel/interrupted notice from #80).

## Rules

| # | Rule | Enforcement |
|---|------|-------------|
| R1 | A **running turn does NOT resume** after restart | Process-local `SessionRuntime` / `toolRuntimeState` are not persisted; new process starts idle. Hydrate never calls `runTurn` / `runChatTurn` automatically. |
| R2 | A **running tool does NOT auto-retry** after restart | Orphan `tool_calls` are scrubbed; unfinished tools are not re-invoked on init. |
| R3 | **Restart ⇒ interrupted terminal** | `terminalizeInterruptedToolTurnsForSessions` on hydrate (`createChatStore.init`) — scrub orphans + durable interrupted notice (`kind: 'interrupted'`). Live Stop uses `user_cancel`. |
| R4 | **Only explicit user retry** re-executes | Next turn starts only via `sendMessage` / `retryLastMessage` (or equivalent UI). Hydrate / release / cancel paths must not schedule a turn. |

## Allowed vs forbidden after restart

| Action | Allowed? |
|--------|----------|
| Scrub orphan `tool_calls` + append interrupted notice | Yes (hydrate) |
| Persist scrub + notice (`db_save_messages` / localStorage write-back) | Yes |
| Re-open waiters / resume `ToolResultChannel` for pre-restart turn | **No** |
| Auto `execute_*` / re-request same tool without user input | **No** |
| User sends a new message or taps Retry | Yes (new turn) |

## Helpers

| API | Role |
|-----|------|
| `INTERRUPTED_TURN_RECOVERY_POLICY` | Named constants for R1–R4 |
| `shouldResumeRunningTurnAfterRestart()` | Always `false` (R1) |
| `shouldAutoRetryInterruptedTool()` | Always `false` (R2) |
| `requiresExplicitUserRetryToReExecute()` | Always `true` (R4) |
| `decideHydrateRecoveryAction(messages)` | `terminalize_interrupted` iff orphans exist (R3) |
| `assertInterruptedRecoveryInvariants(messages)` | Post-terminalize checks (no orphans; notice present) |
| `terminalizeInterruptedMessages` / `…ToolTurns*` | Existing #80 hydrate path |

## Tests

`src/store/chat/__tests__/interruptedTurnRecoveryPolicy.test.ts` maps directly
to R1–R4 (policy helpers + hydrate terminalize / cancel notice reuse).

Manual D dual-session cancel/late-discard (independent of restart) lives in
`src/core/runtime/__tests__/manualDProductHarness.test.ts` and
`SessionRuntime.concurrent.test.ts`.

## Out of scope / deferred

- No `SessionRuntime` / `queryLoop` rewrite
- No durable resume of half-run tools / actor resume tokens for chat turns
- No OpenTelemetry; no big Playwright E2E framework
- Full SQLite crash/WAL kill matrix remains deferred (see persistence docs)
