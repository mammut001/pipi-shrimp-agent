# Runtime diagnostics snapshot runbook (GPT P2 #6)

**Status:** **DONE** — landed in #84 (`375b326`); this doc is the canonical close-out runbook.

**Goal:** One-command DevTools view of live `SessionRuntime`s (P2 #6) plus filtered ring-buffer export (P2 #7).

**Principle:** **prove + persist + observe**, not redesign. No OpenTelemetry; no `SessionRuntime` / `queryLoop` rewrite.

## Key paths

| Layer | Path | Role |
|-------|------|------|
| getSnapshot | `src/core/runtime/SessionRuntime.ts` (`SessionRuntimeSnapshot` + `getSnapshot`) | identity + state + pending tool waits |
| dump APIs | `listLiveRuntimeSnapshots` / `dumpRuntimeDiagnostics` / `installRuntimeDiagnosticsDevDump` | all-live-session dump |
| exports | `src/core/runtime/index.ts` | public re-exports |
| tests | `src/core/runtime/__tests__/RuntimeDiagnostics.test.ts` | P2 #6 suite (+ P2 #7 filter tests in same file) |
| soak consumer | `src/core/runtime/soak/failureBundle.ts` | writes `dumpRuntimeDiagnostics()` on failure |

## Snapshot fields (`getSnapshot`)

Introspection snapshot for correlating identity, lifecycle state, and pending tool channels:

| Field | Notes |
| --- | --- |
| `sessionId`, `runtimeId` | Identity spine (#78) |
| `activeTurnId` | Live turn only (null when idle / cancelling / terminal) |
| `turnId` | Raw active-turn record (may remain while cancelling) |
| `state` | `idle` / turn lifecycle (`created`, `running`, `waiting_tool`, `cancelling`, `terminal`) |
| `pendingToolCount` | Approx. tools waiting on the result channel |
| `waitingRequestIds` | Pending tool-result request IDs |
| `disposed` | Runtime disposed flag |

## Dump all live sessions

In DevTools console or Node/browser global:

```js
__PIPI_RUNTIME_DIAG__.dump()
__PIPI_RUNTIME_DIAG__.getSnapshots()
```

TypeScript / module import:

```ts
import { dumpRuntimeDiagnostics, listLiveRuntimeSnapshots } from '@/core/runtime';
```

## Trace export (ring buffer from #82)

> [!NOTE]
> P2 #7 filtered trace export (`__PIPI_RUNTIME_TRACE__`) is related but separate from the diagnostics snapshot. Diagnostics snapshots capture point-in-time runtime state; the trace sink records structured lifecycle events in a fixed-size ring buffer for race forensics. See [`runtime-trace-sink.md`](./runtime-trace-sink.md) for trace sink details and event taxonomy.

```js
__PIPI_RUNTIME_TRACE__.dumpJsonLines()
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId: 's1', limit: 50 })
```

Identity/status only — no tool argument payloads. See also [`runtime-trace-sink.md`](./runtime-trace-sink.md).

## How to run

```bash
# From repo root (/workspace/pipi-shrimp-agent)

# Primary diagnostics test suite
pnpm exec jest src/core/runtime/__tests__/RuntimeDiagnostics.test.ts --runInBand --no-coverage

# Optional pattern filter (prefer plural --testPathPatterns)
./node_modules/.bin/jest --testPathPatterns='RuntimeDiagnostics' --runInBand --no-coverage
```

Short soak loop (N=10 stop-on-fail):

```bash
N=10
for i in $(seq 1 "$N"); do
  echo "=== runtime diagnostics soak $i/$N ==="
  pnpm exec jest \
    src/core/runtime/__tests__/RuntimeDiagnostics.test.ts \
    --runInBand --no-coverage \
    || { echo "FAILED at iteration $i"; exit 1; }
done
echo "runtime diagnostics soak: $N/$N passed"
```

## Out of scope / deferred

- No OpenTelemetry integration or external distributed tracing dependencies
- No `SessionRuntime` / `queryLoop` rewrite
- Knife 7 trace retention/export policy is separate (see [`runtime-trace-sink.md`](./runtime-trace-sink.md))
- No large E2E / browser automation framework; verified via unit and soak harnesses

## Related

- [`runtime-trace-sink.md`](./runtime-trace-sink.md) — Structured ring-buffer trace sink for race forensics (P0 #3 / P2 #7)
- [`gpt-next-gaps-guidance.md`](./gpt-next-gaps-guidance.md) — Knife progression and principles
- [`soak-polish-scout.md`](./soak-polish-scout.md) — Soak and product-polish entry points
- [`soak-runner.md`](./soak-runner.md) — Soak runner and failure bundle automation (`failureBundle.ts`)

