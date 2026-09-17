/**
 * TOP-15-01 / T-01 — chat P0 session isolation regression (R1-01 / R1-02 soak semantics).
 *
 * Current product contract (soak knife 3 / 2026-09-16):
 * - Stream writes target the owning session (streamingSessionId), never the newly selected one (R1-01).
 * - selectSession clears selected-session stream chrome only; it does NOT cancel/stop/scrub
 *   the previous session's in-flight generation or tools (R1-02 evolved: Stop is explicit).
 * - Pending permissions stay session-scoped across switch / new chat.
 *
 * Companion coverage (do not duplicate here):
 * - chatStreamingIsolation.test.ts — owner id, cancel tokens, per-session buffers, chrome gates
 * - chatStoreSendMessage.test.ts — P0-2 stream-while-switch, background A≠B chrome, knife 3
 * - sessionSwitchCancellation.test.ts — cancel/switch/delete persistence matrix
 * - startSessionPermissionIsolation.test.ts — startSession must not deny other sessions
 * - Chat.permissionSessionTarget.test.tsx — legacy Chat approve/deny targets selected session
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { resetTransientSessionStateForNewChat } from '../sessionIsolation';
import {
  clearChatGenerationCancel,
  consumeChatGenerationCancel,
  requestChatGenerationCancel,
} from '../chatStreaming';
import { createSession } from '../../../types/chat';
import { resetAllSessionToolRuntime } from '../toolRuntimeState';

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@tauri-apps/api/event', () => ({
  listen: jest.fn(async () => jest.fn()),
}));

import { useChatStore } from '../index';
import { useUIStore } from '../../uiStore';

describe('sessionIsolation', () => {
  it('clears transient session UI chrome for a new chat without stopping or scrubbing runtime', () => {
    const actions = {
      clearQuestionnaire: jest.fn(),
      clearNotificationHistory: jest.fn(),
      clearArtifactId: jest.fn(),
      clearTaskProgress: jest.fn(),
      setActiveSkill: jest.fn(),
      setAgentPanelTab: jest.fn(),
      closeArtifactsPanel: jest.fn(),
    };

    resetTransientSessionStateForNewChat('session-1', actions);

    expect(actions.clearQuestionnaire).toHaveBeenCalledWith('session-1');
    expect(actions.clearNotificationHistory).toHaveBeenCalledWith('session-1');
    expect(actions.clearArtifactId).toHaveBeenCalledTimes(1);
    expect(actions.clearTaskProgress).toHaveBeenCalledTimes(1);
    expect(actions.setActiveSkill).toHaveBeenCalledWith(null);
    expect(actions.setAgentPanelTab).toHaveBeenCalledWith('main');
    expect(actions.closeArtifactsPanel).toHaveBeenCalledTimes(1);
    expect('clearAllPermissions' in actions).toBe(false);
    expect('clearPermissionsForSession' in actions).toBe(false);
    expect('stopSubprocess' in actions).toBe(false);
    expect('scrubDanglingToolCalls' in actions).toBe(false);
  });

  it('handles null previousSessionId by only clearing global UI chrome', () => {
    const actions = {
      clearQuestionnaire: jest.fn(),
      clearNotificationHistory: jest.fn(),
      clearArtifactId: jest.fn(),
      clearTaskProgress: jest.fn(),
      setActiveSkill: jest.fn(),
      setAgentPanelTab: jest.fn(),
      closeArtifactsPanel: jest.fn(),
    };

    resetTransientSessionStateForNewChat(null, actions);

    expect(actions.clearArtifactId).toHaveBeenCalledTimes(1);
    expect(actions.clearTaskProgress).toHaveBeenCalledTimes(1);
    expect(actions.setActiveSkill).toHaveBeenCalledWith(null);
    expect(actions.setAgentPanelTab).toHaveBeenCalledWith('main');
    expect(actions.closeArtifactsPanel).toHaveBeenCalledTimes(1);
    expect(actions.clearQuestionnaire).not.toHaveBeenCalled();
    expect(actions.clearNotificationHistory).not.toHaveBeenCalled();
    expect('clearAllPermissions' in actions).toBe(false);
  });
});

describe('TOP-15-01 selectSession isolation contract (T-01 / R1-01 / R1-02)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    resetAllSessionToolRuntime();
    clearChatGenerationCancel('session-A');
    clearChatGenerationCancel('session-B');
    useUIStore.setState({
      permissionQueue: [],
      permissionLedger: [],
    });

    const sessionA = {
      ...createSession('Chat A'),
      id: 'session-A',
      messages: [
        { id: 'a-u0', role: 'user' as const, content: 'hello A', timestamp: 1 },
        { id: 'a-a0', role: 'assistant' as const, content: 'reply A', timestamp: 2 },
      ],
    };
    const sessionB = {
      ...createSession('Chat B'),
      id: 'session-B',
      messages: [
        { id: 'b-u0', role: 'user' as const, content: 'hello B', timestamp: 1 },
      ],
    };

    useChatStore.setState({
      sessions: [sessionA, sessionB],
      projects: [],
      currentSessionId: 'session-A',
      isStreaming: true,
      isInitialized: true,
      streamingContent: 'A-stream-chrome',
      streamingReasoning: 'A-reason',
      error: 'stale-error',
      streamingTimeoutId: null,
      lastUiUpdateTime: 0,
      pendingToolCalls: 2,
      pendingToolResults: [{ toolCallId: 'tc-a', result: '' }],
      streamingSessionId: 'session-A',
    });
  });

  afterEach(() => {
    useUIStore.getState().clearAllPermissions();
    clearChatGenerationCancel('session-A');
    clearChatGenerationCancel('session-B');
  });

  it('clears selected stream chrome on A→B without arming generation cancel for A', () => {
    useChatStore.getState().selectSession('session-B');

    const state = useChatStore.getState();
    expect(state.currentSessionId).toBe('session-B');
    expect(state.isStreaming).toBe(false);
    expect(state.streamingContent).toBe('');
    expect(state.streamingReasoning).toBe('');
    expect(state.streamingSessionId).toBeNull();
    expect(state.pendingToolCalls).toBe(0);
    expect(state.pendingToolResults).toEqual([]);
    expect(state.error).toBeNull();

    // R1-02 soak semantics: switch must NOT cancel background A
    expect(consumeChatGenerationCancel('session-A')).toBe(false);
    expect(consumeChatGenerationCancel('session-B')).toBe(false);

    // Histories isolated — B unchanged; A untouched by switch
    expect(state.sessions.find((s) => s.id === 'session-B')?.messages).toEqual([
      expect.objectContaining({ id: 'b-u0', content: 'hello B' }),
    ]);
    expect(state.sessions.find((s) => s.id === 'session-A')?.messages).toEqual([
      expect.objectContaining({ id: 'a-u0', content: 'hello A' }),
      expect.objectContaining({ id: 'a-a0', content: 'reply A' }),
    ]);
  });

  it('does not deny session-A pending permission when switching to B', async () => {
    const pendingA = useUIStore.getState().waitForPermission({
      id: 'perm-a-switch',
      name: 'execute_command',
      arguments: '{"command":"echo a"}',
      sessionId: 'session-A',
    });

    let settled: boolean | null = null;
    void pendingA.then((approved) => {
      settled = approved;
    });

    useChatStore.getState().selectSession('session-B');
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBeNull();
    expect(useUIStore.getState().permissionQueue).toEqual([
      expect.objectContaining({ id: 'perm-a-switch', sessionId: 'session-A' }),
    ]);

    // Approving after switch-back still works
    useChatStore.getState().selectSession('session-A');
    useUIStore.getState().resolvePermissionRequest(true, 'perm-a-switch');
    await expect(pendingA).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  it('ignores unknown session ids and no-ops when already selected', () => {
    const before = useChatStore.getState();
    useChatStore.getState().selectSession('session-missing');
    expect(useChatStore.getState().currentSessionId).toBe('session-A');
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingContent).toBe(before.streamingContent);

    useChatStore.getState().selectSession('session-A');
    expect(useChatStore.getState().currentSessionId).toBe('session-A');
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingSessionId).toBe('session-A');
  });

  it('pre-armed cancel token for A is not consumed by selectSession itself', () => {
    // Stop is the only path that should request cancel; switch must leave tokens alone.
    requestChatGenerationCancel('session-A');
    useChatStore.getState().selectSession('session-B');
    // Token still present for A (switch did not clear/consume it)
    expect(consumeChatGenerationCancel('session-A')).toBe(true);
    expect(consumeChatGenerationCancel('session-B')).toBe(false);
  });
});
