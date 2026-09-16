# Soak / product-polish plan (GPT excerpt)

**Saved:** 2026-09-15 (America/Toronto)  
**Context:** Post-★★★★★ product gaps; soak knives after Manual D harness (#83) + diagnostics (#84) + trace sink (#82) + soak runner (#85).

## Principle

**Prove + persist + observe** — do not redesign.

### Do not

- Rewrite `SessionRuntime` / `queryLoop` / new SessionManager
- Actor system / event sourcing / full durable resume of half-run tools
- OpenTelemetry stack; ChatStore rewrite; multi-provider; big E2E / Playwright platform

## Knife 1 (this PR): Soak Runner + failure bundle

Build a **deterministic soak runner** that loops the Manual D style scenario and dumps a failure bundle on invariant break.

### Reuse

- Existing Manual D harness under `src/core/runtime/__tests__/manualD*` / `manualDBarrier` / `manualDProductHarness.test.ts` (#83)
- `dumpRuntimeDiagnostics` / `__PIPI_RUNTIME_DIAG__` (#84)
- `dumpJsonLines({ sessionId, limit })` / `sharedRuntimeTraceSink` (#82)
- hydrate/orphan checks from #80/#81 if useful

### Implement

1. `src/core/runtime/soak/` (or `tests/soak/`) module:
   - `runSoakIteration()` — A/B wait → cancel A → B success → late A discarded → optional switch/follow-up checks
   - `runSoak({ iterations })` — default **50** for CI-friendly; env `PIPI_SOAK_ITERS` for 200–500
2. **Invariants each iteration:**
   - no cross-session cancel (B still succeeds)
   - no orphan tool_calls in terminal histories (where applicable)
   - no cancelled-as-success
   - no stale replay / late A discarded
3. **Failure bundle** on first fail: JSON under `/tmp/pipi-soak-failure-<ts>/` or `artifacts/soak/` with:
   - diagnostics snapshot dump
   - filtered trace JSONL for A and B
   - iteration number + assertion message
4. Jest test: `soakRunner.test.ts` runs N=5 or N=10 by default (fast); documents `PIPI_SOAK_ITERS=200 pnpm exec jest …`
5. Docs: `docs/soak-runner.md` + this plan excerpt


## Knife 2: Real Tauri + SQLite reload/crash soak

**PR target:** kill mid-tool → reopen → hydrate → follow-up (no orphan resume as success, no cross-session contamination).

### Implement

1. `src/core/runtime/soak/crashReloadSoak.ts` — Manual D barriers + InMemoryMessageDb crash simulation + hydrate interrupted + follow-up
2. Jest `crashReloadSoak.test.ts` (default N=5); env `PIPI_CRASH_RELOAD_SOAK_ITERS`
3. Rust: `orphan_messages_survive_db_reopen_after_mid_tool` (connection drop/reopen durability)
4. Docs: `docs/soak-crash-reload.md` including **manual Tauri kill checklist**

### Intentionally not this knife

- Stop button / session-switch UX polish
- Full Playwright E2E platform
- Fault-injected mid-WAL tear during COMMIT


## Knife 3: Stop + session-switch product feel

**PR target:** UI ≤1s cancelled feel on Stop; A stop does not touch B; Stop visible during stream / long tools.

### Implement

1. Optimistic `stopGeneration` UI clear before native `cancel_tool_execution` awaits
2. `shouldShowStopControl` — Stop when streaming **or** pending tools/results (`ChatInput`)
3. Session-switch busy binding — selected session only (`selectSession` + tool-runtime sync)
4. Jest: optimistic clear under slow cancel; A≠B isolation; selector visibility

Docs: `docs/stop-session-switch-polish.md`

### Intentionally not this knife

- Intermediate `cancelling` step status / terminal vocabulary unify — **follow-up** [`cancelling-status-vocab.md`](./cancelling-status-vocab.md)
- Truncated replies / Project Folder / Danger affordance (scout leftovers)
- Full Playwright E2E

## Later polish leftovers (not this knife)

From scout (`docs/soak-polish-scout.md`):

- Truncated replies / provider stream finalize — **addressed** (`docs/provider-stream-finalize.md`)
- Project Folder binding UX (GTK dialog / unbound denial) — **addressed** (`docs/project-folder-binding-ux.md`)
- Danger mode defaults affordance
- Stop button visibility during short streams — **addressed in knife 3** (`shouldShowStopControl`)

## Entry points (paths only)

```
src/core/runtime/soak/
src/core/runtime/soak/crashReloadSoak.ts
src/core/runtime/__tests__/manualDProductHarness.ts
src/core/runtime/__tests__/manualDProductHarness.test.ts
src/core/runtime/__tests__/manualDBarrier.ts
src-tauri/src/tools/test_barrier.rs
docs/soak-runner.md
docs/soak-crash-reload.md
docs/soak-polish-scout.md
```
