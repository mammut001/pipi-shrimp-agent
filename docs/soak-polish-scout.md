# Soak / product-polish scout (entry points only)

**Scout date:** 2026-09-15 (America/Toronto)  
**Repo tip:** `375b326` (`Merge pull request #84 … runtime-diagnostics-snapshot`)  
**Scope:** Scout only — no rewrite, no PR.

Principle (from `docs/gpt-next-gaps-guidance.md`): prove + persist + observe; do not rewrite `SessionRuntime` / `queryLoop`.

---

## 1. Manual D / test_barrier / manualD harness

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
| **Project Folder binding UX** | Unbound Project Folder → workspace tools `permission_denied` (**EXPECTED**); Manual D UI blocked by **GTK folder dialog**; PERF “earlier blockers: unbound Project Folder” | UI: `src/components/chatInput/SessionFolderChip.tsx`, bind handlers in `src/components/ChatInput.tsx`; store: `bindSessionProjectDir` / `setSessionWorkDirFromPath` (`src/store/createChatStore.ts`); concepts: `docs/concepts/folders-and-runs.md`; tests: `src/store/__tests__/setSessionWorkDirFromPath.test.ts`, `src/components/__tests__/workspaceCopy.test.ts` |
| **Danger mode defaults** | Fresh sessions **default to Ask** (`docs/concepts/execution-modes.md`, `session_service.rs`); Manual D notes cite **danger/long-running UX** friction; PERF scenarios ran with **Danger ON** | Registry: `src/services/executionMode/registry.ts` (`isDefault: true` on Ask only); UI dropdown + warning copy in ChatInput / i18n `executionMode.*`; tests: `src/services/executionMode/__tests__/registry.test.ts`. Polish angle: clearer “need Danger for tools” affordance / fewer long-running approval stalls when intentionally in Danger. |
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
docs/concepts/folders-and-runs.md
docs/concepts/execution-modes.md
pr73_stabilization_report.md          # truncation / Manual D UI / folder denial
perf-runtime-post-merge.md            # jest CLI tips + Stop/folder blockers
```
