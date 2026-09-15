# Soak runner + failure bundle

**Goal (GPT soak P0 knife 1):** Deterministic Manual D–style soak loop that dumps a failure bundle on the first invariant break. Prove + persist + observe — no `SessionRuntime` / `queryLoop` rewrite, no Playwright platform, no OpenTelemetry.

**Scout:** [`soak-polish-scout.md`](./soak-polish-scout.md)

## What it reuses

| Piece | Source |
| --- | --- |
| Manual D dual-session scenario | `src/core/runtime/__tests__/manualDProductHarness.test.ts` |
| Deterministic barriers | `src/core/runtime/__tests__/manualDBarrier.ts` |
| Diagnostics dump | `dumpRuntimeDiagnostics` / `__PIPI_RUNTIME_DIAG__` (#84) |
| Filtered traces | `dumpJsonLines({ sessionId, limit })` / `sharedRuntimeTraceSink` (#82) |
| Orphan / terminalize checks | `listOrphanToolCalls` / `terminalizeInterruptedMessages` (#80/#81) |

## Module

```
src/core/runtime/soak/
  runSoak.ts          # runSoakIteration + runSoak + history helpers
  failureBundle.ts    # writeSoakFailureBundle
  types.ts
  index.ts
  soakRunner.test.ts  # Jest entry (default N=5 / N=10)
```

### Iteration shape

Each `runSoakIteration()`:

1. A and B enter `waiting_tool` behind Manual D barriers (no sleeps)
2. Cancel A while B still waiting
3. Late A tool submit → discarded (`false`)
4. B submit succeeds; B wait resolves
5. Trace checks: A cancel/discard chain; B never cancelled
6. **Real A/B message histories** — produce (or accept via `SoakIterationOptions`) scenario histories; run `listOrphanToolCalls` / `terminalizeInterruptedMessages` on them (not latch/mock-only)
7. Follow-up: new A turn after terminal; submit with old turnId must discard; correct turnId succeeds

### Message-history invariants (A/B)

Histories are scenario-accurate by default (`buildSoakScenarioHistories`):

| Session | History shape | Checks |
| --- | --- | --- |
| **A** (cancelled) | user + assistant with dangling `tool-a` tool_call | orphans before terminalize; **0** after; cancel notice must not look like success |
| **B** (success) | user + assistant `tool-b` + matching `__TOOL_RESULT__` | **0** orphans; terminalize must be a no-op |

Callers may pass `historyA` / `historyB` to assert against external session snapshots.

### Invariants

- **no_cross_session_cancel** — B still succeeds after A cancel (latches + B history clean)
- **no_orphan_tool_calls** — terminalized **A** history has no dangling tool_calls; **B** history never has orphans
- **no_cancelled_as_success** — A rejects with `AbortError` / terminal; A notice is cancel/interrupted (not success); A history must not resolve cancelled tools as success
- **no_stale_replay_late_a_discarded** — late A + post-switch stale submit discarded

### `stopOnFailure` semantics

| Option | Behavior |
| --- | --- |
| `stopOnFailure: true` (default) | On first failed iteration: write failure bundle, release sessions, **stop**. `iterationsCompleted` = fail index. |
| `stopOnFailure: false` | On failure: write failure bundle, release sessions, **continue** remaining iterations. Still records every failure in `results` (+ `failureBundleDirs`). `ok` is false if any iteration failed; `failedAt` is the first failure index. |

## Failure bundle

On each failed iteration (and stop if `stopOnFailure`), writes under `artifacts/soak/pipi-soak-failure-<ts>/` (or `/tmp/…`, or `PIPI_SOAK_ARTIFACT_DIR`):

| File | Contents |
| --- | --- |
| `meta.json` | iteration, session ids, assertion message, failures[] |
| `diagnostics.json` | `dumpRuntimeDiagnostics()` snapshot |
| `trace-<sessionA>.jsonl` | filtered A traces |
| `trace-<sessionB>.jsonl` | filtered B traces |
| `trace-all.jsonl` | full ring buffer dump |

## How to run

```bash
# Short (CI default inside soakRunner.test.ts): N=5 and N=10
pnpm exec jest src/core/runtime/soak/soakRunner.test.ts --runInBand --no-coverage

# Long soak via env (also enables the opt-in long describe when >= 20)
PIPI_SOAK_ITERS=200 pnpm exec jest src/core/runtime/soak/soakRunner.test.ts --runInBand --no-coverage
PIPI_SOAK_ITERS=500 pnpm exec jest src/core/runtime/soak/soakRunner.test.ts --runInBand --no-coverage

# Programmatic default (50) — CI-friendly library default
#   import { runSoak } from '@/core/runtime/soak';
#   await runSoak(); // 50
#   await runSoak({ iterations: 200 });
#   await runSoak({ iterations: 10, stopOnFailure: false }); // continue-after-fail
```

Prefer `--testPathPatterns` (plural) or a direct file path. See scout notes on Jest CLI.

## Related docs

- [`gpt-next-gaps-guidance.md`](./gpt-next-gaps-guidance.md)
- [`runtime-diagnostics-snapshot.md`](./runtime-diagnostics-snapshot.md)
- [`runtime-trace-sink.md`](./runtime-trace-sink.md)
- [`soak-polish-plan.md`](./soak-polish-plan.md)
