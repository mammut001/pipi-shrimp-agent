# Interrupted-turn persistence (GPT P0 knife 1)

## Problem

If the app crashes, is killed, or reloads mid-tool, persisted assistant
messages can still contain `tool_calls` with no matching tool results.
On the next `runChatTurn`, `buildApiMessages` would re-present those
orphan tool requests and the model may assume the tool is still open or
already succeeded.

In-memory `toolRuntimeState` does **not** survive reload, so Stop-time
cancel paths alone are not enough.

## Fix

On session load / DB hydration (`createChatStore.init`):

1. Scan each session's **persisted messages only** for orphan assistant
   `tool_calls` (no matching `tool_call_id` / `__TOOL_RESULT__`).
2. Scrub those orphans from the assistant messages (same idea as
   `scrubDanglingToolCalls` from #79).
3. Append a durable assistant cancel/interrupted notice listing the
   orphaned tool names.
4. Persist scrubbed messages + notice via a **single** write path
   (`db_save_messages` — SQLite transaction on the Rust side).

Do **not** resume or re-run unfinished tools. Recovery is interrupted +
explicit user retry only.

### P0 hardenings (FIX-FIRST on #80)

1. **Atomic hydrate persist** — After computing scrubbed messages +
   interrupted notice, persist them together with one
   `db_save_messages` invoke (Rust `save_messages` wraps INSERT OR
   REPLACE in `BEGIN`/`COMMIT`). Removes the scrub→notice failure
   window from sequential `db_save_message` calls.
   - Residual: kill *during* that single transactional invoke still
     depends on SQLite commit atomicity (expected). Fallback to
     sequential `db_save_message` only if the bulk command errors
     (e.g. older binary); that fallback reopens a window and is
     logged.
2. **localStorage write-back** — When init falls back to
   `pipi-shrimp-sessions`, terminalize with `persist: 'localStorage'`
   and write the updated sessions snapshot back so the next reload
   does not re-see orphans. In-memory store is updated first via
   `set()`.

## Key APIs

| API | Role |
|-----|------|
| `listOrphanToolCalls(messages)` | Pure orphan detection from history |
| `terminalizeInterruptedMessages(messages)` | Pure scrub + notice |
| `terminalizeInterruptedToolTurns(sessionId, …)` | Store + DB hydrate path |
| `terminalizeInterruptedToolTurnsForSessions(…)` | All sessions after load |
| `persistSessionsToLocalStorage(get)` | Write-back for localStorage fallback |
| `db_save_messages` / `save_messages` | Transactional bulk message upsert |
| `buildToolCancelNoticeContent(names, kind)` | Shared notice text (`user_cancel` / `interrupted`) |
| `scrubDanglingToolCalls` | Still used by live Stop / session-switch |

## Notice text (interrupted)

```
[Tool run interrupted before completion (session reloaded): <tools>.
Treat this as a terminal cancel for that attempt — do NOT re-request the
same tool or assume it completed. Ask the user before retrying.]
```

Live Stop still uses `user_cancel` wording via the same builder.

## Out of scope / deferred

- No SessionRuntime / queryLoop rewrite
- No durable resume of half-run tools
- No dependence on `toolRuntimeState` for hydrate
- Persisting ephemeral `__TOOL_RESULT__` transport rows remains deferred
  (durable signal = scrub + assistant notice)
- **Deferred:** multi-orphan → one notice (today one notice listing all
  orphan tool names in that hydrate pass; further policy TBD)
- **Partial (soak knife 2):** headless crash/reload soak + DB reopen durability —
  see `docs/soak-crash-reload.md`. Mid-COMMIT WAL tear fault-injection still deferred.

## Tests

`src/store/chat/__tests__/scrubDanglingToolCalls.test.ts` — orphan scan,
hydrate terminalize, `buildApiMessages` follow-up history, idempotency,
multi-session hydrate, **single `db_save_messages` batch**, **localStorage
write-back after terminalize**.
