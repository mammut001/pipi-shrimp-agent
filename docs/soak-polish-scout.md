# Soak / product-polish scout (entry points only)

**Scout date:** 2026-09-15 (America/Toronto)  
**Repo tip:** `375b326` (`Merge pull request #84 … runtime-diagnostics-snapshot`)  
**Scope:** Scout only — no rewrite, no PR.

Principle (from `docs/gpt-next-gaps-guidance.md`): prove + persist + observe; do not rewrite `SessionRuntime` / `queryLoop`.

---

## 1. Manual D / test_barrier / manualD harness

**Canonical runbook:** [`manual-d-product-harness.md`](./manual-d-product-harness.md)

### TypeScript (Jest product harness)

| File | Role |
|------|------|
| `src/core/runtime/__tests__/manualDProductHarness.test.ts` | GPT P1 #4 repeatable product harness: dual-session A cancel + B release + late A discard; greppable `RuntimeTraceSink` events |
| `src/core/runtime/__tests__/manualDBarrier.ts` | Deterministic latch (`createManualDBarrier` / `awaitCondition`) — no wall-clock sleeps; mirrors Rust barrier intent |
| `src/core/runtime/__tests__/SessionRuntime.concurrent.test.ts` | Earlier Manual D–style dual-session barrier via `runTurn()` mock (still useful soak companion) |

Docs that name these:

- `docs/gpt-next-gaps-guidance.md` § Next knives (P1) #4
- `docs/interrupted-turn-recovery-policy.md` (Manual D dual-session cancel/late-discard)
- `docs/runtime-trace-sink.md` (Manual D greppable surface; `__PIPI_RUNTIME_TRACE__`)

### Rust (native `test_barrier_tool`)

| File | Role |
|------|------|
| `src-tauri/src/tools/test_barrier.rs` | `test_barrier_tool`, `release_test_barrier`, `reset_test_barriers`; dual-session cancel isolation tests |
| `src-tauri/src/commands/tools.rs` | Tauri commands `release_test_barrier` / `reset_test_barriers` |
| `src-tauri/src/tools/registry.rs` | Registers `test_barrier_tool` (cancellable, concurrency-safe) |
| `src-tauri/src/lib.rs` | Exports barrier commands |

Key cargo tests inside `test_barrier.rs`:

- `dual_session_cancel_a_release_b_isolation`
- `dual_session_cancel_a_release_b_via_registry_scheduler`
- plus release/cancel/reset unit tests

### How to run repeatedly (single pass)

Prefer local Jest binary / `pnpm exec jest` with **`--testPathPatterns`** (plural).  
`pnpm test -- --testPathPattern=…` is known to match zero tests (`perf-runtime-post-merge.md`).

```bash
# From repo root (/workspace/pipi-shrimp-agent)

# Manual D product harness (primary soak target)
pnpm exec jest src/core/runtime/__tests__/manualDProductHarness.test.ts --runInBand --no-coverage

# Equivalent pattern filter
./node_modules/.bin/jest --testPathPatterns='manualDProductHarness' --runInBand --no-coverage

# Companion concurrent barrier suite
./node_modules/.bin/jest --testPathPatterns='SessionRuntime.concurrent' --runInBand --forceExit --no-coverage

# Broader SessionRuntime (includes concurrent + unit)
./node_modules/.bin/jest --testPathPatterns='SessionRuntime' --runInBand --no-coverage

# Rust native barrier (wall mostly compile; body ~0.05s once warm)
cargo test --manifest-path src-tauri/Cargo.toml test_barrier -- --nocapture
```

Optional forensics after a harness run (dev / dump):

```js
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId: 'manual-d-product-a', limit: 100 })
__PIPI_RUNTIME_DIAG__.dump()
```

---

## 1b. Interrupted-turn recovery policy

**Canonical runbook:** [`interrupted-turn-recovery-policy.md`](./interrupted-turn-recovery-policy.md)

| File | Role |
|------|------|
| `src/store/chat/interruptedTurnRecoveryPolicy.ts` | R1–R4 policy constants + pure helpers |
| `src/store/chat/__tests__/interruptedTurnRecoveryPolicy.test.ts` | Deterministic R1–R4 tests |
| `src/store/chat/scrubDanglingToolCalls.ts` | Hydrate terminalize enforcement (#80) |

```bash
pnpm exec jest src/store/chat/__tests__/interruptedTurnRecoveryPolicy.test.ts --runInBand --no-coverage
```

---

## 1c. Runtime diagnostics snapshot

**Canonical runbook:** [`runtime-diagnostics-snapshot.md`](./runtime-diagnostics-snapshot.md)

| File | Role |
|------|------|
| `src/core/runtime/SessionRuntime.ts` | Dump APIs (`dumpRuntimeDiagnostics`, `listLiveRuntimeSnapshots`, `installRuntimeDiagnosticsDevDump`) + `getSnapshot` |
| `src/core/runtime/__tests__/RuntimeDiagnostics.test.ts` | Diagnostics snapshot and filtered trace export suite |
| `src/core/runtime/soak/failureBundle.ts` | Soak failure bundle consumer (`diagnostics.json` via `dumpRuntimeDiagnostics()`) |

```bash
pnpm exec jest src/core/runtime/__tests__/RuntimeDiagnostics.test.ts --runInBand --no-coverage
```

---

## 1d. Trace retention / export (light)

**Canonical runbook:** [`runtime-trace-sink.md`](./runtime-trace-sink.md)

| File | Role |
|------|------|
| `src/core/runtime/RuntimeTraceSink.ts` | Ring buffer (cap 1000), `dumpJsonLines({ sessionId, limit })`, `__PIPI_RUNTIME_TRACE__` |
| `src/core/runtime/__tests__/RuntimeDiagnostics.test.ts` | P2 #7 filter suite (`Trace export filter`) |
| `src/core/runtime/__tests__/RuntimeTraceSink.test.ts` | Capacity / dump / DevTools install |

```bash
pnpm exec jest src/core/runtime/__tests__/RuntimeDiagnostics.test.ts src/core/runtime/__tests__/RuntimeTraceSink.test.ts --runInBand --no-coverage
```

---

## 2. Soak / stress scripts under `tests/` or `docs/`

**None found.**

- No files named `*soak*` / `*stress*` under `tests/` or `docs/`.
- Closest related (not soak loops):
  - `tests/browser/release-gate.sh`, `tests/browser/benchmark-checklist.md`, `tests/browser/smoke-sites.md`
  - `tools/smoke-autoresearch-local.sh` (`pnpm smoke:autoresearch:local`)
  - Root reports (not under docs/tests): `perf-runtime-post-merge.md`, `pr73_stabilization_report.md`

Soak today = re-run Manual D Jest (+ optional Rust `test_barrier`) in a shell loop (see §4).

---

## 3. Cheap product-polish leftovers (mentioned in docs / reports)

Sources: `pr73_stabilization_report.md`, `perf-runtime-post-merge.md`, `docs/concepts/folders-and-runs.md`, `docs/concepts/execution-modes.md`.

| Leftover | What docs say | Concrete entry points |
|----------|---------------|------------------------|
| **Truncated replies** | Smoke `reply only ping-ok` → **INCONCLUSIVE (provider truncation)** — app often returned `ping` only; external `curl` got full `ping-ok` (`pr73_stabilization_report.md`) | **Addressed:** `docs/provider-stream-finalize.md` — leftover SSE flush, OpenAI `Done` on `finish_reason`, `ChatResponse.truncated` + UI notice. Live provider product check still optional. |
| **Project Folder binding UX** | Unbound Project Folder → workspace tools `permission_denied` (**EXPECTED**); Manual D UI blocked by **GTK folder dialog**; PERF “earlier blockers: unbound Project Folder” | **Addressed:** `docs/project-folder-binding-ux.md` — unbound chip hint + greppable denial; titled `open_folder_dialog` + busy guard. Entry: `SessionFolderChip`, `folderDialog.ts`, `workspace.rs`. |
| **Danger mode defaults** | Fresh sessions **default to Ask** (`docs/concepts/execution-modes.md`, `session_service.rs`); Manual D notes cite **danger/long-running UX** friction; PERF scenarios ran with **Danger ON** | **Addressed:** `docs/danger-mode-defaults-affordance.md` — Ask default badge + composer affordance hints; Danger warning clarifies tools active ≠ Bypass auto-approve. Entry: `modeAffordance.ts`, `ExecutionModeDropdown`. |
| **Stop button visibility during stream** | PERF earlier blocker: **stream too short to hit Stop**; Manual D UI: Stop not confirmed / could not reliably click Stop while tools blocked | UI: `src/components/ChatInput.tsx` — Send/Stop toggles on `isStreaming` (~L1000); stop path: `stopGeneration` in `src/store/chat/chatActions.ts`. Soak tip: use a long stream or barrier tool so Stop is visible/clickable before idle. |

Related but already largely fixed (not “cheap leftover” work): Stop mid-stream effectiveness (PR #73 P0-1), cancel follow-up re-request (PR #79) — see `cancel-rerequest-findings.md` / `pr79-gpt-fix-notes.md`.

---

## 4. Run Manual D harness in a loop N times (Jest CLI)

Jest has **no built-in “run suite N times”** flag. Use a shell loop around the same CLI invocation.

```bash
# N=20 example — stop on first failure
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

Alternatives:

```bash
# Pattern filter + local binary
N=10
for i in $(seq 1 "$N"); do
  ./node_modules/.bin/jest --testPathPatterns='manualDProductHarness' --runInBand --no-coverage \
    || exit 1
done

# Include concurrent companion each iteration
N=10
for i in $(seq 1 "$N"); do
  pnpm exec jest \
    src/core/runtime/__tests__/manualDProductHarness.test.ts \
    src/core/runtime/__tests__/SessionRuntime.concurrent.test.ts \
    --runInBand --forceExit --no-coverage \
    || exit 1
done

# Optional: Rust barrier soak (slow first compile)
N=5
for i in $(seq 1 "$N"); do
  cargo test --manifest-path src-tauri/Cargo.toml test_barrier -- --nocapture || exit 1
done
```

Notes:

- Prefer `--runInBand` for deterministic ordering under soak.
- If Jest warns about open handles, add `--forceExit` (as in `perf-runtime-post-merge.md`).
- Do **not** use singular `--testPathPattern` on current Jest; use `--testPathPatterns` or a direct file path.

---

## Quick index (paths only)

```
src/core/runtime/__tests__/manualDProductHarness.test.ts
src/core/runtime/__tests__/manualDBarrier.ts
src/core/runtime/__tests__/SessionRuntime.concurrent.test.ts
src-tauri/src/tools/test_barrier.rs
docs/gpt-next-gaps-guidance.md
docs/runtime-trace-sink.md
docs/interrupted-turn-recovery-policy.md
docs/runtime-diagnostics-snapshot.md
docs/concepts/folders-and-runs.md
docs/concepts/execution-modes.md
pr73_stabilization_report.md          # truncation / Manual D UI / folder denial
perf-runtime-post-merge.md            # jest CLI tips + Stop/folder blockers
```
