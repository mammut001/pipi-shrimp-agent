# Runtime trace retention / export runbook (GPT P2 #7)

**Status:** **DONE** — ring-buffer sink landed in #82 (`1086412`); filtered
`dumpJsonLines({ sessionId, limit })` + DevTools install in #84 (`2537af7` /
merge `375b326`). This doc is the canonical close-out runbook.

**Goal:** Light trace **retention** (fixed-size in-process ring) + **export**
(JSON Lines, optional session/limit filter) for Manual D / race forensics —
not scattered `console.log`s, and **no OpenTelemetry**.

**Principle:** **prove + persist + observe**, not redesign. No
`SessionRuntime` / `queryLoop` rewrite; identity + status only (no tool
argument payloads / secrets).

Companion: P0 #3 (usable race-forensics surface) is the same sink; P2 #7 is
the light retention/export policy close-out (`sessionId` / `limit` dump).

## Key paths

| Layer | Path | Role |
|-------|------|------|
| Ring + dump | `src/core/runtime/RuntimeTraceSink.ts` | `DEFAULT_RUNTIME_TRACE_CAPACITY` (1000), `createRuntimeTraceRingBuffer`, `sharedRuntimeTraceSink`, `dumpRuntimeTraceJsonLines` / `getRuntimeTraceEvents`, `installRuntimeTraceDevDump` |
| Event types | `src/core/runtime/RuntimeTrace.ts` | `RuntimeTraceEvent` / `RuntimeTraceContext` / `TraceSink` |
| Host wiring | `src/core/runtime/tauriRuntimeHost.ts` | Production `host.trace` → shared sink; installs `__PIPI_RUNTIME_TRACE__` |
| Exports | `src/core/runtime/index.ts` | Public re-exports |
| Filter tests (P2 #7) | `src/core/runtime/__tests__/RuntimeDiagnostics.test.ts` | `describe('Trace export filter (P2 #7)')` |
| Sink unit tests | `src/core/runtime/__tests__/RuntimeTraceSink.test.ts` | capacity / dump / DevTools install |
| Soak consumer | `src/core/runtime/soak/failureBundle.ts` | Failure bundle may include trace dump |

## Retention policy (light)

| Policy | Behavior |
|--------|----------|
| Capacity | Default **1000** events (`DEFAULT_RUNTIME_TRACE_CAPACITY`); oldest dropped when full |
| Process scope | In-memory `sharedRuntimeTraceSink` only — **not** durable across process restart |
| Payload | Identity + status fields only (`sessionId`, `runtimeId`, `turnId`, `requestId`, `toolCallId`, `executionId`, `reason`, …) — **no** tool args / secrets |
| Clear | `clear()` / `clearRuntimeTraceSink()` for tests or a fresh dump window |

No OpenTelemetry exporters, no external collectors, no disk rotation policy.

## Export API

```js
// DevTools / globalThis — full ring as JSON Lines
__PIPI_RUNTIME_TRACE__.dumpJsonLines()
__PIPI_RUNTIME_TRACE__.getEvents()
__PIPI_RUNTIME_TRACE__.clear()
__PIPI_RUNTIME_TRACE__.size()

// Recent N and/or filter by sessionId (no tool payloads)
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ limit: 50 })
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId: 'manual-d-a', limit: 100 })
```

TypeScript / module import:

```ts
import {
  dumpRuntimeTraceJsonLines,
  getRuntimeTraceEvents,
  clearRuntimeTraceSink,
} from '@/core/runtime';

dumpRuntimeTraceJsonLines({ sessionId: 's1', limit: 40 });
```

Filter semantics (`RuntimeTraceDumpOptions`):

1. Optional `sessionId` — keep events where `context.sessionId` matches
2. Optional `limit` — after session filter, keep only the **most recent** N
3. Dump order remains oldest → newest

Grep one session chain from a saved file:

```bash
rg 'manual-d-a' runtime-trace.jsonl
rg 'tool_result_discarded|tombstoned_late_result' runtime-trace.jsonl
```

## Event names

| Event | Typical source |
| --- | --- |
| `turn_started` / `turn_waiting_tool` / `turn_cancelling` / `turn_terminal` | `SessionRuntime` |
| `tool_requested` | `markWaitingTool` + chat tool start |
| `tool_execution_started` / `tool_completed` / `tool_cancelled` | chat tool execution / cancel paths (`tool_completed` reason `metadata_unavailable` on metadata-load failure) |
| `tool_cancel_requested` | `SessionRuntime.cancel`, `stopGeneration` |
| `tool_result_discarded` | late / mismatched `ToolResultChannel` submit (`reason` e.g. `tombstoned_late_result`); also `runtime_released_late_submit` when submit happens after release |
| `runtime_released` | `releaseSessionRuntime` |

### Concurrent vs serial tool chains

Both paths emit the same greppable identity spine per tool call:

`tool_requested` → `tool_execution_started` → `tool_completed` / `tool_cancelled`

- **Concurrent** (`executeConcurrentTools`): full chain for executed tools; blocked/invalid tools still close with `tool_requested` → `tool_completed` (no start).
- **Serial early returns** (policy reject, permission deny, hook block, local helpers): always emit a terminal `tool_completed` / `tool_cancelled` after `tool_requested` so chains do not hang open.
- **`runTurn` early abort** (pre-aborted signal): still emits `turn_terminal` into the host/shared sink.
- **Late submit after release**: `submitSessionToolResults` records `tool_result_discarded` with `reason: runtime_released_late_submit` into `sharedRuntimeTraceSink` (not console-only).

## How to run

```bash
# From repo root (/workspace/pipi-shrimp-agent)

# P2 #7 filter suite (lives in RuntimeDiagnostics.test.ts)
pnpm exec jest src/core/runtime/__tests__/RuntimeDiagnostics.test.ts --runInBand --no-coverage

# Ring-buffer unit suite
pnpm exec jest src/core/runtime/__tests__/RuntimeTraceSink.test.ts --runInBand --no-coverage

# Optional pattern filter (prefer plural --testPathPatterns)
./node_modules/.bin/jest --testPathPatterns='RuntimeTraceSink|RuntimeDiagnostics' --runInBand --no-coverage
```

Short soak loop (N=10 stop-on-fail):

```bash
N=10
for i in $(seq 1 "$N"); do
  echo "=== runtime trace export soak $i/$N ==="
  pnpm exec jest \
    src/core/runtime/__tests__/RuntimeDiagnostics.test.ts \
    src/core/runtime/__tests__/RuntimeTraceSink.test.ts \
    --runInBand --no-coverage \
    || { echo "FAILED at iteration $i"; exit 1; }
done
echo "runtime trace export soak: $N/$N passed"
```

## Out of scope / deferred

- No OpenTelemetry stack / OTLP exporters / span processors
- No `SessionRuntime` / `queryLoop` rewrite
- No durable cross-process retention / disk rotation (in-memory ring only)
- No Tauri IPC required for dump (optional later)
- P2 #6 live diagnostics snapshot is separate — see [`runtime-diagnostics-snapshot.md`](./runtime-diagnostics-snapshot.md)

## Related

- [`runtime-diagnostics-snapshot.md`](./runtime-diagnostics-snapshot.md) — P2 #6 live `SessionRuntime` dump (`__PIPI_RUNTIME_DIAG__`)
- [`manual-d-product-harness.md`](./manual-d-product-harness.md) — Manual D greppable dual-session harness
- [`gpt-next-gaps-guidance.md`](./gpt-next-gaps-guidance.md) — Knife progression and principles
- [`soak-polish-scout.md`](./soak-polish-scout.md) — Soak and product-polish entry points
- [`soak-runner.md`](./soak-runner.md) — Soak runner + failure bundle
