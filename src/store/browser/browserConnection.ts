export type CdpStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type AttachFailureReason =
  | 'chrome_needs_restart'
  | 'debug_port_unavailable'
  | 'connect_failed'
  | 'unknown';

export interface BrowserConnectionStatePayload {
  connected: boolean;
  launch_mode: string | null;
  health_status: string;
  health_failures: number;
  health_last_transition_at_ms: number;
  websocket_url: string | null;
  current_url: string | null;
  last_error: string | null;
  target_id: string | null;
  session_id: string | null;
  last_activity_at_ms: number;
  idle_timeout_ms: number;
}

export const inferAttachFailureReason = (message: string | null): AttachFailureReason | null => {
  if (!message) {
    return null;
  }

  if (message.includes('CHROME_NEEDS_RESTART')) {
    return 'chrome_needs_restart';
  }

  if (message.includes('9222') || message.includes('调试端点') || message.includes('debugging endpoint')) {
    return 'debug_port_unavailable';
  }

  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes('connect') ||
    lowerMessage.includes('连接') ||
    lowerMessage.includes('connection refused') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('etimedout') ||
    lowerMessage.includes('network unreachable') ||
    lowerMessage.includes('timed out')
  ) {
    return 'connect_failed';
  }

  return 'unknown';
};

export const toCdpStatus = (
  connectionState: BrowserConnectionStatePayload | null,
  previousStatus: CdpStatus,
): CdpStatus => {
  if (!connectionState) {
    return previousStatus === 'connecting' ? 'connecting' : 'disconnected';
  }

  if (connectionState.connected) {
    return 'connected';
  }

  if (connectionState.health_status === 'connecting' || connectionState.health_status === 'reconnecting') {
    return 'connecting';
  }

  if (previousStatus === 'connecting' && !connectionState.last_error) {
    return 'connecting';
  }

  if (connectionState.health_status === 'failed' || connectionState.last_error) {
    return 'error';
  }

  return 'disconnected';
};
