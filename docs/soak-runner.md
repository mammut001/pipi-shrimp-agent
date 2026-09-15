# Soak runner + failure bundle

**Goal (GPT soak P0 knife 1):** Deterministic Manual D–style soak loop that dumps a failure bundle on the first invariant break. Prove + persist + observe — no `SessionRuntime` / `queryLoop` rewrite, no Playwright platform, no OpenTelemetry.

**Scout:** [`soak-polish-scout.md`](./soak-polish-scout.md)

## What it reuses

| Piece | Source |
| --- | --- |
| Manual D dual-session scenario | `src/core/runtime/__tests__/manualDProductHarness.ts` (+ `.test.ts`) |
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
src/core/runtime/__tests__/manualDProductHarness.ts  # reusable harness + product histories
```

### Iteration shape

Each `runSoakIteration()`:

1. Runs **`runManualDProductHarness`** — A and B enter `waiting_tool` behind Manual D barriers (no sleeps)
2. Cancel A while B still waiting → harness applies product `terminalizeInterruptedMessages(..., user_cancel)` to A history
3. Late A tool submit → discarded (`false`); late content must **not** appear in A history
4. B submit succeeds; B wait resolves → harness appends matching `__TOOL_RESULT__` to B history
5. Trace checks: A cancel/discard chain; B never cancelled
6. **Real A/B message histories** from the harness (default `historySource: 'manual_d_harness'`); run orphan / cancel-notice / success invariants
7. Follow-up: new A turn after terminal; submit with old turnId must discard; correct turnId succeeds

`buildSoakScenarioHistories()` remains a **unit helper** for isolated history-invariant tests only. The default soak path must not rely on it.

### Message-history invariants (A/B)

| Session | History source (default) | Shape | Checks |
| --- | --- | --- | --- |
| **A** (cancelled) | Manual D harness + product terminalize | scrubbed tool_calls + cancel notice | **0** orphans; notice is cancel/interrupted (not success); no `late-a-should-discard` |
| **B** (success) | Manual D harness | assistant `tool-b` + matching `__TOOL_RESULT__:…:b-ok` | **0** orphans; terminalize no-op; successful completion present |

Callers may pass `historyA` / `historyB` to assert against injected snapshots (`historySource: 'injected'`).

### Invariants

- **no_cross_session_cancel** — B still succeeds after A cancel (latches + B history clean + tool result)
- **no_orphan_tool_calls** — terminal **A** history has no dangling tool_calls; **B** history never has orphans
- **no_cancelled_as_success** — A rejects with `AbortError` / terminal; A notice is cancel/interrupted (not success); A history must not resolve cancelled tools as success
- **no_stale_replay_late_a_discarded** — late A + post-switch stale submit discarded; late content absent from A history

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

# Also run Manual D harness suite
pnpm exec jest src/core/runtime/__tests__/manualDProductHarness.test.ts --runInBand --no-coverage

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
