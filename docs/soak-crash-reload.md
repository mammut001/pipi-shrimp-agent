# Crash / reload soak (GPT soak knife 2)

**Goal:** Prove **kill mid-tool → reopen → hydrate → follow-up** without orphan resume-as-success and without cross-session contamination.

**Principle:** prove + persist + observe — no `SessionRuntime` / `queryLoop` rewrite, no Playwright platform, no OTel, no durable half-tool resume.

**Depends on:** Manual D harness (#83), interrupted-turn hydrate (#80), cancellation matrix (#81), soak runner + failure bundle (#85), Rust `test_barrier_tool`.

## What this knife covers

| Layer | What | Automated? |
| --- | --- | --- |
| **Headless Jest soak** | Dual-session Manual D barriers; persist mid-tool orphans to `InMemoryMessageDb`; **kill A** by releasing runtime **without** cancel/terminalize; B still succeeds; reopen A → `terminalizeInterruptedMessages(kind: 'interrupted')`; follow-up `buildApiMessages` has interrupted marker + **no** orphan `tool_calls`; stale pre-crash turnId discarded | **Yes** — `crashReloadSoak.test.ts` |
| **Rust SQLite reopen** | Mid-tool orphan rows survive connection drop + reopen (process-restart stand-in); sibling session intact | **Yes** — `orphan_messages_survive_db_reopen_after_mid_tool` in `database.rs` |
| **Live Tauri kill/reopen** | Real app process kill while `test_barrier_tool` waits; reopen UI; hydrate notice; follow-up send | **Manual checklist** below (cannot fully automate process kill in CI yet) |

## Module

```
src/core/runtime/soak/
  crashReloadSoak.ts       # runCrashReloadSoakIteration + runCrashReloadSoak
  crashReloadSoak.test.ts  # Jest entry (default N=5)
  failureBundle.ts         # reused on invariant break
docs/soak-crash-reload.md  # this file
```

### Iteration shape (`runCrashReloadSoakIteration`)

1. Sessions A + B enter `waiting_tool` behind Manual D latches (no sleeps)
2. Persist mid-tool orphan histories to DB (**pre-crash durable rows**)
3. **Kill A:** `releaseSessionRuntimeForTests(A)` — no Stop, no cancel notice
4. Assert DB A still has orphans and **no** interrupt/cancel notice
5. Submit B → success (`b-ok-after-a-kill`); B history gets matching `__TOOL_RESULT__`
6. **Reopen A:** load DB → hydrate `interrupted` terminalize → persist scrub + notice
7. Idempotent second hydrate; B never gains A's interrupted notice
8. Follow-up: `buildApiMessages(A)` has interrupted marker, zero `tool_calls`; stale pre-crash turnId discarded; new turn submit works

### Invariants

| Name | Meaning |
| --- | --- |
| `hydrate_terminalizes_orphans` | After reopen, A has 0 orphans + interrupted notice (idempotent) |
| `no_orphan_resume_as_success` | Follow-up API must not present crashed tool as success; stale turnId discarded |
| `no_cross_session_contamination` | B succeeds after A kill; B never cancelled / never gets A's notice |
| `follow_up_no_orphan_tool_calls` | Next-turn history has terminal interrupted marker, no open tool_calls |

## How to run (Jest)

```bash
# Short (CI)
pnpm exec jest src/core/runtime/soak/crashReloadSoak.test.ts --runInBand --no-coverage

# Also Manual D + knife-1 soak companions
pnpm exec jest \
  src/core/runtime/soak/crashReloadSoak.test.ts \
  src/core/runtime/soak/soakRunner.test.ts \
  src/core/runtime/__tests__/manualDProductHarness.test.ts \
  --runInBand --no-coverage

# Longer loop
PIPI_CRASH_RELOAD_SOAK_ITERS=50 pnpm exec jest \
  src/core/runtime/soak/crashReloadSoak.test.ts --runInBand --no-coverage
```

Prefer `--testPathPatterns` (plural) or a direct file path.

## How to run (Rust reopen)

Requires **rustc ≥ 1.88** (crate graph: darling/serde_with/time/image/zbus). System
`rustc` 1.85 fails resolve before compile. Prefer a scoped rustup toolchain (do not
replace project sources — only the compiler):

```bash
# if needed: curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable
. "$HOME/.cargo/env"   # or ensure ~/.cargo/bin is on PATH
rustc --version          # expect ≥ 1.88 (verified with 1.98.x stable)

# Tauri generate_context needs frontendDist; a stub is enough for this unit test:
mkdir -p dist && printf '%s\n' '<!doctype html><title>stub</title>' > dist/index.html

cargo test --manifest-path src-tauri/Cargo.toml \
  orphan_messages_survive_db_reopen_after_mid_tool -- --nocapture
```

Also needs typical Tauri Linux sysdeps (`pkg-config`, `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, …)
if building from a minimal image.

## Manual Tauri checklist (true process kill)

Use a local `tauri dev` / packaged build with Danger (or whatever mode allows `test_barrier_tool`).

`test_barrier_tool` is registered in the Rust `ToolRegistry` **and** advertised in the LLM-facing OpenAI tool catalog (`src-tauri/src/claude/http/tool_catalog.rs` `get_tools()`), so the model can call it in Danger mode for Manual D / live soak Sessions A/B. It remains a harness-only tool (block until `release_test_barrier` / cancel) — not for production agent use.

1. **Reset barriers** (DevTools / invoke): `reset_test_barriers`
2. **Session A:** send a turn that calls `test_barrier_tool` with `barrier_id=soak-crash-a` (do **not** release)
3. **Session B:** same with `barrier_id=soak-crash-b` (leave waiting)
4. Confirm both are mid-tool (Stop visible / waiting UI); optionally poll `barrier_waiter_count`
5. **Kill the app process** (OS force-quit / `kill -9` on the Tauri pid) — do **not** press Stop
6. **Reopen** the app (same profile / DB)
7. **Expect session A:** interrupted hydrate notice (`Tool run interrupted before completion…`); **no** dangling tool_calls in follow-up history
8. **Expect session B:** either still waiting (if native barrier state was process-local — then it should terminalize on hydrate too) **or** clean sibling with **no ghost notice copied from A**. After hydrate, B must not show A's tool names as its own cancel.
9. **Follow-up on A:** send a short user message — model / `buildApiMessages` path must see interrupted terminal marker and must **not** re-request the crashed barrier as if it succeeded
10. Optional forensics: `__PIPI_RUNTIME_DIAG__.dump()` / `__PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId })`

### Pass / fail

| Check | Pass |
| --- | --- |
| A after reopen | Interrupted notice present; 0 orphan tool_calls |
| Follow-up A | No resume-as-success; user can start a new turn |
| B | No cross-session cancel notice from A |
| Orphan resume | Failed if follow-up history still has open `tool_calls` for the killed barrier |

### Known limits (intentionally deferred)

- True mid-`COMMIT` WAL tear (kill during the single `db_save_messages` transaction) still depends on SQLite atomicity; not fault-injected here
- Live UI Stop / session-switch polish is **out of scope** for this knife
- Native barrier waiters do not survive process death (expected) — durable signal is **message history** + hydrate terminalize
- Chat must call `persistAssistantPendingToolCalls` before waiting on a tool batch (cleared after batch). Without that, kill mid-tool leaves blank assistants with NULL `tool_calls` and hydrate skips the notice

## Related

- [`soak-runner.md`](./soak-runner.md) — knife 1 Manual D loop + failure bundle
- [`soak-polish-plan.md`](./soak-polish-plan.md)
- [`interrupted-turn-persistence.md`](./interrupted-turn-persistence.md)
- [`cancellation-persistence-matrix.md`](./cancellation-persistence-matrix.md)
- Rust barrier: `src-tauri/src/tools/test_barrier.rs`
