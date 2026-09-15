import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  SessionRuntime,
  getSessionHandle,
  cancelSessionRuntime,
  releaseSessionRuntime,
  submitSessionToolResults,
} from '../SessionRuntime';
import { ToolResultChannel } from '../ToolResultChannel';

describe('ToolResultChannel', () => {
  let channel: ToolResultChannel;

  beforeEach(() => {
    channel = new ToolResultChannel();
  });

  it('delivers results when submitted after waitFor is called (rendezvous)', async () => {
    const promise = channel.waitFor('req-1', ['t1'], { turnId: 'turn-a' });
    expect(channel.submit('req-1', [{ id: 't1', content: 'hello' }], 'turn-a')).toBe(true);
    const results = await promise;
    expect(results).toEqual([{ id: 't1', content: 'hello' }]);
  });

  it('delivers results when submitted before waitFor is called (buffering)', async () => {
    channel.submit('req-1', [{ id: 't1', content: 'buffered' }], 'turn-a');
    const results = await channel.waitFor('req-1', ['t1'], { turnId: 'turn-a' });
    expect(results).toEqual([{ id: 't1', content: 'buffered' }]);
  });

  it('preserves first submission when duplicate submit is called for the same request', async () => {
    channel.submit('req-dup', [{ id: 't1', content: 'first' }], 'turn-a');
    channel.submit('req-dup', [{ id: 't1', content: 'second' }], 'turn-a');
    const results = await channel.waitFor('req-dup', ['t1'], { turnId: 'turn-a' });
    expect(results).toEqual([{ id: 't1', content: 'first' }]);
  });

  it('aborts pending waiters when aborted with signal', async () => {
    const controller = new AbortController();
    const waitPromise = channel.waitFor('req-abort', ['t1'], {
      signal: controller.signal,
      turnId: 'turn-a',
    });

    controller.abort(new DOMException('Turn aborted', 'AbortError'));

    await expect(waitPromise).rejects.toThrow(/Chat turn aborted/i);
  });

  it('bounds FIFO tombstones to MAX_TOMBSTONES (1000)', async () => {
    for (let i = 0; i < 1050; i++) {
      channel.submit(`req-${i}`, [{ id: `t-${i}`, content: 'ok' }], 'turn-a');
      await channel.waitFor(`req-${i}`, [], { turnId: 'turn-a' });
    }

    // Recent request is in tombstones, so waitFor rejects
    await expect(channel.waitFor('req-1049', [], { turnId: 'turn-a' })).rejects.toThrow(/already settled/i);
  });

  it('binds waiters to turnId and discards submit with mismatched turnId', async () => {
    const promise = channel.waitFor('req-turn', ['t1'], { turnId: 'turn-a' });
    expect(channel.submit('req-turn', [{ id: 't1', content: 'wrong' }], 'turn-b')).toBe(false);
    expect(channel.hasPending('req-turn')).toBe(true);
    expect(channel.submit('req-turn', [{ id: 't1', content: 'right' }], 'turn-a')).toBe(true);
    await expect(promise).resolves.toEqual([{ id: 't1', content: 'right' }]);
  });

  it('discards late submit after cancelAll (terminal/cancel)', async () => {
    const promise = channel.waitFor('req-late', ['t1'], { turnId: 'turn-a' });
    channel.cancelAll('cancelled');
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(channel.submit('req-late', [{ id: 't1', content: 'late' }], 'turn-a')).toBe(false);
  });
});

describe('SessionRuntime lifecycle and turn ownership', () => {
  const sessionId = 'test-session-p0';

  beforeEach(() => {
    releaseSessionRuntime(sessionId);
  });

  it('creates and caches runtime for a session ID', () => {
    const handle1 = getSessionHandle(sessionId);
    const handle2 = getSessionHandle(sessionId);
    expect(handle1).toBe(handle2);
  });

  it('exposes runtimeId as alias of instanceId', () => {
    const handle = getSessionHandle(sessionId);
    expect(handle.runtimeId).toBe(handle.instanceId);
    expect(handle.runtime.runtimeId).toBe(handle.runtime.instanceId);
  });

  it('tracks TurnState transitions: created → running path via startTurn/cancel', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = handle.runtime;

    expect(handle.getState()).toBe('idle');
    const turnId = runtime.startTurn();
    expect(runtime.getState()).toBe('created');
    expect(handle.getActiveTurnId()).toBe(turnId);
    expect(runtime.isTurnActive(turnId)).toBe(true);

    runtime.markWaitingTool(turnId);
    expect(runtime.getState()).toBe('waiting_tool');

    runtime.markRunning(turnId);
    expect(runtime.getState()).toBe('running');

    handle.cancelActiveTurn('User cancelled');
    expect(runtime.isTurnActive(turnId)).toBe(false);
    expect(runtime.getState()).toBe('terminal');
  });

  it('tracks active turn and marks turn inactive upon cancellation', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = handle.runtime;

    const turnId = runtime.startTurn();
    expect(runtime.isTurnActive(turnId)).toBe(true);
    expect(handle.isTurnActive(turnId)).toBe(true);

    handle.cancel('User cancelled');
    expect(runtime.isTurnActive(turnId)).toBe(false);
    expect(handle.isTurnActive(turnId)).toBe(false);
  });

  it('refuses markWaitingTool / markRunning after terminal (late continuation)', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = handle.runtime;
    const turnId = runtime.startTurn();
    handle.cancelActiveTurn('stop');
    expect(runtime.getState()).toBe('terminal');

    runtime.markWaitingTool(turnId);
    expect(runtime.getState()).toBe('terminal');
    runtime.markRunning(turnId);
    expect(runtime.getState()).toBe('terminal');
    expect(runtime.isTurnActive(turnId)).toBe(false);
  });

  it('starting a new turn automatically cancels the prior active turn', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = handle.runtime;

    const turn1 = runtime.startTurn();
    expect(runtime.isTurnActive(turn1)).toBe(true);

    const turn2 = runtime.startTurn();
    expect(runtime.isTurnActive(turn1)).toBe(false);
    expect(runtime.isTurnActive(turn2)).toBe(true);
  });

  it('cancelling via cancelSessionRuntime marks active turn inactive', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = handle.runtime;

    const turn = runtime.startTurn();
    expect(handle.isTurnActive(turn)).toBe(true);

    cancelSessionRuntime(sessionId, 'Session switched');
    expect(handle.isTurnActive(turn)).toBe(false);
  });

  it('releaseSessionRuntime safely verifies instance identity and runtimeId', () => {
    const handle1 = getSessionHandle(sessionId);
    const runtime1 = handle1.runtime;
    const runtimeId1 = handle1.runtimeId;

    releaseSessionRuntime(sessionId, runtime1);
    expect(runtime1.isDisposed).toBe(true);

    // A newer handle created will be fresh
    const handleNew = getSessionHandle(sessionId);
    expect(handleNew.runtime).not.toBe(runtime1);
    expect(handleNew.runtimeId).not.toBe(runtimeId1);

    // Stale release by runtimeId must not dispose the newer runtime
    releaseSessionRuntime(sessionId, runtimeId1);
    expect(handleNew.runtime.isDisposed).toBe(false);

    releaseSessionRuntime(sessionId, handleNew.runtimeId);
    expect(handleNew.runtime.isDisposed).toBe(true);
  });

  it('submitting tool results routes to active channel and rejects after release', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = handle.runtime;

    const turnId = runtime.startTurn();
    const accepted = submitSessionToolResults(
      sessionId,
      'req-active',
      [{ id: 't1', content: 'res' }],
      turnId,
    );
    expect(accepted).toBe(true);

    releaseSessionRuntime(sessionId, handle);
    const afterRelease = submitSessionToolResults(
      sessionId,
      'req-late',
      [{ id: 't1', content: 'late' }],
      turnId,
    );
    expect(afterRelease).toBe(false);
  });
});
