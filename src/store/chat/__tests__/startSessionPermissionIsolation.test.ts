/**
 * GPT FIX FIRST #99 residual — startSession must not deny other sessions'
 * pending permission approvals.
 *
 * Proving case: Session A has a pending approval promise → startSession →
 * A's promise must NOT resolve as deny; only selected/new session chrome resets.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@tauri-apps/api/event', () => ({
  listen: jest.fn(async () => jest.fn()),
}));

import { useChatStore } from '../index';
import { useUIStore } from '../../uiStore';
import { createSession } from '../../../types/chat';
import { resetAllSessionToolRuntime } from '../toolRuntimeState';

describe('startSession permission isolation', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    resetAllSessionToolRuntime();
    useUIStore.setState({
      permissionQueue: [],
      permissionLedger: [],
    });

    const session = {
      ...createSession('Chat'),
      id: 'session-A',
    };
    useChatStore.setState({
      sessions: [session],
      projects: [],
      currentSessionId: 'session-A',
      isStreaming: false,
      isInitialized: true,
      streamingContent: '',
      streamingReasoning: '',
      error: null,
      streamingTimeoutId: null,
      lastUiUpdateTime: 0,
      pendingToolCalls: 0,
      pendingToolResults: [],
      streamingSessionId: null,
    });
  });

  afterEach(() => {
    useUIStore.getState().clearAllPermissions();
  });

  it('Session A pending approval → startSession → A promise stays unresolved (not deny)', async () => {
    const pendingA = useUIStore.getState().waitForPermission({
      id: 'perm-a-1',
      name: 'execute_command',
      arguments: '{"command":"echo hi"}',
      sessionId: 'session-A',
    });

    let settled: boolean | null = null;
    void pendingA.then((approved) => {
      settled = approved;
    });

    expect(useUIStore.getState().permissionQueue).toHaveLength(1);
    expect(useUIStore.getState().permissionQueue[0]?.sessionId).toBe('session-A');

    await useChatStore.getState().startSession(null);

    const newSessionId = useChatStore.getState().currentSessionId;
    expect(newSessionId).not.toBe('session-A');
    expect(newSessionId).toBeTruthy();

    // Flush microtasks — startSession must not resolve A's promise as deny.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBeNull();
    expect(useUIStore.getState().permissionQueue).toEqual([
      expect.objectContaining({ id: 'perm-a-1', sessionId: 'session-A' }),
    ]);

    // Selected/new session chrome is idle; only chrome reset, not A's approval.
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().pendingToolCalls).toBe(0);

    // Switching back to A — approval can still be resolved by the user.
    useChatStore.getState().selectSession('session-A');
    useUIStore.getState().resolvePermissionRequest(true, 'perm-a-1');
    await expect(pendingA).resolves.toBe(true);
    expect(settled).toBe(true);
  });
});
