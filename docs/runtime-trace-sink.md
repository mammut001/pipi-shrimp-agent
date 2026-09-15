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
| `tool_execution_started` / `tool_completed` / `tool_cancelled` | chat tool execution / cancel paths |
| `tool_cancel_requested` | `SessionRuntime.cancel`, `stopGeneration` |
| `tool_result_discarded` | late / mismatched `ToolResultChannel` submit (`reason` e.g. `tombstoned_late_result`) |
| `runtime_released` | `releaseSessionRuntime` |

Common fields: `sessionId`, `runtimeId`, `turnId`, `requestId`, `toolCallId`, `executionId`, `reason`.

## Dump (dev)

```js
// DevTools / globalThis
__PIPI_RUNTIME_TRACE__.dumpJsonLines()
__PIPI_RUNTIME_TRACE__.getEvents()
__PIPI_RUNTIME_TRACE__.clear()
```

Or import:

```ts
import { dumpRuntimeTraceJsonLines, getRuntimeTraceEvents } from '@/core/runtime';
```

Grep one session chain:

```bash
# from a saved dump file
rg 'manual-d-a' runtime-trace.jsonl
rg 'tool_result_discarded|tombstoned_late_result' runtime-trace.jsonl
```

## Non-goals

- No OpenTelemetry stack.
- No `SessionRuntime` / `queryLoop` lifecycle rewrite.
- No Tauri IPC required for the dump (optional later).
