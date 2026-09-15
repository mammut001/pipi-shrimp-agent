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
  runSoak.ts          # runSoakIteration + runSoak
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
6. Orphan invariant via terminalize on synthetic dangling history
7. Follow-up: new A turn after terminal; submit with old turnId must discard; correct turnId succeeds

### Invariants

- **no_cross_session_cancel** — B still succeeds after A cancel
- **no_orphan_tool_calls** — terminalized history has no dangling tool_calls
- **no_cancelled_as_success** — A rejects with `AbortError` / terminal; not a successful wait
- **no_stale_replay_late_a_discarded** — late A + post-switch stale submit discarded

## Failure bundle

On first failure, writes under `artifacts/soak/pipi-soak-failure-<ts>/` (or `/tmp/…`, or `PIPI_SOAK_ARTIFACT_DIR`):

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
```

Prefer `--testPathPatterns` (plural) or a direct file path. See scout notes on Jest CLI.

## Related docs

- [`gpt-next-gaps-guidance.md`](./gpt-next-gaps-guidance.md)
- [`runtime-diagnostics-snapshot.md`](./runtime-diagnostics-snapshot.md)
- [`runtime-trace-sink.md`](./runtime-trace-sink.md)
- [`soak-polish-plan.md`](./soak-polish-plan.md)
