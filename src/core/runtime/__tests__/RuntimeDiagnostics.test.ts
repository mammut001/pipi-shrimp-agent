import { describe, it, expect, beforeEach } from '@jest/globals';
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
  dumpRuntimeDiagnostics,
  getSessionHandle,
  getSessionRuntimeForTests,
  installRuntimeDiagnosticsDevDump,
  listLiveRuntimeSnapshots,
  releaseSessionRuntimeForTests,
  SessionRuntime,
} from '../SessionRuntime';

describe('Runtime diagnostics snapshot (P2 #6)', () => {
  const sessionA = 'diag-session-a';
  const sessionB = 'diag-session-b';

  beforeEach(() => {
    releaseSessionRuntimeForTests(sessionA);
    releaseSessionRuntimeForTests(sessionB);
    clearRuntimeTraceSink();
  });

  it('getSnapshot includes pending tool waits and activeTurnId', async () => {
    const handle = getSessionHandle(sessionA);
    const runtime = getSessionRuntimeForTests(sessionA)!;
    const turnId = runtime.startTurn();
    runtime.markWaitingTool(turnId, 'req-wait');
    const wait = runtime.getToolResultChannel().waitFor(
      'req-wait',
      ['tool-1', 'tool-2'],
      { turnId },
    );

    const snap = handle.getSnapshot();
    expect(snap.sessionId).toBe(sessionA);
    expect(snap.runtimeId).toBe(handle.runtimeId);
    expect(snap.activeTurnId).toBe(turnId);
    expect(snap.turnId).toBe(turnId);
    expect(snap.state).toBe('waiting_tool');
    expect(snap.pendingToolCount).toBe(2);
    expect(snap.waitingRequestIds).toEqual(['req-wait']);
    expect(snap.disposed).toBe(false);

    runtime.submitToolResults(
      'req-wait',
      [
        { id: 'tool-1', content: 'a' },
        { id: 'tool-2', content: 'b' },
      ],
      turnId,
    );
    await wait;
    expect(handle.getSnapshot().pendingToolCount).toBe(0);
    expect(handle.getSnapshot().waitingRequestIds).toEqual([]);
  });

  it('dumpRuntimeDiagnostics prints snapshots for all live sessions', () => {
    const handleA = getSessionHandle(sessionA);
    const handleB = getSessionHandle(sessionB);
    const runtimeA = getSessionRuntimeForTests(sessionA)!;
    const turnA = runtimeA.startTurn();
    runtimeA.markWaitingTool(turnA, 'req-a');
    void runtimeA.getToolResultChannel().waitFor('req-a', ['t1'], { turnId: turnA });

    const snapshots = listLiveRuntimeSnapshots();
    const ids = new Set(snapshots.map((s) => s.sessionId));
    expect(ids.has(sessionA)).toBe(true);
    expect(ids.has(sessionB)).toBe(true);
    const snapA = snapshots.find((s) => s.sessionId === sessionA)!;
    expect(snapA.waitingRequestIds).toContain('req-a');
    expect(snapA.pendingToolCount).toBeGreaterThanOrEqual(1);
    expect(snapA.activeTurnId).toBe(turnA);

    const dump = dumpRuntimeDiagnostics();
    expect(dump).toContain(sessionA);
    expect(dump).toContain(sessionB);
    expect(dump).toContain(handleA.runtimeId);
    expect(dump).toContain(handleB.runtimeId);
    expect(dump).toContain('waitingRequestIds');
    expect(dump).toContain('req-a');

    const target: Record<string, unknown> = {};
    const api = installRuntimeDiagnosticsDevDump(target);
    expect(target.__PIPI_RUNTIME_DIAG__).toBe(api);
    expect(api.dump()).toBe(dump);
    expect(api.getSnapshots().length).toBeGreaterThanOrEqual(2);
  });
});

describe('Trace export filter (P2 #7)', () => {
  beforeEach(() => {
    clearRuntimeTraceSink();
  });

  it('dumpJsonLines filters by sessionId and recent limit without payloads', () => {
    const hostA: RuntimeHost = {
      cancelSubprocess: () => {},
      trace: sharedRuntimeTraceSink.record,
    };
    const hostB: RuntimeHost = {
      cancelSubprocess: () => {},
      trace: sharedRuntimeTraceSink.record,
    };
    const runtimeA = new SessionRuntime('export-a', hostA);
    const runtimeB = new SessionRuntime('export-b', hostB);
    runtimeA.startTurn();
    runtimeB.startTurn();
    runtimeA.markWaitingTool(runtimeA.getActiveTurnId()!, 'req-a');
    runtimeB.markWaitingTool(runtimeB.getActiveTurnId()!, 'req-b');
    runtimeA.cancel('stop-a');

    const filtered = dumpRuntimeTraceJsonLines({ sessionId: 'export-a' });
    const lines = filtered.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const event = JSON.parse(line) as RuntimeTraceEvent;
      expect(event.context.sessionId).toBe('export-a');
      expect(event).not.toHaveProperty('arguments');
      expect(JSON.stringify(event)).not.toMatch(/api[_-]?key|password|secret/i);
    }
    expect(filtered).not.toContain('"sessionId":"export-b"');

    const limited = getRuntimeTraceEvents({ sessionId: 'export-a', limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
    expect(limited.every((e) => e.context.sessionId === 'export-a')).toBe(true);

    const ring = createRuntimeTraceRingBuffer(20);
    for (let i = 0; i < 10; i += 1) {
      ring.record({
        type: 'turn_started',
        at: i,
        context: { sessionId: i % 2 === 0 ? 'even' : 'odd', runtimeId: 'r', turnId: `t-${i}` },
      });
    }
    expect(ring.dumpJsonLines({ sessionId: 'even', limit: 2 }).split('\n').filter(Boolean)).toHaveLength(2);
    const evenRecent = ring.getEvents({ sessionId: 'even', limit: 2 });
    expect(evenRecent.map((e) => e.context.turnId)).toEqual(['t-6', 't-8']);

    const target: Record<string, unknown> = {};
    const api = installRuntimeTraceDevDump(target);
    expect(api.dumpJsonLines({ sessionId: 'export-b' })).toContain('export-b');
  });
});
