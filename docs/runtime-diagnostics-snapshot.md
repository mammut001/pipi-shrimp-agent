# Runtime diagnostics snapshot

**Goal:** One-command DevTools view of live `SessionRuntime`s (P2 #6) plus filtered ring-buffer export (P2 #7). No OpenTelemetry; no SessionRuntime rewrite.

## Snapshot fields (`getSnapshot`)

| Field | Notes |
| --- | --- |
| `sessionId`, `runtimeId` | Identity spine (#78) |
| `activeTurnId` | Live turn only |
| `turnId` | Raw active-turn record (may remain while cancelling) |
| `state` | `idle` / turn lifecycle |
| `pendingToolCount` | Approx. tools waiting on the result channel |
| `waitingRequestIds` | Pending tool-result request IDs |
| `disposed` | Runtime disposed flag |

## Dump all live sessions

```js
__PIPI_RUNTIME_DIAG__.dump()
__PIPI_RUNTIME_DIAG__.getSnapshots()
```

```ts
import { dumpRuntimeDiagnostics, listLiveRuntimeSnapshots } from '@/core/runtime';
```

## Trace export (ring buffer from #82)

```js
__PIPI_RUNTIME_TRACE__.dumpJsonLines()
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId: 's1', limit: 50 })
```

Identity/status only — no tool argument payloads. See also [`runtime-trace-sink.md`](./runtime-trace-sink.md).
