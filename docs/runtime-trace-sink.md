# Runtime trace sink (race forensics)

**Goal:** One greppable Manual D surface for independent session/runtime/turn/tool chains — not scattered `console.log`s.

## What it is

- `RuntimeTraceContext` / `host.trace` (from #78) plus a **structured ring-buffer sink** (default capacity **1000**).
- Production default: `createTauriRuntimeHost().trace` → `sharedRuntimeTraceSink.record`.
- Events are **identity + status only** (no tool argument payloads / secrets).

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

Common fields: `sessionId`, `runtimeId`, `turnId`, `requestId`, `toolCallId`, `executionId`, `reason`.

## Dump (dev)

```js
// DevTools / globalThis — full ring buffer as JSON Lines
__PIPI_RUNTIME_TRACE__.dumpJsonLines()
__PIPI_RUNTIME_TRACE__.getEvents()
__PIPI_RUNTIME_TRACE__.clear()

// Recent N events and/or filter by sessionId (no tool payloads)
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ limit: 50 })
__PIPI_RUNTIME_TRACE__.dumpJsonLines({ sessionId: 'manual-d-a', limit: 100 })
```

Or import:

```ts
import { dumpRuntimeTraceJsonLines, getRuntimeTraceEvents } from '@/core/runtime';

dumpRuntimeTraceJsonLines({ sessionId: 's1', limit: 40 });
```

Grep one session chain:

```bash
# from a saved dump file
rg 'manual-d-a' runtime-trace.jsonl
rg 'tool_result_discarded|tombstoned_late_result' runtime-trace.jsonl
```

## Runtime diagnostics snapshot (dev)

Live session/runtime introspection (extends `getSnapshot` from #78):

| Field | Meaning |
| --- | --- |
| `sessionId` / `runtimeId` | Identity spine |
| `activeTurnId` | Live turn only (`null` when idle/cancelling/terminal) |
| `turnId` | Raw active-turn record id (may still be set while cancelling) |
| `state` | `idle` / `created` / `running` / `waiting_tool` / `cancelling` / `terminal` |
| `pendingToolCount` | Approximate tools still waiting on the result channel |
| `waitingRequestIds` | Pending tool-result request IDs |

```js
// One command: snapshots for all live sessions
__PIPI_RUNTIME_DIAG__.dump()
__PIPI_RUNTIME_DIAG__.getSnapshots()
```

```ts
import { dumpRuntimeDiagnostics, listLiveRuntimeSnapshots } from '@/core/runtime';

console.log(dumpRuntimeDiagnostics());
```

## Non-goals

- No OpenTelemetry stack.
- No `SessionRuntime` / `queryLoop` lifecycle rewrite.
- No Tauri IPC required for the dump (optional later).
