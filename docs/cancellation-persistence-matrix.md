# Cancellation persistence matrix (GPT P0 knife 2)

Deterministic Jest coverage for cancel / session-switch / reload correctness
raised on top of #79/#80 (`scrubDanglingToolCalls`, `terminalizeInterruptedMessages`,
hydrate `db_save_messages`, stopGeneration cancel notice).

## Principle

Prove persisted history after cancel and session boundaries — **no sleeps**,
in-memory DB mock, reuse #80 helpers. No SessionRuntime / queryLoop rewrite.

## Tests

| File | Focus |
|------|--------|
| `src/store/chat/__tests__/chatCancellationPersistence.test.ts` | cancel→reload→follow-up; multi-tool mix; late completion; interleaved DB save |
| `src/store/chat/__tests__/sessionSwitchCancellation.test.ts` | cancel A→switch B; orphan A→switch B→reopen hydrate; delete while cancelling |
| `src/store/chat/__tests__/cancellationPersistenceTestUtils.ts` | `InMemoryMessageDb` + state binders |

## Cases

1. **cancel → reload → follow-up** — user_cancel terminalize, persist, reload, hydrate idempotent; `buildApiMessages` has terminal marker, no orphan `tool_calls`.
2. **cancel A → switch B** — B history untouched (no ghost cancel notice); A remains terminal in its own session/DB.
3. **A orphans → switch B → reopen A** — harsh path: DB still has orphans after switch; hydrate `terminalizeInterruptedToolTurnsForSessions` terminalizes A only.
4. **multi-tool one done / one cancelled** — completed `tool_calls` kept; cancelled scrubbed; notice present after reload.
5. **late tool completion after cancel** — stale upsert of orphan assistant; hydrate re-terminalizes; no orphan follow-up history.
6. **cancel interleaved with DB save** — scrub then dirty re-inject; atomic `db_save_messages` leaves scrubbed + interrupted notice.
7. **delete session while cancelling** — `db_delete_session` then late `db_save_*` discarded; sibling session intact.

## Deferred

- Full real SQLite crash/WAL kill matrix (process kill mid-commit) — still knife-1 residual / integration.
- Full `useChatStore` E2E with live `stopGeneration` + `selectSession` + `deleteSession` under Tauri invoke (covered partially by `chatStoreSendMessage.test.ts` cancel cases).
- Persisting ephemeral `__TOOL_RESULT__` transport rows as durable rows.
