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
import { clearRuntimeTraceSink } from '../RuntimeTraceSink';
import { listOrphanToolCalls } from '../../../store/chat/scrubDanglingToolCalls';
import {
  runManualDProductHarness,
  harnessSessionEvents,
} from './manualDProductHarness';

describe('Manual D product harness (dual-session store/runtime boundary)', () => {
  const sessionA = 'manual-d-product-a';
  const sessionB = 'manual-d-product-b';

  beforeEach(() => {
    releaseSessionRuntimeForTests(sessionA);
    releaseSessionRuntimeForTests(sessionB);
    clearRuntimeTraceSink();
  });

  it('A cancel + B release + late A discard — deterministic barriers, greppable traces', async () => {
    const harness = await runManualDProductHarness({
      sessionA,
      sessionB,
      reqA: 'manual-d-req-a',
      reqB: 'manual-d-req-b',
      cancelReason: 'Manual D Stop A',
      iteration: 0,
      releaseOnSuccess: true,
    });

    expect(harness.aWaitResolvedOk).toBe(false);
    expect(harness.aAbortName).toBe('AbortError');
    expect(harness.lateAAccepted).toBe(false);
    expect(harness.bAccepted).toBe(true);
    expect(harness.bResults).toEqual([{ id: harness.toolCallIdB, content: 'b-ok' }]);

    // ID unification: history tool_call id === waitFor/submit requestId (A + B).
    expect(harness.toolCallIdA).toBe(harness.reqA);
    expect(harness.toolCallIdB).toBe(harness.reqB);
    expect(harness.toolCallIdA).toBe('manual-d-req-a');
    expect(harness.toolCallIdB).toBe('manual-d-req-b');

    // Product-path histories: A terminalized (no orphans + cancel notice); B resolved.
    expect(listOrphanToolCalls(harness.historyA)).toEqual([]);
    expect(
      harness.historyA.some((m) => /cancelled by user/i.test(String(m.content))),
    ).toBe(true);
    expect(
      harness.historyA.every((m) => !String(m.content).includes('late-a-should-discard')),
    ).toBe(true);
    expect(listOrphanToolCalls(harness.historyB)).toEqual([]);
    expect(
      harness.historyB.some((m) => m.tool_call_id === harness.toolCallIdB
        && String(m.content).includes('b-ok')),
    ).toBe(true);
    // B __TOOL_RESULT__ tool_call_id matches waited/submitted id.
    const bToolResult = harness.historyB.find(
      (m) => typeof m.tool_call_id === 'string' && String(m.content).includes('__TOOL_RESULT__'),
    );
    expect(bToolResult?.tool_call_id).toBe(harness.reqB);
    expect(String(bToolResult?.content)).toContain(`__TOOL_RESULT__:${harness.reqB}:`);

    const aEvents = harnessSessionEvents(harness.events, sessionA);
    const bEvents = harnessSessionEvents(harness.events, sessionB);

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

  it('regression: history tool_call id === waited/submitted requestId (A cancel + B success)', async () => {
    const harness = await runManualDProductHarness({
      sessionA,
      sessionB,
      reqA: 'pair-req-a',
      reqB: 'pair-req-b',
      cancelReason: 'pair cancel A',
      iteration: 9,
      releaseOnSuccess: true,
    });

    // Shared id across channel + history for both paths.
    expect(harness.toolCallIdA).toBe('pair-req-a');
    expect(harness.toolCallIdB).toBe('pair-req-b');
    expect(harness.toolCallIdA).toBe(harness.reqA);
    expect(harness.toolCallIdB).toBe(harness.reqB);

    // A cancelled: wait used reqA; late submit used same requestId (discarded).
    expect(harness.aWaitResolvedOk).toBe(false);
    expect(harness.aAbortName).toBe('AbortError');
    expect(harness.lateAAccepted).toBe(false);
    expect(
      harness.events.some((e) => (
        e.type === 'tool_result_discarded' && e.context.requestId === 'pair-req-a'
      )),
    ).toBe(true);

    // B success: wait/submit result id + history tool_call_id + __TOOL_RESULT__ id.
    expect(harness.bAccepted).toBe(true);
    expect(harness.bResults).toEqual([{ id: 'pair-req-b', content: 'b-ok' }]);
    const assistantB = harness.historyB.find(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
    );
    expect(assistantB?.tool_calls?.[0]?.id).toBe('pair-req-b');
    const resultB = harness.historyB.find(
      (m) => m.tool_call_id === 'pair-req-b'
        && String(m.content).startsWith('__TOOL_RESULT__:pair-req-b:'),
    );
    expect(resultB).toBeDefined();
    expect(String(resultB?.content)).toContain('b-ok');
  });
});
