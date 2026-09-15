/**
 * Unified trace contract for session / runtime / turn / request / tool call.
 *
 * Forms a single identity spine so logs, tests, and host sinks can correlate
 * events without ad-hoc string parsing.
 */
export interface RuntimeTraceContext {
  sessionId: string;
  runtimeId: string;
  turnId?: string;
  requestId?: string;
  toolCallId?: string;
}

export type RuntimeTraceEventName =
  | 'turn_started'
  | 'turn_waiting_tool'
  | 'turn_cancelling'
  | 'turn_terminal';

export interface RuntimeTraceEvent {
  type: RuntimeTraceEventName;
  /** Epoch millis when the event was emitted. */
  at: number;
  context: RuntimeTraceContext;
  reason?: string;
}

/** Optional injectable sink; default hosts omit it (no-op). */
export type TraceSink = (event: RuntimeTraceEvent) => void;
