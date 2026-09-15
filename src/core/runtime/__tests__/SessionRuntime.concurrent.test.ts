import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  getSessionHandle,
  releaseSessionRuntime,
  submitSessionToolResults,
} from '../SessionRuntime';

/**
 * Manual D barrier-style harness (pure TS, controllable promises).
 *
 * Two independent sessions:
 *   A starts a turn and waits on a tool request
 *   B starts a turn and waits on a tool request
 *   Cancel A while B is still waiting
 *   Assert: B remains active; A is terminal; late A result is discarded
 */
describe('SessionRuntime concurrent dual-session barrier', () => {
  const sessionA = 'barrier-session-a';
  const sessionB = 'barrier-session-b';

  beforeEach(() => {
    releaseSessionRuntime(sessionA);
    releaseSessionRuntime(sessionB);
  });

  it('cancel A while B waiting: B stays active, late A result discarded', async () => {
    const handleA = getSessionHandle(sessionA);
    const handleB = getSessionHandle(sessionB);

    const turnA = handleA.startTurn();
    const turnB = handleB.startTurn();
    handleA.runtime.markWaitingTool(turnA);
    handleB.runtime.markWaitingTool(turnB);

    // Controllable waiters (no real sleep) — each session owns its channel.
    const waitA = handleA.runtime.getToolResultChannel().waitFor(
      'req-a',
      ['tool-a'],
      { turnId: turnA },
    );
    const waitB = handleB.runtime.getToolResultChannel().waitFor(
      'req-b',
      ['tool-b'],
      { turnId: turnB },
    );

    expect(handleA.isTurnActive(turnA)).toBe(true);
    expect(handleB.isTurnActive(turnB)).toBe(true);
    expect(handleA.getState()).toBe('waiting_tool');
    expect(handleB.getState()).toBe('waiting_tool');

    // Cancel A while B is still waiting.
    handleA.cancelActiveTurn('Stop A');

    expect(handleA.isTurnActive(turnA)).toBe(false);
    expect(handleA.getState()).toBe('terminal');
    expect(handleB.isTurnActive(turnB)).toBe(true);
    expect(handleB.getState()).toBe('waiting_tool');

    await expect(waitA).rejects.toMatchObject({ name: 'AbortError' });

    // Late A result must discard only — no continuation.
    const lateAccepted = submitSessionToolResults(
      sessionA,
      'req-a',
      [{ id: 'tool-a', content: 'late-a' }],
      turnA,
    );
    expect(lateAccepted).toBe(false);

    // B can still complete normally.
    const bAccepted = submitSessionToolResults(
      sessionB,
      'req-b',
      [{ id: 'tool-b', content: 'b-done' }],
      turnB,
    );
    expect(bAccepted).toBe(true);
    await expect(waitB).resolves.toEqual([{ id: 'tool-b', content: 'b-done' }]);
    expect(handleB.isTurnActive(turnB)).toBe(true);
  });

  it('same-session supersede: prior turn terminal, new turn remains active', async () => {
    const handle = getSessionHandle(sessionA);
    const turn1 = handle.startTurn();
    handle.runtime.markWaitingTool(turn1);
    const wait1 = handle.runtime.getToolResultChannel().waitFor(
      'req-1',
      ['t1'],
      { turnId: turn1 },
    );

    const turn2 = handle.startTurn();
    handle.runtime.markWaitingTool(turn2);

    expect(handle.isTurnActive(turn1)).toBe(false);
    expect(handle.isTurnActive(turn2)).toBe(true);

    await expect(wait1).rejects.toMatchObject({ name: 'AbortError' });
    expect(
      submitSessionToolResults(sessionA, 'req-1', [{ id: 't1', content: 'stale' }], turn1),
    ).toBe(false);

    const wait2 = handle.runtime.getToolResultChannel().waitFor(
      'req-2',
      ['t2'],
      { turnId: turn2 },
    );
    expect(
      submitSessionToolResults(sessionA, 'req-2', [{ id: 't2', content: 'fresh' }], turn2),
    ).toBe(true);
    await expect(wait2).resolves.toEqual([{ id: 't2', content: 'fresh' }]);
  });
});
