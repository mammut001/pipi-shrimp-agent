/**
 * Manual D repeatable product harness (GPT P1 #4).
 *
 * Store/runtime boundary — SessionRuntime + ToolResultChannel latches.
 * Proves: A cancelled, B succeeds, late A discarded, no stale replay.
 * Deterministic barriers (no wall-clock sleep flakiness).
 *
 * Does NOT build Playwright E2E. Rust `test_barrier_tool` remains available
 * for native Manual D; this harness covers the TS product boundary in Jest.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  getSessionHandle,
  getSessionRuntimeForTests,
  releaseSessionRuntimeForTests,
  submitSessionToolResults,
} from '../SessionRuntime';
import {
  clearRuntimeTraceSink,
  getRuntimeTraceEvents,
} from '../RuntimeTraceSink';
import { createManualDBarrier, awaitCondition } from './manualDBarrier';

describe('Manual D product harness (dual-session store/runtime boundary)', () => {
  const sessionA = 'manual-d-product-a';
  const sessionB = 'manual-d-product-b';

  beforeEach(() => {
    releaseSessionRuntimeForTests(sessionA);
    releaseSessionRuntimeForTests(sessionB);
    clearRuntimeTraceSink();
  });

  it('A cancel + B release + late A discard — deterministic barriers, greppable traces', async () => {
    const handleA = getSessionHandle(sessionA);
    const handleB = getSessionHandle(sessionB);
    const runtimeA = getSessionRuntimeForTests(sessionA)!;
    const runtimeB = getSessionRuntimeForTests(sessionB)!;

    const gateA = createManualDBarrier();
    const gateB = createManualDBarrier();

    const turnA = runtimeA.startTurn();
    const turnB = runtimeB.startTurn();
    runtimeA.markWaitingTool(turnA);
    runtimeB.markWaitingTool(turnB);

    // Controllable waiters enter "waiting" without sleep.
    const waitAPromise = (async () => {
      await gateA.wait();
      return runtimeA.getToolResultChannel().waitFor(
        'manual-d-req-a',
        ['tool-a'],
        { turnId: turnA },
      );
    })();
    const waitBPromise = (async () => {
      await gateB.wait();
      return runtimeB.getToolResultChannel().waitFor(
        'manual-d-req-b',
        ['tool-b'],
        { turnId: turnB },
      );
    })();

    // Both sessions entered waiting_tool (product Ready-gate equivalent).
    expect(handleA.getState()).toBe('waiting_tool');
    expect(handleB.getState()).toBe('waiting_tool');
    expect(handleA.isTurnActive(turnA)).toBe(true);
    expect(handleB.isTurnActive(turnB)).toBe(true);

    // Open channel waiters (both still waiting for tool results).
    gateA.release();
    gateB.release();
    await awaitCondition(
      () => runtimeA.getToolResultChannel().listPendingRequestIds().includes('manual-d-req-a')
        && runtimeB.getToolResultChannel().listPendingRequestIds().includes('manual-d-req-b'),
      'both channels pending',
    );

    // Cancel A while B is still waiting.
    handleA.cancelActiveTurn('Manual D Stop A');
    expect(handleA.isTurnActive(turnA)).toBe(false);
    expect(handleA.getState()).toBe('terminal');
    expect(handleB.isTurnActive(turnB)).toBe(true);
    expect(handleB.getState()).toBe('waiting_tool');

    await expect(waitAPromise).rejects.toMatchObject({ name: 'AbortError' });

    // Late A release must discard only — no continuation / no stale replay.
    const lateA = submitSessionToolResults(
      sessionA,
      'manual-d-req-a',
      [{ id: 'tool-a', content: 'late-a-should-discard' }],
      turnA,
    );
    expect(lateA).toBe(false);

    // Release B — succeeds independently.
    const bAccepted = submitSessionToolResults(
      sessionB,
      'manual-d-req-b',
      [{ id: 'tool-b', content: 'b-ok' }],
      turnB,
    );
    expect(bAccepted).toBe(true);
    await expect(waitBPromise).resolves.toEqual([{ id: 'tool-b', content: 'b-ok' }]);
    expect(handleB.isTurnActive(turnB)).toBe(true);

    // Trace sink: A cancel chain + late discard; B never cancelled.
    const events = getRuntimeTraceEvents();
    const aEvents = events.filter((e) => e.context.sessionId === sessionA);
    const bEvents = events.filter((e) => e.context.sessionId === sessionB);

    expect(aEvents.some((e) => e.type === 'turn_cancelling')).toBe(true);
    expect(aEvents.some((e) => e.type === 'tool_cancel_requested')).toBe(true);
    expect(aEvents.some((e) => e.type === 'tool_cancelled')).toBe(true);
    expect(aEvents.some((e) => e.type === 'turn_terminal')).toBe(true);
    expect(aEvents.some((e) => (
      e.type === 'tool_result_discarded'
      && e.context.requestId === 'manual-d-req-a'
    ))).toBe(true);

    expect(bEvents.some((e) => e.type === 'tool_cancelled')).toBe(false);
    expect(bEvents.some((e) => e.type === 'turn_terminal')).toBe(false);
    expect(bEvents.some((e) => e.type === 'turn_waiting_tool')).toBe(true);
  });

  it('cross-session isolation: B submit never unblocks A after A cancel', async () => {
    const handleA = getSessionHandle(sessionA);
    const handleB = getSessionHandle(sessionB);
    const runtimeA = getSessionRuntimeForTests(sessionA)!;
    const runtimeB = getSessionRuntimeForTests(sessionB)!;

    const turnA = runtimeA.startTurn();
    const turnB = runtimeB.startTurn();
    runtimeA.markWaitingTool(turnA);
    runtimeB.markWaitingTool(turnB);

    const waitA = runtimeA.getToolResultChannel().waitFor(
      'iso-req-a',
      ['tool-a'],
      { turnId: turnA },
    );
    const waitB = runtimeB.getToolResultChannel().waitFor(
      'iso-req-b',
      ['tool-b'],
      { turnId: turnB },
    );

    handleA.cancel('Stop A');
    await expect(waitA).rejects.toMatchObject({ name: 'AbortError' });

    // Late A submit is tombstoned — must not revive A.
    expect(
      submitSessionToolResults(sessionA, 'iso-req-a', [{ id: 'tool-a', content: 'x' }], turnA),
    ).toBe(false);
    expect(handleA.isTurnActive(turnA)).toBe(false);

    // B still completes on its own channel (no cross-session unblock of A).
    expect(
      submitSessionToolResults(sessionB, 'iso-req-b', [{ id: 'tool-b', content: 'b' }], turnB),
    ).toBe(true);
    await expect(waitB).resolves.toEqual([{ id: 'tool-b', content: 'b' }]);
    expect(handleB.isTurnActive(turnB)).toBe(true);
    expect(handleA.getState()).toBe('terminal');
  });
});
