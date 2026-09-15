/**
 * Soak runner Jest entry (GPT soak P0 knife 1).
 *
 * Default: N=5 (fast CI). For longer soaks:
 *
 *   PIPI_SOAK_ITERS=200 pnpm exec jest src/core/runtime/soak/soakRunner.test.ts --runInBand --no-coverage
 *   PIPI_SOAK_ITERS=500 pnpm exec jest src/core/runtime/soak/soakRunner.test.ts --runInBand --no-coverage
 *
 * Or call runSoak({ iterations: 50 }) from a script.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseSessionRuntimeForTests } from '../SessionRuntime';
import { clearRuntimeTraceSink } from '../RuntimeTraceSink';
import { createMessage } from '../../../types/chat';
import type { Message } from '../../../types/chat';
import { listOrphanToolCalls } from '../../../store/chat/scrubDanglingToolCalls';
import {
  resolveSoakIterations,
  runSoak,
  runSoakIteration,
  buildSoakScenarioHistories,
  assertSoakHistoryInvariants,
} from './index';
import type { SoakAssertionFailure, SoakIterationResult } from './types';

describe('soak runner (Manual D loop + failure bundle)', () => {
  let artifactRoot: string;

  beforeEach(() => {
    artifactRoot = mkdtempSync(join(tmpdir(), 'pipi-soak-test-'));
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

  it('resolveSoakIterations: explicit > env > default 50', () => {
    const prev = process.env.PIPI_SOAK_ITERS;
    try {
      delete process.env.PIPI_SOAK_ITERS;
      expect(resolveSoakIterations()).toBe(50);
      expect(resolveSoakIterations(10)).toBe(10);
      process.env.PIPI_SOAK_ITERS = '200';
      expect(resolveSoakIterations()).toBe(200);
      expect(resolveSoakIterations(7)).toBe(7);
    } finally {
      if (prev === undefined) {
        delete process.env.PIPI_SOAK_ITERS;
      } else {
        process.env.PIPI_SOAK_ITERS = prev;
      }
    }
  });

  it('runSoakIteration: A cancel + B success + late A discard invariants', async () => {
    const result = await runSoakIteration(1, 'jest-soak');
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.orphanCount).toBe(0);
    releaseSessionRuntimeForTests(result.sessionA);
    releaseSessionRuntimeForTests(result.sessionB);
  });

  it('buildSoakScenarioHistories: A orphans / B resolved (real A/B histories)', () => {
    const { historyA, historyB } = buildSoakScenarioHistories(3);
    expect(listOrphanToolCalls(historyA).length).toBeGreaterThan(0);
    expect(listOrphanToolCalls(historyB)).toEqual([]);
    const failures: SoakAssertionFailure[] = [];
    const remaining = assertSoakHistoryInvariants(historyA, historyB, failures, 3);
    expect(failures).toEqual([]);
    expect(remaining).toBe(0);
  });

  it('runSoakIteration accepts custom histories and asserts against them', async () => {
    const { historyA, historyB } = buildSoakScenarioHistories(7);
    const result = await runSoakIteration(7, 'jest-soak-hist', { historyA, historyB });
    expect(result.ok).toBe(true);
    expect(result.orphanCount).toBe(0);
    releaseSessionRuntimeForTests(result.sessionA);
    releaseSessionRuntimeForTests(result.sessionB);
  });

  it('runSoakIteration fails orphan invariant when A history wrongly has no orphans', async () => {
    // Inject a "successful" A history (tool result present) — cancelled-as-success pollution.
    const tcId = 'tc-fake-success';
    const historyA: Message[] = [
      createMessage('user', 'a'),
      (() => {
        const m = createMessage('assistant', 'calling');
        m.tool_calls = [{ id: tcId, name: 'tool-a', arguments: '{}' }];
        return m;
      })(),
      {
        id: 'fake-result',
        role: 'user',
        content: `__TOOL_RESULT__:${tcId}:ok`,
        tool_call_id: tcId,
        timestamp: 2,
      },
    ];
    const { historyB } = buildSoakScenarioHistories(8);
    const result = await runSoakIteration(8, 'jest-soak-bad-a', { historyA, historyB });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.invariant === 'no_orphan_tool_calls'
      || f.invariant === 'no_cancelled_as_success')).toBe(true);
    releaseSessionRuntimeForTests(result.sessionA);
    releaseSessionRuntimeForTests(result.sessionB);
  });

  it('runSoak default short loop (N=5) stays green', async () => {
    const summary = await runSoak({
      iterations: 5,
      artifactRoot,
      sessionPrefix: 'jest-soak5',
    });
    expect(summary.ok).toBe(true);
    expect(summary.iterationsCompleted).toBe(5);
    expect(summary.failedAt).toBeUndefined();
    expect(summary.results).toHaveLength(5);
    expect(summary.results.every((r) => r.ok)).toBe(true);
  });

  it('runSoak N=10 documents longer CI-friendly soak', async () => {
    // Keep default suite small; this is still fast (pure latches, no sleeps).
    const summary = await runSoak({
      iterations: 10,
      artifactRoot,
      sessionPrefix: 'jest-soak10',
    });
    expect(summary.ok).toBe(true);
    expect(summary.iterationsCompleted).toBe(10);
  });

  it('stopOnFailure=false continues after failed iteration (still records failures/bundles)', async () => {
    const summary = await runSoak({
      iterations: 3,
      artifactRoot,
      sessionPrefix: 'jest-continue',
      stopOnFailure: false,
      runIteration: async (i, prefix): Promise<SoakIterationResult> => {
        if (i === 2) {
          return {
            ok: false,
            iteration: i,
            sessionA: `${prefix}-a-${i}`,
            sessionB: `${prefix}-b-${i}`,
            failures: [{
              invariant: 'scenario',
              message: 'forced failure for continue-after-fail test',
            }],
            orphanCount: 0,
          };
        }
        return runSoakIteration(i, prefix);
      },
    });

    expect(summary.ok).toBe(false);
    expect(summary.iterationsRequested).toBe(3);
    expect(summary.iterationsCompleted).toBe(3);
    expect(summary.failedAt).toBe(2);
    expect(summary.results).toHaveLength(3);
    expect(summary.results[0]?.ok).toBe(true);
    expect(summary.results[1]?.ok).toBe(false);
    expect(summary.results[2]?.ok).toBe(true);
    expect(summary.failureBundleDir).toBeDefined();
    expect(existsSync(summary.failureBundleDir!)).toBe(true);
    expect(summary.failureBundleDirs).toHaveLength(1);
    expect(existsSync(summary.failureBundleDirs![0]!)).toBe(true);
  });

  it('stopOnFailure=true (default) stops on first failure', async () => {
    const summary = await runSoak({
      iterations: 5,
      artifactRoot,
      sessionPrefix: 'jest-stop',
      // default stopOnFailure=true
      runIteration: async (i, prefix): Promise<SoakIterationResult> => {
        if (i === 2) {
          return {
            ok: false,
            iteration: i,
            sessionA: `${prefix}-a-${i}`,
            sessionB: `${prefix}-b-${i}`,
            failures: [{
              invariant: 'scenario',
              message: 'forced failure for stop-on-fail test',
            }],
            orphanCount: 0,
          };
        }
        return runSoakIteration(i, prefix);
      },
    });

    expect(summary.ok).toBe(false);
    expect(summary.iterationsCompleted).toBe(2);
    expect(summary.failedAt).toBe(2);
    expect(summary.results).toHaveLength(2);
    expect(summary.failureBundleDir).toBeDefined();
    expect(existsSync(summary.failureBundleDir!)).toBe(true);
  });

  it('failure bundle written on first invariant break (forced)', async () => {
    const { writeSoakFailureBundle } = await import('./failureBundle');
    const bundle = writeSoakFailureBundle({
      artifactRoot,
      iteration: 99,
      sessionA: 'forced-a',
      sessionB: 'forced-b',
      failures: [{
        invariant: 'no_cross_session_cancel',
        message: 'forced failure for bundle test',
      }],
    });
    expect(existsSync(bundle.dir)).toBe(true);
    expect(existsSync(bundle.metaPath)).toBe(true);
    expect(existsSync(bundle.diagnosticsPath)).toBe(true);
    expect(existsSync(bundle.traceAPath)).toBe(true);
    expect(existsSync(bundle.traceBPath)).toBe(true);
    const meta = JSON.parse(readFileSync(bundle.metaPath, 'utf8')) as {
      iteration: number;
      assertionMessage: string;
    };
    expect(meta.iteration).toBe(99);
    expect(meta.assertionMessage).toContain('forced failure');
  });
});

/**
 * Long soak (opt-in via PIPI_SOAK_ITERS). Skipped unless env is set to >= 20
 * so default CI stays fast. Documented in docs/soak-runner.md.
 */
describe('soak runner long loop (PIPI_SOAK_ITERS)', () => {
  const raw = process.env.PIPI_SOAK_ITERS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  const shouldRun = Number.isFinite(n) && n >= 20;

  const maybeIt = shouldRun ? it : it.skip;

  maybeIt(
    `runSoak PIPI_SOAK_ITERS=${raw} (>=20)`,
    async () => {
      const artifactRoot = mkdtempSync(join(tmpdir(), 'pipi-soak-long-'));
      try {
        const summary = await runSoak({
          iterations: n,
          artifactRoot,
          sessionPrefix: 'jest-soak-long',
        });
        expect(summary.ok).toBe(true);
        expect(summary.iterationsCompleted).toBe(n);
      } finally {
        rmSync(artifactRoot, { recursive: true, force: true });
      }
    },
    // Generous timeout for 200–500 iters (still latch-only; usually <30s).
    120_000,
  );
});
