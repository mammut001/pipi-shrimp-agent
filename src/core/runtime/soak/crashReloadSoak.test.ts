/**
 * Crash/reload soak Jest entry (GPT soak knife 2).
 *
 * Default: N=5 (fast CI). Longer:
 *   PIPI_CRASH_RELOAD_SOAK_ITERS=50 pnpm exec jest src/core/runtime/soak/crashReloadSoak.test.ts --runInBand --no-coverage
 *
 * Live Tauri kill/reopen checklist: docs/soak-crash-reload.md
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseSessionRuntimeForTests } from '../SessionRuntime';
import { clearRuntimeTraceSink, getRuntimeTraceEvents } from '../RuntimeTraceSink';
import { listOrphanToolCalls } from '../../../store/chat/scrubDanglingToolCalls';
import { buildApiMessages } from '../../../utils/chatHelpers';
import { harnessSessionEvents } from '../__tests__/manualDProductHarness';
import type { RuntimeTraceEvent } from '../RuntimeTrace';
import {
  resolveCrashReloadSoakIterations,
  runCrashReloadSoak,
  runCrashReloadSoakIteration,
} from './crashReloadSoak';
import type { CrashReloadIterationResult } from './types';

describe('crash/reload soak (kill mid-tool → hydrate → follow-up)', () => {
  let artifactRoot: string;

  beforeEach(() => {
    artifactRoot = mkdtempSync(join(tmpdir(), 'pipi-crash-reload-'));
    clearRuntimeTraceSink();
  });

  afterEach(() => {
    clearRuntimeTraceSink();
    try {
      rmSync(artifactRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('resolveCrashReloadSoakIterations: explicit > env > default 20', () => {
    const prevCrash = process.env.PIPI_CRASH_RELOAD_SOAK_ITERS;
    const prevSoak = process.env.PIPI_SOAK_ITERS;
    try {
      delete process.env.PIPI_CRASH_RELOAD_SOAK_ITERS;
      delete process.env.PIPI_SOAK_ITERS;
      expect(resolveCrashReloadSoakIterations()).toBe(20);
      expect(resolveCrashReloadSoakIterations(7)).toBe(7);
      process.env.PIPI_SOAK_ITERS = '40';
      expect(resolveCrashReloadSoakIterations()).toBe(40);
      process.env.PIPI_CRASH_RELOAD_SOAK_ITERS = '12';
      expect(resolveCrashReloadSoakIterations()).toBe(12);
    } finally {
      if (prevCrash === undefined) delete process.env.PIPI_CRASH_RELOAD_SOAK_ITERS;
      else process.env.PIPI_CRASH_RELOAD_SOAK_ITERS = prevCrash;
      if (prevSoak === undefined) delete process.env.PIPI_SOAK_ITERS;
      else process.env.PIPI_SOAK_ITERS = prevSoak;
    }
  });

  it('runCrashReloadSoakIteration: kill A mid-tool → hydrate interrupted → B ok → follow-up', async () => {
    const result = await runCrashReloadSoakIteration(1, 'jest-crash');
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.orphanCount).toBe(0);
    expect(listOrphanToolCalls(result.historyA!)).toEqual([]);
    expect(
      result.historyA!.some((m) => /interrupted before completion/i.test(String(m.content))),
    ).toBe(true);
    expect(
      result.historyB!.some((m) => /interrupted before completion|cancelled by user/i.test(String(m.content))),
    ).toBe(false);
    expect(
      result.historyB!.some((m) => String(m.content).includes('b-ok-after-a-kill')),
    ).toBe(true);

    const api = buildApiMessages(result.historyA!);
    expect(api.some((m) => Boolean(m.tool_calls?.length))).toBe(false);
    expect(api.some((m) => (
      typeof m.content === 'string' && m.content.includes('interrupted before completion')
    ))).toBe(true);

    releaseSessionRuntimeForTests(result.sessionA);
    releaseSessionRuntimeForTests(result.sessionB);
  });

  it('runCrashReloadSoak N=5 stopOnFailure dumps bundle on injected failure', async () => {
    let calls = 0;
    const summary = await runCrashReloadSoak({
      iterations: 5,
      artifactRoot,
      stopOnFailure: true,
      sessionPrefix: 'jest-crash-loop',
      runIteration: async (iteration, prefix) => {
        calls += 1;
        if (iteration === 3) {
          const fail: CrashReloadIterationResult = {
            ok: false,
            iteration,
            sessionA: `${prefix}-a-${iteration}`,
            sessionB: `${prefix}-b-${iteration}`,
            failures: [{
              invariant: 'hydrate_terminalizes_orphans',
              message: 'injected failure for bundle test',
            }],
          };
          return fail;
        }
        return runCrashReloadSoakIteration(iteration, prefix);
      },
    });
    expect(calls).toBe(3);
    expect(summary.ok).toBe(false);
    expect(summary.failedAt).toBe(3);
    expect(summary.iterationsCompleted).toBe(3);
    expect(summary.failureBundleDir).toBeDefined();
    expect(existsSync(summary.failureBundleDir!)).toBe(true);
    const meta = JSON.parse(readFileSync(join(summary.failureBundleDir!, 'meta.json'), 'utf8'));
    expect(meta.iteration).toBe(3);
    expect(meta.assertionMessage).toContain('injected failure');
  });

  it('runCrashReloadSoak N=5 all green', async () => {
    const summary = await runCrashReloadSoak({
      iterations: 5,
      artifactRoot,
      sessionPrefix: 'jest-crash-green',
    });
    expect(summary.ok).toBe(true);
    expect(summary.iterationsCompleted).toBe(5);
    expect(summary.failedAt).toBeUndefined();
    expect(summary.results.every((r) => r.ok)).toBe(true);
  });

  /**
   * GPT FIX FIRST residual: B contamination must use e.context.sessionId.
   * RuntimeTraceEvent has no top-level sessionId — checking e.sessionId always
   * false-greens (undefined !== sessionB). This test fails if that bug returns.
   */
  it('B cancel contamination filter uses context.sessionId (not top-level)', () => {
    const sessionB = 'reg-crash-b';
    const cancelOnB: RuntimeTraceEvent = {
      type: 'tool_cancelled',
      at: 1,
      context: { sessionId: sessionB, runtimeId: 'rt-b' },
    };
    const cancelOnA: RuntimeTraceEvent = {
      type: 'tool_cancelled',
      at: 2,
      context: { sessionId: 'reg-crash-a', runtimeId: 'rt-a' },
    };
    const events = [cancelOnA, cancelOnB];

    // Correct path (same as crashReloadSoak + harnessSessionEvents)
    const bEvents = harnessSessionEvents(events, sessionB);
    expect(bEvents.some((e) => e.type === 'tool_cancelled' || e.type === 'turn_cancelling')).toBe(true);

    // Wrong top-level field would miss the cancel → false-green isolation check
    const wrongFieldMisses = !events.some((e) => (
      (e as { sessionId?: string }).sessionId === sessionB
      && (e.type === 'tool_cancelled' || e.type === 'turn_cancelling')
    ));
    expect(wrongFieldMisses).toBe(true);
    expect((cancelOnB as { sessionId?: string }).sessionId).toBeUndefined();
    expect(cancelOnB.context.sessionId).toBe(sessionB);
  });

  it('iteration sink events expose sessionId only under context', async () => {
    clearRuntimeTraceSink();
    const result = await runCrashReloadSoakIteration(99, 'jest-ctx-sid');
    expect(result.ok).toBe(true);
    // Iteration already asserted no B cancel via context.sessionId; here we only
    // prove the event shape so a top-level e.sessionId check cannot work.
    const events = getRuntimeTraceEvents();
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect((e as { sessionId?: string }).sessionId).toBeUndefined();
      expect(typeof e.context.sessionId).toBe('string');
      expect(e.context.sessionId.length).toBeGreaterThan(0);
    }
    const bEvents = harnessSessionEvents(events, result.sessionB);
    expect(bEvents.length).toBeGreaterThan(0);
    // Wrong field would match zero events even when B has real traces
    expect(events.filter((e) => (e as { sessionId?: string }).sessionId === result.sessionB)).toEqual([]);
    releaseSessionRuntimeForTests(result.sessionA);
    releaseSessionRuntimeForTests(result.sessionB);
  });
});

const longIters = Number.parseInt(
  process.env.PIPI_CRASH_RELOAD_SOAK_ITERS ?? process.env.PIPI_SOAK_ITERS ?? '0',
  10,
);

(longIters >= 20 ? describe : describe.skip)(
  `crash/reload long soak PIPI_CRASH_RELOAD_SOAK_ITERS=${longIters}`,
  () => {
    it(`runs ${longIters} iterations`, async () => {
      const artifactRoot = mkdtempSync(join(tmpdir(), 'pipi-crash-long-'));
      try {
        const summary = await runCrashReloadSoak({
          iterations: longIters,
          artifactRoot,
          sessionPrefix: 'jest-crash-long',
        });
        expect(summary.ok).toBe(true);
        expect(summary.iterationsCompleted).toBe(longIters);
      } finally {
        rmSync(artifactRoot, { recursive: true, force: true });
      }
    }, 120_000);
  },
);
