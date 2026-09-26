import { getSessionHandle } from '../../core/runtime';

/** Best-effort identity/status trace — never includes tool argument payloads. */
export function emitSessionToolTrace(
  sessionId: string,
  type: 'tool_requested' | 'tool_execution_started' | 'tool_completed' | 'tool_cancel_requested' | 'tool_cancelled',
  extras: {
    toolCallId?: string;
    executionId?: string | null;
    requestId?: string;
    turnId?: string;
    reason?: string;
  } = {},
): void {
  try {
    const handle = getSessionHandle(sessionId);
    handle.emitTraceEvent(type, {
      ...(extras.toolCallId !== undefined ? { toolCallId: extras.toolCallId } : {}),
      ...(extras.executionId ? { executionId: extras.executionId } : {}),
      ...(extras.requestId !== undefined ? { requestId: extras.requestId } : {}),
      ...(extras.turnId !== undefined ? { turnId: extras.turnId } : {}),
      ...(extras.reason !== undefined ? { reason: extras.reason } : {}),
    });
  } catch {
    // Trace must never break tool execution
  }
}

/** Close a tool identity chain with completed/cancelled (never payloads). */
export function emitSessionToolTerminal(
  sessionId: string,
  toolCallId: string,
  status: 'done' | 'failed' | 'rejected' | 'cancelled' | 'timed_out',
  extras: {
    executionId?: string | null;
    requestId?: string;
    turnId?: string;
  } = {},
): void {
  const reason = status === 'done' ? 'success' : status;
  if (status === 'cancelled') {
    emitSessionToolTrace(sessionId, 'tool_cancelled', {
      toolCallId,
      reason,
      ...extras,
    });
    return;
  }
  emitSessionToolTrace(sessionId, 'tool_completed', {
    toolCallId,
    reason,
    ...extras,
  });
}
