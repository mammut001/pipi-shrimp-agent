/**
 * GPT FIX FIRST #99 — Swarm permission requests must carry owning sessionId
 * so ChatBrowserWorkspaceShell's currentSessionId filter shows them, and so
 * they settle via resolvePermissionRequest instead of TTL-deny (~60s).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import * as repo from '../repository';
import {
  enqueuePermissionInUI,
  expireAllPending,
  toUIPermissionRequest,
  requestPermission,
} from '../permissionBridge';
import { useUIStore } from '../../../store/uiStore';

describe('swarm permissionBridge sessionId visibility/settlement', () => {
  beforeEach(async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(global, 'localStorage', {
      configurable: true,
      value: {
        getItem: jest.fn((key: string) => storage.get(key) ?? null),
        setItem: jest.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: jest.fn((key: string) => {
          storage.delete(key);
        }),
      },
    });
    await repo.clearAll();
    expireAllPending();
    useUIStore.setState({
      permissionQueue: [],
      permissionLedger: [],
    });
  });

  afterEach(async () => {
    expireAllPending();
    useUIStore.setState({
      permissionQueue: [],
      permissionLedger: [],
    });
    await repo.flushPendingSaveForTests();
    await repo.clearAll();
  });

  it('toUIPermissionRequest tags owning sessionId for shell filter', () => {
    const req = repo.createPermissionRequest({
      requestId: 'perm-ui-1',
      sessionId: 'session-A',
      teamId: 'team-1',
      agentId: 'agent-1',
      agentName: 'worker',
      toolName: 'execute_command',
      toolArgs: '{"cmd":"ls"}',
      riskLevel: 'high',
      status: 'pending',
      createdAt: Date.now(),
    });

    const uiReq = toUIPermissionRequest(req, () => {});
    expect(uiReq.sessionId).toBe('session-A');
    expect(uiReq.id).toBe('perm-ui-1');
  });

  it('enqueuePermissionInUI puts sessionId on permissionQueue; visible only for owning session; settles once', async () => {
    repo.createTeam({
      id: 'team-swarm-1',
      name: 'team-swarm-1',
      sessionId: 'session-A',
      description: 'test',
      leaderId: 'leader-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'active',
    });

    const approvalPromise = enqueuePermissionInUI({
      sessionId: 'session-A',
      teamId: 'team-swarm-1',
      agentId: 'agent-1',
      agentName: 'worker',
      toolName: 'execute_command',
      toolArgs: '{"cmd":"echo hi"}',
    });

    // Allow setPermissionRequest microtask path
    await Promise.resolve();
    await Promise.resolve();

    const queue = useUIStore.getState().permissionQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual(
      expect.objectContaining({
        sessionId: 'session-A',
        toolName: 'execute_command',
      }),
    );

    // Shell filter: other session must NOT see this pending approval
    const visibleForB = queue.find((p) => p.sessionId === 'session-B');
    expect(visibleForB).toBeUndefined();

    // Owning session sees it
    const visibleForA = queue.find((p) => p.sessionId === 'session-A');
    expect(visibleForA).toBeDefined();
    expect(visibleForA!.id).toBe(queue[0]!.id);

    let settled: boolean | null = null;
    void approvalPromise.then((approved) => {
      settled = approved;
    });
    await Promise.resolve();
    expect(settled).toBeNull();

    useUIStore.getState().resolvePermissionRequest(true, visibleForA!.id);
    await expect(approvalPromise).resolves.toBe(true);
    expect(settled).toBe(true);
    expect(useUIStore.getState().permissionQueue).toHaveLength(0);
  });

  it('requestPermission stores sessionId on SwarmPermissionRequest', () => {
    const { requestId } = requestPermission({
      sessionId: 'session-A',
      teamId: 'team-1',
      agentId: 'agent-1',
      agentName: 'worker',
      toolName: 'read_file',
      toolArgs: '{}',
    });
    const stored = repo.getPermissionRequest(requestId);
    expect(stored?.sessionId).toBe('session-A');
    expect(stored?.status).toBe('pending');
  });
});
