# Interrupted-turn recovery policy runbook (GPT P1 #5)

**Status:** **DONE** — helpers + deterministic tests landed with Manual D in #83
(`c063d03`); this doc is the canonical close-out runbook.

**Principle:** After a restart (crash, kill, reload), unfinished work is
**terminalized**, never resumed. Re-execution requires an **explicit user**
retry (Send / Retry). No durable half-run tool resume.

Companion: [`interrupted-turn-persistence.md`](./interrupted-turn-persistence.md)
(hydrate scrub + cancel/interrupted notice from #80).

## Key paths

| Layer | Path | Role |
|-------|------|------|
| Policy helpers | `src/store/chat/interruptedTurnRecoveryPolicy.ts` | Named R1–R4 constants + pure decision/invariant helpers |
| Policy tests | `src/store/chat/__tests__/interruptedTurnRecoveryPolicy.test.ts` | Deterministic R1–R4 coverage (no wall-clock sleeps) |
| Hydrate terminalize | `src/store/chat/scrubDanglingToolCalls.ts` | `terminalizeInterruptedMessages` / `…ToolTurns*` (enforcement on `createChatStore.init`) |
| Persist mid-tool | `persistAssistantPendingToolCalls` / `clearAssistantPendingToolCalls` | So kill mid-wait leaves orphans hydrate can scrub |
| Store export | `src/store/chat/index.ts` | Re-exports policy helpers |

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
| `hasInterruptedOrCancelNotice(messages, kind?)` | Detect durable interrupt / user_cancel notice text |
| `terminalizeInterruptedMessages` / `…ToolTurns*` | Existing #80 hydrate path |

## How to run

```bash
# From repo root (/workspace/pipi-shrimp-agent)

# Policy R1–R4 suite (primary)
pnpm exec jest src/store/chat/__tests__/interruptedTurnRecoveryPolicy.test.ts --runInBand --no-coverage

# Pattern filter (prefer plural --testPathPatterns)
./node_modules/.bin/jest --testPathPatterns='interruptedTurnRecoveryPolicy' --runInBand --no-coverage

# Companion hydrate scrub / mid-tool persist coverage (#80)
pnpm exec jest src/store/chat/__tests__/scrubDanglingToolCalls.test.ts --runInBand --no-coverage
```

Short soak (stop-on-fail):

```bash
N=10
for i in $(seq 1 "$N"); do
  echo "=== recovery policy soak $i/$N ==="
  pnpm exec jest \
    src/store/chat/__tests__/interruptedTurnRecoveryPolicy.test.ts \
    --runInBand --no-coverage \
    || { echo "FAILED at iteration $i"; exit 1; }
done
echo "recovery policy soak: $N/$N passed"
```

Manual D dual-session cancel/late-discard (independent of restart) lives in
[`manual-d-product-harness.md`](./manual-d-product-harness.md) —
`manualDProductHarness.test.ts` + `SessionRuntime.concurrent.test.ts`.

## Out of scope / deferred

- No `SessionRuntime` / `queryLoop` rewrite
- No durable resume of half-run tools / actor resume tokens for chat turns
- No OpenTelemetry; no big Playwright E2E framework
- Full SQLite crash/WAL kill matrix remains deferred (see [`interrupted-turn-persistence.md`](./interrupted-turn-persistence.md) / [`soak-crash-reload.md`](./soak-crash-reload.md))

## Related

- [`interrupted-turn-persistence.md`](./interrupted-turn-persistence.md) — P0 hydrate scrub + mid-tool persist
- [`manual-d-product-harness.md`](./manual-d-product-harness.md) — P1 #4 dual-session product harness
- [`gpt-next-gaps-guidance.md`](./gpt-next-gaps-guidance.md) — knife progression
- [`soak-polish-scout.md`](./soak-polish-scout.md) — scout index
