/**
 * Unified trace contract for session / runtime / turn / request / tool call.
 *
 * Forms a single identity spine so logs, tests, and host sinks can correlate
 * events without ad-hoc string parsing. Payloads and secrets must never appear
 * in trace events — identity and status fields only.
 */
export interface RuntimeTraceContext {
  sessionId: string;
  runtimeId: string;
  turnId?: string;
  requestId?: string;
  toolCallId?: string;
  executionId?: string;
}

export type RuntimeTraceEventName =
  | 'turn_started'
  | 'turn_waiting_tool'
  | 'turn_cancelling'
  | 'turn_terminal'
  | 'tool_requested'
  | 'tool_execution_started'
  | 'tool_cancel_requested'
  | 'tool_cancelled'
  | 'tool_completed'
  | 'tool_result_discarded'
  | 'runtime_released';

export interface RuntimeTraceEvent {
  type: RuntimeTraceEventName;
  /** Epoch millis when the event was emitted. */
  at: number;
  context: RuntimeTraceContext;
  /** Status / discard / cancel reason — never tool argument payloads. */
  reason?: string;
}

/** Optional injectable sink; default hosts omit it (no-op). */
export type TraceSink = (event: RuntimeTraceEvent) => void;

export interface RuntimeTraceExtras {
  turnId?: string;
  requestId?: string;
  toolCallId?: string;
  executionId?: string;
  reason?: string;
}
