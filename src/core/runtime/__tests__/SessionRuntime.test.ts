import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  SessionRuntime,
  getSessionHandle,
  getSessionRuntimeForTests,
  cancelSessionRuntime,
  releaseSessionRuntime,
  releaseSessionRuntimeForTests,
  submitSessionToolResults,
} from '../SessionRuntime';
import { ToolResultChannel } from '../ToolResultChannel';
import type { RuntimeHost } from '../RuntimeHost';
import { noopRuntimeHost } from '../RuntimeHost';
import type { RuntimeTraceEvent } from '../RuntimeTrace';

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
    releaseSessionRuntimeForTests(sessionId);
  });

  it('creates and caches runtime for a session ID', () => {
    const handle1 = getSessionHandle(sessionId);
    const handle2 = getSessionHandle(sessionId);
    expect(handle1).toBe(handle2);
  });

  it('exposes runtimeId as alias of instanceId', () => {
    const handle = getSessionHandle(sessionId);
    expect(handle.runtimeId).toBe(handle.instanceId);
    expect(getSessionRuntimeForTests(sessionId)!.runtimeId).toBe(getSessionRuntimeForTests(sessionId)!.instanceId);
  });

  it('tracks TurnState transitions: created → running path via startTurn/cancel', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = getSessionRuntimeForTests(sessionId)!;

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
    const runtime = getSessionRuntimeForTests(sessionId)!;

    const turnId = runtime.startTurn();
    expect(runtime.isTurnActive(turnId)).toBe(true);
    expect(handle.isTurnActive(turnId)).toBe(true);

    handle.cancel('User cancelled');
    expect(runtime.isTurnActive(turnId)).toBe(false);
    expect(handle.isTurnActive(turnId)).toBe(false);
  });

  it('refuses markWaitingTool / markRunning after terminal (late continuation)', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = getSessionRuntimeForTests(sessionId)!;
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
    const runtime = getSessionRuntimeForTests(sessionId)!;

    const turn1 = runtime.startTurn();
    expect(runtime.isTurnActive(turn1)).toBe(true);

    const turn2 = runtime.startTurn();
    expect(runtime.isTurnActive(turn1)).toBe(false);
    expect(runtime.isTurnActive(turn2)).toBe(true);
  });

  it('cancelling via cancelSessionRuntime marks active turn inactive', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = getSessionRuntimeForTests(sessionId)!;

    const turn = runtime.startTurn();
    expect(handle.isTurnActive(turn)).toBe(true);

    cancelSessionRuntime(sessionId, 'Session switched');
    expect(handle.isTurnActive(turn)).toBe(false);
  });

  it('releaseSessionRuntime safely verifies instance identity and runtimeId', () => {
    const handle1 = getSessionHandle(sessionId);
    const runtime1 = getSessionRuntimeForTests(sessionId)!;
    const runtimeId1 = handle1.runtimeId;

    releaseSessionRuntime(sessionId, runtime1);
    expect(runtime1.isDisposed).toBe(true);

    // A newer handle created will be fresh
    const handleNew = getSessionHandle(sessionId);
    expect(getSessionRuntimeForTests(sessionId)).not.toBe(runtime1);
    expect(handleNew.runtimeId).not.toBe(runtimeId1);

    // Stale release by runtimeId must not dispose the newer runtime
    releaseSessionRuntime(sessionId, runtimeId1);
    expect(getSessionRuntimeForTests(sessionId)!.isDisposed).toBe(false);

    const runtimeNew = getSessionRuntimeForTests(sessionId)!;
    releaseSessionRuntime(sessionId, handleNew.runtimeId);
    expect(runtimeNew.isDisposed).toBe(true);
  });

  it('submitting tool results routes to active channel and rejects after release', () => {
    const handle = getSessionHandle(sessionId);
    const runtime = getSessionRuntimeForTests(sessionId)!;

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

describe('SessionRuntime RuntimeHost adapter', () => {
  it('cancel() calls host.cancelSubprocess with the sessionId', () => {
    const cancelSubprocess = jest.fn();
    const host: RuntimeHost = { cancelSubprocess };
    const runtime = new SessionRuntime('host-adapter-session', host);
    const turnId = runtime.startTurn();
    expect(runtime.isTurnActive(turnId)).toBe(true);

    runtime.cancel('User cancelled');

    expect(cancelSubprocess).toHaveBeenCalledTimes(1);
    expect(cancelSubprocess).toHaveBeenCalledWith('host-adapter-session');
    expect(runtime.isTurnActive(turnId)).toBe(false);
    expect(runtime.getState()).toBe('terminal');
  });

  it('accepts noopRuntimeHost without throwing on cancel', () => {
    const runtime = new SessionRuntime('noop-host-session', noopRuntimeHost);
    runtime.startTurn();
    expect(() => runtime.cancel('stop')).not.toThrow();
    expect(runtime.getState()).toBe('terminal');
  });

  it('getSessionHandle uses injected host for a new session', () => {
    const sessionId = 'injected-host-session';
    releaseSessionRuntimeForTests(sessionId);
    const cancelSubprocess = jest.fn();
    const host: RuntimeHost = { cancelSubprocess };
    const handle = getSessionHandle(sessionId, host);
    getSessionRuntimeForTests(sessionId)!.startTurn();
    handle.cancel('injected');
    expect(cancelSubprocess).toHaveBeenCalledWith(sessionId);
    releaseSessionRuntimeForTests(sessionId);
  });
});

describe('SessionRuntime introspection + trace', () => {
  const sessionId = 'test-session-introspection';

  beforeEach(() => {
    releaseSessionRuntimeForTests(sessionId);
  });

  it('getSnapshot returns clear identity + state snapshot', () => {
    const handle = getSessionHandle(sessionId);
    expect(handle.getSnapshot()).toEqual({
      sessionId,
      runtimeId: handle.runtimeId,
      turnId: null,
      activeTurnId: null,
      state: 'idle',
      disposed: false,
      pendingToolCount: 0,
      waitingRequestIds: [],
    });

    const runtime = getSessionRuntimeForTests(sessionId)!;
    const turnId = runtime.startTurn();
    expect(handle.getSnapshot()).toEqual({
      sessionId,
      runtimeId: handle.runtimeId,
      turnId,
      activeTurnId: turnId,
      state: 'created',
      disposed: false,
      pendingToolCount: 0,
      waitingRequestIds: [],
    });

    expect(handle.getTraceContext()).toEqual({
      sessionId,
      runtimeId: handle.runtimeId,
      turnId,
    });
  });

  it('cancel emits turn_cancelling → turn_terminal with same runtimeId/turnId', () => {
    const events: RuntimeTraceEvent[] = [];
    const host: RuntimeHost = {
      cancelSubprocess: jest.fn(),
      trace: (event) => {
        events.push(event);
      },
    };
    const runtime = new SessionRuntime('trace-cancel-session', host);
    const turnId = runtime.startTurn();

    runtime.cancel('User cancelled');

    const lifecycle = events.filter((e) =>
      e.type === 'turn_started'
      || e.type === 'turn_cancelling'
      || e.type === 'turn_terminal',
    );
    expect(lifecycle.map((e) => e.type)).toEqual([
      'turn_started',
      'turn_cancelling',
      'turn_terminal',
    ]);

    for (const event of lifecycle) {
      expect(event.context.sessionId).toBe('trace-cancel-session');
      expect(event.context.runtimeId).toBe(runtime.runtimeId);
      expect(event.context.turnId).toBe(turnId);
    }

    const cancelling = lifecycle.find((e) => e.type === 'turn_cancelling')!;
    const terminal = lifecycle.find((e) => e.type === 'turn_terminal')!;
    expect(cancelling.reason).toBe('User cancelled');
    expect(terminal.reason).toBe('User cancelled');
    expect(runtime.getState()).toBe('terminal');
  });

  it('markWaitingTool emits turn_waiting_tool with requestId in trace context', () => {
    const events: RuntimeTraceEvent[] = [];
    const host: RuntimeHost = {
      cancelSubprocess: () => {},
      trace: (event) => {
        events.push(event);
      },
    };
    const runtime = new SessionRuntime('trace-wait-session', host);
    const turnId = runtime.startTurn();
    runtime.markRunning(turnId);
    runtime.markWaitingTool(turnId, 'req-batch-1');

    const waiting = events.find((e) => e.type === 'turn_waiting_tool');
    expect(waiting).toBeDefined();
    expect(waiting!.context).toMatchObject({
      sessionId: 'trace-wait-session',
      runtimeId: runtime.runtimeId,
      turnId,
      requestId: 'req-batch-1',
    });
    expect(runtime.getSnapshot().state).toBe('waiting_tool');
  });

  it('noop host without trace does not throw on lifecycle', () => {
    const runtime = new SessionRuntime('no-trace-session', noopRuntimeHost);
    const turnId = runtime.startTurn();
    expect(() => {
      runtime.markWaitingTool(turnId);
      runtime.cancel('stop');
    }).not.toThrow();
  });
});
