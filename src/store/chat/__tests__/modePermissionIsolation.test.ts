/**
 * GPT FIX FIRST #99 residual — mode updates must not settle another session's
 * pending permission approvals, and must not double-settle the owning session.
 *
 * Proving case: Session A pending approval + Session B mode → bypass/danger
 * must leave A's promise unresolved and settle B's promise exactly once.
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

describe('mode + permission isolation', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    resetAllSessionToolRuntime();
    useUIStore.setState({
      permissionQueue: [],
      permissionLedger: [],
    });

    const sessionA = {
      ...createSession('Chat A'),
      id: 'session-A',
      permissionMode: 'standard' as const,
      executionMode: 'agent' as const,
    };
    const sessionB = {
      ...createSession('Chat B'),
      id: 'session-B',
      permissionMode: 'standard' as const,
      executionMode: 'agent' as const,
    };
    useChatStore.setState({
      sessions: [sessionA, sessionB],
      projects: [],
      currentSessionId: 'session-B',
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

  it('Session A pending + Session B permissionMode→bypass must not settle A / must settle B once', async () => {
    const pendingA = useUIStore.getState().waitForPermission({
      id: 'perm-a-1',
      name: 'execute_command',
      arguments: '{"command":"echo a"}',
      sessionId: 'session-A',
    });
    const pendingB = useUIStore.getState().waitForPermission({
      id: 'perm-b-1',
      name: 'execute_command',
      arguments: '{"command":"echo b"}',
      sessionId: 'session-B',
    });

    let aSettled: boolean | null = null;
    void pendingA.then((approved) => {
      aSettled = approved;
    });

    const reqB = useUIStore.getState().permissionQueue.find((p) => p.id === 'perm-b-1');
    expect(reqB?._resolve).toEqual(expect.any(Function));
    const resolveCallsB: boolean[] = [];
    const originalResolveB = reqB!._resolve!;
    reqB!._resolve = (approved: boolean) => {
      resolveCallsB.push(approved);
      originalResolveB(approved);
    };

    await useChatStore.getState().updateSessionPermissionMode('session-B', 'bypass');

    await expect(pendingB).resolves.toBe(true);
    expect(resolveCallsB).toEqual([true]);

    await Promise.resolve();
    await Promise.resolve();
    expect(aSettled).toBeNull();
    expect(useUIStore.getState().permissionQueue).toEqual([
      expect.objectContaining({ id: 'perm-a-1', sessionId: 'session-A' }),
    ]);

    useUIStore.getState().resolvePermissionRequest(true, 'perm-a-1');
    await expect(pendingA).resolves.toBe(true);
  });

  it('Session A pending + Session B executionMode→danger must not settle A / must settle B once', async () => {
    const pendingA = useUIStore.getState().waitForPermission({
      id: 'perm-a-2',
      name: 'execute_command',
      arguments: '{"command":"echo a"}',
      sessionId: 'session-A',
    });
    const pendingB = useUIStore.getState().waitForPermission({
      id: 'perm-b-2',
      name: 'execute_command',
      arguments: '{"command":"echo b"}',
      sessionId: 'session-B',
    });

    let aSettled: boolean | null = null;
    void pendingA.then((approved) => {
      aSettled = approved;
    });

    const reqB = useUIStore.getState().permissionQueue.find((p) => p.id === 'perm-b-2');
    const resolveCallsB: boolean[] = [];
    const originalResolveB = reqB!._resolve!;
    reqB!._resolve = (approved: boolean) => {
      resolveCallsB.push(approved);
      originalResolveB(approved);
    };

    await useChatStore.getState().updateSessionExecutionMode('session-B', 'danger');

    await expect(pendingB).resolves.toBe(true);
    expect(resolveCallsB).toEqual([true]);

    await Promise.resolve();
    await Promise.resolve();
    expect(aSettled).toBeNull();
    expect(useUIStore.getState().permissionQueue).toEqual([
      expect.objectContaining({ id: 'perm-a-2', sessionId: 'session-A' }),
    ]);
  });
});
