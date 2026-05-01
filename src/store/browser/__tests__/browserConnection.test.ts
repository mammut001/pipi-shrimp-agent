import { describe, expect, it } from '@jest/globals';
import {
  inferAttachFailureReason,
  toCdpStatus,
  type BrowserConnectionStatePayload,
} from '../browserConnection';

function connectionState(overrides: Partial<BrowserConnectionStatePayload>): BrowserConnectionStatePayload {
  return {
    connected: false,
    launch_mode: null,
    health_status: 'disconnected',
    health_failures: 0,
    health_last_transition_at_ms: 0,
    websocket_url: null,
    current_url: null,
    last_error: null,
    target_id: null,
    session_id: null,
    last_activity_at_ms: 0,
    idle_timeout_ms: 0,
    ...overrides,
  };
}

describe('browserConnection helpers', () => {
  it('classifies common attach failures', () => {
    expect(inferAttachFailureReason('CHROME_NEEDS_RESTART')).toBe('chrome_needs_restart');
    expect(inferAttachFailureReason('debugging endpoint 9222 unavailable')).toBe('debug_port_unavailable');
    expect(inferAttachFailureReason('connection refused')).toBe('connect_failed');
    expect(inferAttachFailureReason('unexpected browser state')).toBe('unknown');
    expect(inferAttachFailureReason(null)).toBeNull();
  });

  it('keeps reconnecting browser health in connecting UI state', () => {
    expect(toCdpStatus(connectionState({ health_status: 'reconnecting' }), 'connected')).toBe('connecting');
  });

  it('turns failed health or backend errors into error state', () => {
    expect(toCdpStatus(connectionState({ health_status: 'failed' }), 'connected')).toBe('error');
    expect(toCdpStatus(connectionState({ last_error: 'lost target' }), 'connected')).toBe('error');
  });

  it('preserves a pending connection while backend state has no error yet', () => {
    expect(toCdpStatus(connectionState({ health_status: 'disconnected' }), 'connecting')).toBe('connecting');
  });
});
