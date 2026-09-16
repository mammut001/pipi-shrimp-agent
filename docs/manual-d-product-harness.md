# Manual D product harness runbook (GPT P1 #4)

**Goal:** Repeatable store/runtime boundary verification for dual-session execution:
- **Session A:** cancel while waiting mid-tool
- **Session B:** release/succeed cleanly without interference
- **Late Session A tool submit:** discarded safely (never enters message history)
- **Race forensics:** greppable `RuntimeTraceSink` events across independent session/turn/tool lifecycles

Proves the core product invariant: **prove + persist + observe**, not redesign. Does not rewrite `SessionRuntime` / `queryLoop`.

## Key Paths

| Layer | Path | Role |
| --- | --- | --- |
| **Jest harness test** | `src/core/runtime/__tests__/manualDProductHarness.test.ts` | Unit/integration assertions: A cancel, B success, late A discard, ID pairing, greppable traces |
| **Harness logic** | `src/core/runtime/__tests__/manualDProductHarness.ts` | Reusable dual-session orchestration producing real store-shaped A/B histories |
| **Deterministic latches** | `src/core/runtime/__tests__/manualDBarrier.ts` | `createManualDBarrier` / `awaitCondition` (deterministic event-loop ticks, no wall-clock sleeps) |
| **Concurrent companion** | `src/core/runtime/__tests__/SessionRuntime.concurrent.test.ts` | Low-level concurrent barrier suite on `SessionRuntime` |
| **Rust barrier tool** | `src-tauri/src/tools/test_barrier.rs` | Native `test_barrier_tool`, `release_test_barrier`, `reset_test_barriers`, cancel isolation tests |

## How to Run

### Single Pass (Jest & Rust)

```bash
# From repo root (/workspace/pipi-shrimp-agent)

# 1. Run Manual D product harness test directly
pnpm exec jest src/core/runtime/__tests__/manualDProductHarness.test.ts --runInBand --no-coverage

# 2. Equivalent run via Jest pattern filter (prefer plural --testPathPatterns)
./node_modules/.bin/jest --testPathPatterns='manualDProductHarness' --runInBand --no-coverage

# 3. Run native Rust barrier tests (includes dual-session cancel/release isolation)
cargo test --manifest-path src-tauri/Cargo.toml test_barrier -- --nocapture
```

### Short Soak Loop (N times stop-on-fail)

Run the harness in a shell loop to verify determinism under repeated execution:

```bash
# N=20 stop on first failure
N=20
for i in $(seq 1 "$N"); do
  echo "=== Manual D soak $i/$N ==="
  pnpm exec jest \
    src/core/runtime/__tests__/manualDProductHarness.test.ts \
    --runInBand \
    --no-coverage \
    || { echo "FAILED at iteration $i"; exit 1; }
done
echo "Manual D soak: $N/$N passed"
```

Pattern filter alternative:

```bash
N=10
for i in $(seq 1 "$N"); do
  ./node_modules/.bin/jest --testPathPatterns='manualDProductHarness' --runInBand --no-coverage \
    || { echo "FAILED at iteration $i"; exit 1; }
done
```

Native Rust barrier soak loop:

```bash
N=10
for i in $(seq 1 "$N"); do
  cargo test --manifest-path src-tauri/Cargo.toml test_barrier -- --nocapture \
    || { echo "FAILED at iteration $i"; exit 1; }
done
```

## Forensics & Observability

Inspect runtime traces in DevTools, global environment, or harness outputs:

```js
// Dump recent events for Session A
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId: 'manual-d-product-a', limit: 100 })

// Companion diagnostics dump
__PIPI_RUNTIME_DIAG__.dump()
```

Trace event expectations:
- **Session A:** `turn_cancelling` → `tool_cancel_requested` → `tool_cancelled` → `turn_terminal` → `tool_result_discarded` (for late submit).
- **Session B:** `turn_waiting_tool` → `bAccepted === true`; never receives cancel or terminal events from A.

## Notes & Design Principles

- **No Playwright:** Does not rely on heavy browser UI automation. Jest harness and Rust unit tests exercise the real runtime/store boundaries directly.
- **TS Latches mirror Rust Barrier:** `manualDBarrier.ts` provides `createManualDBarrier` and `awaitCondition` to deterministically pause/resume tool execution without wall-clock sleeps (`setTimeout`).
- **Live Tauri Testing:** Live desktop app manual testing (using `test_barrier_tool` exposed in the tool catalog via PR #92) is optional; see [`soak-crash-reload.md`](./soak-crash-reload.md) for true process-kill checklists.
- **Pull Requests:** Implemented across PR #83 (TS harness & interrupted-turn recovery policy) and PR #92 (native `test_barrier_tool` exposed in model tool catalog).

## Related Links

- [`soak-runner.md`](./soak-runner.md) — Soak runner and failure bundle automation (Knife 1)
- [`soak-crash-reload.md`](./soak-crash-reload.md) — Mid-tool crash/reload durability and manual Tauri checklist (Knife 2)
- [`soak-polish-scout.md`](./soak-polish-scout.md) — Scout notes on Manual D entry points and polish leftovers
- [`interrupted-turn-recovery-policy.md`](./interrupted-turn-recovery-policy.md) — Recovery rules for interrupted/cancelled turns
- [`runtime-trace-sink.md`](./runtime-trace-sink.md) — Structured ring-buffer trace sink for race forensics
- [`gpt-next-gaps-guidance.md`](./gpt-next-gaps-guidance.md) — Gap guidance and knife progression
