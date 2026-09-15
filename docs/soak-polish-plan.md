# Soak / product-polish plan (GPT excerpt)

**Saved:** 2026-09-15 (America/Toronto)  
**Context:** Post-★★★★★ product gaps; first soak knife after Manual D harness (#83) + diagnostics (#84) + trace sink (#82).

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

## Later polish leftovers (not this knife)

From scout (`docs/soak-polish-scout.md`):

- Truncated replies / provider stream finalize
- Project Folder binding UX (GTK dialog / unbound denial)
- Danger mode defaults affordance
- Stop button visibility during short streams

## Entry points (paths only)

```
src/core/runtime/soak/
src/core/runtime/__tests__/manualDProductHarness.ts
src/core/runtime/__tests__/manualDProductHarness.test.ts
src/core/runtime/__tests__/manualDBarrier.ts
docs/soak-runner.md
docs/soak-polish-scout.md
```
