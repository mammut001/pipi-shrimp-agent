import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { RuntimeHost } from '../RuntimeHost';
import type { RuntimeTraceEvent } from '../RuntimeTrace';
import {
  clearRuntimeTraceSink,
  createRuntimeTraceRingBuffer,
  dumpRuntimeTraceJsonLines,
  getRuntimeTraceEvents,
  installRuntimeTraceDevDump,
  sharedRuntimeTraceSink,
} from '../RuntimeTraceSink';
import {
  SessionRuntime,
  getSessionHandle,
  getSessionRuntimeForTests,
  releaseSessionRuntime,
  releaseSessionRuntimeForTests,
  submitSessionToolResults,
} from '../SessionRuntime';
import { createTauriRuntimeHost } from '../tauriRuntimeHost';

describe('RuntimeTraceSink ring buffer', () => {
  beforeEach(() => {
    clearRuntimeTraceSink();
  });

  it('records events with required identity fields and dumps JSON lines', () => {
    const events: RuntimeTraceEvent[] = [];
    const host: RuntimeHost = {
      cancelSubprocess: () => {},
      trace: (event) => {
        events.push(event);
        sharedRuntimeTraceSink.record(event);
      },
    };
    const runtime = new SessionRuntime('sink-session', host);
    const turnId = runtime.startTurn();
    runtime.markWaitingTool(turnId, 'req-1');
    runtime.cancel('User stop');

    expect(events.some((e) => e.type === 'turn_started')).toBe(true);
    expect(events.some((e) => e.type === 'tool_requested')).toBe(true);
    expect(events.some((e) => e.type === 'tool_cancel_requested')).toBe(true);
    expect(events.some((e) => e.type === 'turn_terminal')).toBe(true);

    for (const event of events) {
      expect(event.context.sessionId).toBe('sink-session');
      expect(event.context.runtimeId).toBe(runtime.runtimeId);
      expect(typeof event.at).toBe('number');
      expect(event).not.toHaveProperty('arguments');
      expect(JSON.stringify(event)).not.toMatch(/api[_-]?key|password|secret/i);
    }

    const lines = dumpRuntimeTraceJsonLines().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const parsed = lines.map((line) => JSON.parse(line) as RuntimeTraceEvent);
    expect(parsed.every((e) => e.context.sessionId === 'sink-session')).toBe(true);
  });

  it('caps capacity (ring) and preserves newest events', () => {
    const ring = createRuntimeTraceRingBuffer(3);
    for (let i = 0; i < 5; i += 1) {
      ring.record({
        type: 'turn_started',
        at: i,
        context: { sessionId: 's', runtimeId: 'r', turnId: `t-${i}` },
      });
    }
    expect(ring.size).toBe(3);
    expect(ring.getEvents().map((e) => e.context.turnId)).toEqual(['t-2', 't-3', 't-4']);
  });

  it('late discard reason is visible on tool_result_discarded', () => {
    const events: RuntimeTraceEvent[] = [];
    const host: RuntimeHost = {
      cancelSubprocess: () => {},
      trace: (event) => events.push(event),
    };
    const runtime = new SessionRuntime('discard-session', host);
    const turnId = runtime.startTurn();
    const wait = runtime.getToolResultChannel().waitFor('req-late', ['tool-1'], { turnId });
    runtime.cancel('Stop');
    void wait.catch(() => {});

    const accepted = runtime.submitToolResults(
      'req-late',
      [{ id: 'tool-1', content: 'late' }],
      turnId,
    );
    expect(accepted).toBe(false);

    const discarded = events.filter((e) => e.type === 'tool_result_discarded');
    expect(discarded.length).toBeGreaterThanOrEqual(1);
    expect(discarded[0].reason).toBe('tombstoned_late_result');
    expect(discarded[0].context.requestId).toBe('req-late');
    expect(discarded[0].context.sessionId).toBe('discard-session');
    expect(discarded[0].context.runtimeId).toBe(runtime.runtimeId);
  });

  it('cancel emits tool_cancel_requested and tool_cancelled for pending request', async () => {
    const events: RuntimeTraceEvent[] = [];
    const host: RuntimeHost = {
      cancelSubprocess: jest.fn(),
      trace: (event) => events.push(event),
    };
    const runtime = new SessionRuntime('cancel-tools-session', host);
    const turnId = runtime.startTurn();
    const wait = runtime.getToolResultChannel().waitFor('req-c', ['tool-c'], { turnId });
    runtime.cancel('User cancelled');

    await expect(wait).rejects.toMatchObject({ name: 'AbortError' });

    const types = events.map((e) => e.type);
    expect(types).toContain('tool_cancel_requested');
    expect(types).toContain('tool_cancelled');
    expect(types).toContain('turn_terminal');

    const cancelled = events.find((e) => e.type === 'tool_cancelled')!;
    expect(cancelled.context.requestId).toBe('req-c');
    expect(cancelled.context.turnId).toBe(turnId);
    expect(cancelled.reason).toBe('User cancelled');
  });

  it('Manual D dual-session chains are greppable from one JSONL dump', () => {
    clearRuntimeTraceSink();
    const hostA: RuntimeHost = {
      cancelSubprocess: () => {},
      trace: sharedRuntimeTraceSink.record,
    };
    const hostB: RuntimeHost = {
      cancelSubprocess: () => {},
      trace: sharedRuntimeTraceSink.record,
    };
    const runtimeA = new SessionRuntime('manual-d-a', hostA);
    const runtimeB = new SessionRuntime('manual-d-b', hostB);
    const turnA = runtimeA.startTurn();
    const turnB = runtimeB.startTurn();
    runtimeA.markWaitingTool(turnA, 'req-a');
    runtimeB.markWaitingTool(turnB, 'req-b');
    runtimeA.cancel('Stop A');

    const dump = dumpRuntimeTraceJsonLines();
    const aLines = dump.split('\n').filter((l) => l.includes('manual-d-a'));
    const bLines = dump.split('\n').filter((l) => l.includes('manual-d-b'));
    expect(aLines.some((l) => l.includes('tool_cancel_requested') || l.includes('turn_terminal'))).toBe(true);
    expect(bLines.some((l) => l.includes('tool_requested'))).toBe(true);
    expect(bLines.every((l) => !l.includes('"sessionId":"manual-d-a"'))).toBe(true);
  });

  it('default tauri host records into shared sink; release emits runtime_released', () => {
    clearRuntimeTraceSink();
    const sessionId = 'tauri-host-trace';
    releaseSessionRuntimeForTests(sessionId);
    const handle = getSessionHandle(sessionId, createTauriRuntimeHost());
    const runtime = getSessionRuntimeForTests(sessionId)!;
    runtime.startTurn();
    releaseSessionRuntime(sessionId, handle);

    const events = getRuntimeTraceEvents();
    expect(events.some((e) => e.type === 'turn_started')).toBe(true);
    expect(events.some((e) => e.type === 'runtime_released')).toBe(true);
  });

  it('installRuntimeTraceDevDump exposes dump helper', () => {
    const target: Record<string, unknown> = {};
    const api = installRuntimeTraceDevDump(target);
    sharedRuntimeTraceSink.record({
      type: 'turn_started',
      at: 1,
      context: { sessionId: 'dev', runtimeId: 'r1' },
    });
    expect(api.size()).toBeGreaterThanOrEqual(1);
    expect(api.dumpJsonLines()).toContain('turn_started');
    expect(target.__PIPI_RUNTIME_TRACE__).toBe(api);
  });

  it('late submit after runtime release records tool_result_discarded into shared sink', () => {
    clearRuntimeTraceSink();
    const sessionId = 'late-submit-released';
    releaseSessionRuntimeForTests(sessionId);
    const handle = getSessionHandle(sessionId, createTauriRuntimeHost());
    const runtime = getSessionRuntimeForTests(sessionId)!;
    const turnId = runtime.startTurn();
    releaseSessionRuntime(sessionId, handle);

    const accepted = submitSessionToolResults(
      sessionId,
      'req-after-release',
      [{ id: 'tool-1', content: 'too-late' }],
      turnId,
    );
    expect(accepted).toBe(false);

    const discarded = getRuntimeTraceEvents().filter((e) => e.type === 'tool_result_discarded');
    expect(discarded.length).toBeGreaterThanOrEqual(1);
    const last = discarded[discarded.length - 1]!;
    expect(last.reason).toBe('runtime_released_late_submit');
    expect(last.context.sessionId).toBe(sessionId);
    expect(last.context.requestId).toBe('req-after-release');
    expect(last.context.turnId).toBe(turnId);
    expect(last.context.runtimeId).toBe('released');
  });

  it('runTurn early abort still emits turn_terminal', async () => {
    const events: RuntimeTraceEvent[] = [];
    const host: RuntimeHost = {
      cancelSubprocess: () => {},
      trace: (event) => {
        events.push(event);
        sharedRuntimeTraceSink.record(event);
      },
    };
    const runtime = new SessionRuntime('early-return-terminal', host);
    const controller = new AbortController();
    controller.abort('pre-aborted');

    const yielded: unknown[] = [];
    for await (const event of runtime.runTurn({
      initialMessages: [],
      systemPrompt: 'sys',
      options: { signal: controller.signal },
    })) {
      yielded.push(event);
    }

    expect(yielded).toEqual([]);
    const terminal = events.filter((e) => e.type === 'turn_terminal');
    expect(terminal.length).toBeGreaterThanOrEqual(1);
    expect(terminal.some((e) => String(e.reason).includes('pre-aborted'))).toBe(true);
    expect(runtime.getState()).toBe('idle');
  });
});
