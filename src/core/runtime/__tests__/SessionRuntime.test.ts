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
    const promise = channel.waitFor('req-1', ['t1']);
    channel.submit('req-1', [{ id: 't1', content: 'hello' }]);
    const results = await promise;
    expect(results).toEqual([{ id: 't1', content: 'hello' }]);
  });

  it('delivers results when submitted before waitFor is called (buffering)', async () => {
    channel.submit('req-1', [{ id: 't1', content: 'buffered' }]);
    const results = await channel.waitFor('req-1', ['t1']);
    expect(results).toEqual([{ id: 't1', content: 'buffered' }]);
  });

  it('preserves first submission when duplicate submit is called for the same request', async () => {
    channel.submit('req-dup', [{ id: 't1', content: 'first' }]);
    channel.submit('req-dup', [{ id: 't1', content: 'second' }]);
    const results = await channel.waitFor('req-dup', ['t1']);
    expect(results).toEqual([{ id: 't1', content: 'first' }]);
  });

  it('aborts pending waiters when aborted with signal', async () => {
    const controller = new AbortController();
    const waitPromise = channel.waitFor('req-abort', ['t1'], { signal: controller.signal });

    controller.abort(new DOMException('Turn aborted', 'AbortError'));

    await expect(waitPromise).rejects.toThrow(/Chat turn aborted/i);
  });

  it('bounds FIFO tombstones to MAX_TOMBSTONES (1000)', async () => {
    for (let i = 0; i < 1050; i++) {
      channel.submit(`req-${i}`, [{ id: `t-${i}`, content: 'ok' }]);
      await channel.waitFor(`req-${i}`);
    }

    // Recent request is in tombstones, so waitFor rejects
    await expect(channel.waitFor('req-1049')).rejects.toThrow(/already settled/i);
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

  it('tracks active turn and marks turn inactive upon cancellation', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = (handle as any).runtime as SessionRuntime;

    const turnId = runtime.startTurn();
    expect(runtime.isTurnActive(turnId)).toBe(true);
    expect(handle.isTurnActive(turnId)).toBe(true);

    handle.cancel('User cancelled');
    expect(runtime.isTurnActive(turnId)).toBe(false);
    expect(handle.isTurnActive(turnId)).toBe(false);
  });

  it('starting a new turn automatically cancels the prior active turn', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = (handle as any).runtime as SessionRuntime;

    const turn1 = runtime.startTurn();
    expect(runtime.isTurnActive(turn1)).toBe(true);

    const turn2 = runtime.startTurn();
    expect(runtime.isTurnActive(turn1)).toBe(false);
    expect(runtime.isTurnActive(turn2)).toBe(true);
  });

  it('cancelling via cancelSessionRuntime marks active turn inactive', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = (handle as any).runtime as SessionRuntime;

    const turn = runtime.startTurn();
    expect(handle.isTurnActive(turn)).toBe(true);

    cancelSessionRuntime(sessionId, 'Session switched');
    expect(handle.isTurnActive(turn)).toBe(false);
  });

  it('releaseSessionRuntime safely verifies instance identity', () => {
    const handle1 = getSessionHandle(sessionId);
    const runtime1 = (handle1 as any).runtime as SessionRuntime;

    releaseSessionRuntime(sessionId, runtime1);
    expect(runtime1.isDisposed).toBe(true);

    // A newer handle created will be fresh
    const handleNew = getSessionHandle(sessionId);
    expect((handleNew as any).runtime).not.toBe(runtime1);
  });

  it('submitting tool results routes to active channel and rejects after release', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = (handle as any).runtime as SessionRuntime;

    runtime.startTurn();
    const accepted = submitSessionToolResults(sessionId, 'req-active', [{ id: 't1', content: 'res' }]);
    expect(accepted).toBe(true);

    releaseSessionRuntime(sessionId, handle);
    const afterRelease = submitSessionToolResults(sessionId, 'req-late', [{ id: 't1', content: 'late' }]);
    expect(afterRelease).toBe(false);
  });
});
