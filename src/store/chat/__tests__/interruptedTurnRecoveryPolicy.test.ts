/**
 * Maps GPT P1 #5 recovery rules R1–R4 to helpers + hydrate terminalize.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { createMessage } from '../../../types/chat';
import { buildApiMessages } from '../../../utils/chatHelpers';
import {
  terminalizeInterruptedMessages,
  terminalizeInterruptedToolTurns,
  buildToolCancelNoticeContent,
} from '../scrubDanglingToolCalls';
import {
  INTERRUPTED_TURN_RECOVERY_POLICY,
  assertInterruptedRecoveryInvariants,
  decideHydrateRecoveryAction,
  hasInterruptedOrCancelNotice,
  requiresExplicitUserRetryToReExecute,
  shouldAutoRetryInterruptedTool,
  shouldResumeRunningTurnAfterRestart,
} from '../interruptedTurnRecoveryPolicy';
import {
  getSessionHandle,
  getSessionRuntimeForTests,
  releaseSessionRuntimeForTests,
  submitSessionToolResults,
} from '../../../core/runtime';

describe('interrupted-turn recovery policy (P1 #5)', () => {
  const sessionId = 'recovery-policy-session';

  beforeEach(() => {
    releaseSessionRuntimeForTests(sessionId);
  });

  it('R1: policy forbids resuming a running turn after restart', () => {
    expect(INTERRUPTED_TURN_RECOVERY_POLICY.resumeRunningTurnAfterRestart).toBe(false);
    expect(shouldResumeRunningTurnAfterRestart()).toBe(false);
  });

  it('R2: policy forbids auto-retry of interrupted tools', () => {
    expect(INTERRUPTED_TURN_RECOVERY_POLICY.autoRetryRunningToolAfterRestart).toBe(false);
    expect(shouldAutoRetryInterruptedTool()).toBe(false);
  });

  it('R3: restart yields interrupted terminal — orphans decide hydrate action', () => {
    expect(INTERRUPTED_TURN_RECOVERY_POLICY.restartYieldsInterruptedTerminal).toBe(true);

    const clean = [createMessage('user', 'hi')];
    expect(decideHydrateRecoveryAction(clean)).toBe('noop');

    const withOrphan = [
      createMessage('user', 'run tool'),
      {
        ...createMessage('assistant', 'working'),
        tool_calls: [{ id: 'tc-orphan', name: 'execute_command', arguments: '{}' }],
      },
    ];
    expect(decideHydrateRecoveryAction(withOrphan)).toBe('terminalize_interrupted');

    const terminalized = terminalizeInterruptedMessages(withOrphan, {
      kind: 'interrupted',
      now: 99,
    });
    expect(terminalized.changed).toBe(true);
    expect(terminalized.notice).not.toBeNull();
    expect(hasInterruptedOrCancelNotice(terminalized.messages, 'interrupted')).toBe(true);
    expect(buildToolCancelNoticeContent(['execute_command'], 'interrupted')).toContain(
      'session reloaded',
    );

    const invariants = assertInterruptedRecoveryInvariants(terminalized.messages, {
      expectNotice: true,
    });
    expect(invariants.ok).toBe(true);
    expect(invariants.orphans).toHaveLength(0);
    expect(invariants.hasNotice).toBe(true);

    // Follow-up API history must not re-present orphan tool_calls (no auto-retry signal).
    const api = buildApiMessages(terminalized.messages);
    expect(api.some((m) => Boolean(m.tool_calls?.length))).toBe(false);
    expect(api.some((m) => (
      typeof m.content === 'string' && m.content.includes('do NOT re-request')
    ))).toBe(true);
  });

  it('R4: re-execute requires explicit user retry (policy + hydrate does not start a turn)', async () => {
    expect(INTERRUPTED_TURN_RECOVERY_POLICY.reExecuteRequiresExplicitUserRetry).toBe(true);
    expect(requiresExplicitUserRetryToReExecute()).toBe(true);

    let state = {
      sessions: [{
        id: sessionId,
        title: sessionId,
        messages: [
          createMessage('user', 'sleep'),
          {
            ...createMessage('assistant', 'calling'),
            tool_calls: [{ id: 'tc-1', name: 'execute_command', arguments: '{"command":"sleep 20"}' }],
          },
        ],
        createdAt: 1,
        updatedAt: 2,
      }],
      projects: [],
      currentSessionId: sessionId,
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
    } as any;

    const set = (updater: any) => {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      state = { ...state, ...patch };
    };
    const get = () => state;

    // Simulate restart: release any prior runtime, then hydrate terminalize only.
    releaseSessionRuntimeForTests(sessionId);
    const changed = await terminalizeInterruptedToolTurns(sessionId, set as any, get, {
      kind: 'interrupted',
      persist: 'none',
    });
    expect(changed).toBe(true);

    const handle = getSessionHandle(sessionId);
    expect(handle.getState()).toBe('idle');
    expect(handle.getActiveTurnId()).toBeNull();
    // Stale submit may buffer on an idle channel, but must not resume/start a turn.
    submitSessionToolResults(sessionId, 'stale-req', [{ id: 'tc-1', content: 'late' }], 'stale-turn');
    expect(handle.getState()).toBe('idle');
    expect(handle.getActiveTurnId()).toBeNull();

    const invariants = assertInterruptedRecoveryInvariants(get().sessions[0].messages, {
      expectNotice: true,
    });
    expect(invariants.ok).toBe(true);
  });

  it('R1+R2 runtime: release + reacquire does not resume prior waiting turn', async () => {
    const handle = getSessionHandle(sessionId);
    const runtime = getSessionRuntimeForTests(sessionId)!;
    const turnId = runtime.startTurn();
    runtime.markWaitingTool(turnId);
    const wait = runtime.getToolResultChannel().waitFor('req-1', ['t1'], { turnId });

    expect(handle.getState()).toBe('waiting_tool');
    expect(shouldResumeRunningTurnAfterRestart()).toBe(false);

    // Simulate process restart: drop process-local runtime (in-memory only).
    releaseSessionRuntimeForTests(sessionId);
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' });

    const fresh = getSessionHandle(sessionId);
    expect(fresh.getState()).toBe('idle');
    expect(fresh.getActiveTurnId()).toBeNull();
    expect(shouldAutoRetryInterruptedTool()).toBe(false);
    // After reacquire, stale pre-restart results must not revive a turn.
    submitSessionToolResults(sessionId, 'req-1', [{ id: 't1', content: 'stale' }], turnId);
    expect(fresh.getState()).toBe('idle');
    expect(fresh.getActiveTurnId()).toBeNull();
  });

  it('user_cancel notice also satisfies terminal notice invariant', () => {
    const withOrphan = [
      createMessage('user', 'run'),
      {
        ...createMessage('assistant', 'working'),
        tool_calls: [{ id: 'tc-x', name: 'read_file', arguments: '{}' }],
      },
    ];
    const cancelled = terminalizeInterruptedMessages(withOrphan, {
      kind: 'user_cancel',
      now: 7,
    });
    expect(hasInterruptedOrCancelNotice(cancelled.messages, 'user_cancel')).toBe(true);
    expect(assertInterruptedRecoveryInvariants(cancelled.messages, { expectNotice: true }).ok).toBe(true);
  });
});
