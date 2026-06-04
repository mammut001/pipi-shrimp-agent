import { describe, expect, it } from '@jest/globals';
import {
  computeSelfImproveScore,
  computeSelfImproveScoreV2,
  determineSelfImproveStatus,
  classifySelfImproveRiskLevel,
} from '../scoring';
import type { SelfImproveResult } from '../schema';
import type { SelfImproveResultV2 } from '../schemaV2';

function createResult(overrides: Partial<SelfImproveResult> = {}): SelfImproveResult {
  return {
    schemaVersion: 1,
    mode: 'repo_self_improve',
    iteration: 1,
    phaseResults: {},
    changedFiles: [],
    commandsRun: [],
    buildPassed: null,
    testsPassed: null,
    typecheckPassed: null,
    riskLevel: 'low',
    status: 'IMPROVED',
    summary: 'Test result',
    nextRecommendation: '',
    ...overrides,
  };
}

describe('computeSelfImproveScore', () => {
  it('returns 0 for a result with no verification signals', () => {
    expect(computeSelfImproveScore(createResult())).toBe(0);
  });

  it('scores +30 for passing build', () => {
    expect(computeSelfImproveScore(createResult({ buildPassed: true }))).toBe(30);
  });

  it('scores +30 for passing tests', () => {
    expect(computeSelfImproveScore(createResult({ testsPassed: true }))).toBe(30);
  });

  it('scores +20 for passing typecheck', () => {
    expect(computeSelfImproveScore(createResult({ typecheckPassed: true }))).toBe(20);
  });

  it('scores +80 when all checks pass', () => {
    const result = createResult({
      buildPassed: true,
      testsPassed: true,
      typecheckPassed: true,
    });
    expect(computeSelfImproveScore(result)).toBe(80);
  });

  it('scores +10 for regression test files in changedFiles', () => {
    const result = createResult({
      changedFiles: ['src/services/__tests__/example.test.ts'],
    });
    expect(computeSelfImproveScore(result)).toBe(10);
  });

  it('penalizes -10 per unrelated directory beyond threshold', () => {
    const result = createResult({
      changedFiles: [
        'src/a/file1.ts',
        'src/b/file2.ts',
        'src/c/file3.ts',
        'src/d/file4.ts', // 4 distinct dirs > 3 threshold = 1 penalty
      ],
    });
    expect(computeSelfImproveScore(result)).toBe(-10);
  });

  it('penalizes -50 for verification failure', () => {
    const result = createResult({ buildPassed: false });
    expect(computeSelfImproveScore(result)).toBe(-50);
  });

  it('penalizes -20 for high risk', () => {
    const result = createResult({ riskLevel: 'high' });
    expect(computeSelfImproveScore(result)).toBe(-20);
  });

  it('computes combined score correctly', () => {
    const result = createResult({
      buildPassed: true,
      testsPassed: true,
      typecheckPassed: false,
      changedFiles: ['src/services/__tests__/fix.test.ts'], // +10 test bonus
      riskLevel: 'low',
    });
    // 30 + 30 + 0 + 10 - 50 (verification failure) = 20
    expect(computeSelfImproveScore(result)).toBe(20);
  });
});

describe('determineSelfImproveStatus', () => {
  it('returns NEEDS_REVIEW when agent marked it', () => {
    const result = createResult({ status: 'NEEDS_REVIEW' });
    expect(determineSelfImproveStatus(result, 50)).toBe('NEEDS_REVIEW');
  });

  it('returns FAILED when build fails', () => {
    const result = createResult({ buildPassed: false });
    expect(determineSelfImproveStatus(result, -50)).toBe('FAILED');
  });

  it('returns FAILED when typecheck fails', () => {
    const result = createResult({ typecheckPassed: false });
    expect(determineSelfImproveStatus(result, -30)).toBe('FAILED');
  });

  it('returns NEEDS_REVIEW when only tests fail', () => {
    const result = createResult({ testsPassed: false });
    expect(determineSelfImproveStatus(result, -20)).toBe('NEEDS_REVIEW');
  });

  it('returns NO_CHANGE when no files changed and score is zero', () => {
    const result = createResult({ changedFiles: [] });
    expect(determineSelfImproveStatus(result, 0)).toBe('NO_CHANGE');
  });

  it('returns IMPROVED when score is positive and no failures', () => {
    const result = createResult({
      buildPassed: true,
      testsPassed: true,
      typecheckPassed: true,
    });
    expect(determineSelfImproveStatus(result, 90)).toBe('IMPROVED');
  });
});

describe('classifySelfImproveRiskLevel', () => {
  it('returns low for small focused changes', () => {
    expect(classifySelfImproveRiskLevel(
      ['src/utils/logger.ts'],
      ['pnpm test'],
    )).toBe('low');
  });

  it('returns medium for moderate changes across directories', () => {
    expect(classifySelfImproveRiskLevel(
      ['src/a/file1.ts', 'src/b/file2.ts', 'src/c/file3.ts', 'src/d/file4.ts'],
      ['pnpm test'],
    )).toBe('medium');
  });

  it('returns medium for more than 5 files', () => {
    expect(classifySelfImproveRiskLevel(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
      ['pnpm test'],
    )).toBe('medium');
  });

  it('returns high for more than 10 files', () => {
    const files = Array.from({ length: 11 }, (_, i) => `file${i}.ts`);
    expect(classifySelfImproveRiskLevel(files, ['pnpm test'])).toBe('high');
  });

  it('returns high for dangerous commands', () => {
    expect(classifySelfImproveRiskLevel(
      ['src/file.ts'],
      ['rm -rf /tmp/data'],
    )).toBe('high');
  });

  it('returns low for empty changes', () => {
    expect(classifySelfImproveRiskLevel([], [])).toBe('low');
  });
});

describe('computeSelfImproveScoreV2', () => {
  function v2Base(overrides: Partial<SelfImproveResultV2> = {}): SelfImproveResultV2 {
    return {
      schemaVersion: 2,
      mode: 'repo_self_improve',
      iteration: 1,
      phaseResults: {},
      changedFiles: ['src/foo.ts'],
      commandsRun: ['pnpm run build'],
      buildPassed: true,
      testsPassed: true,
      typecheckPassed: true,
      riskLevel: 'low',
      status: 'IMPROVED',
      summary: 'fix foo',
      nextRecommendation: '',
      patch: { diffPath: 'diff.patch', addedLines: 3, deletedLines: 1, reverted: false },
      verification: [
        { command: 'pnpm run build', exitCode: 0, durationMs: 1000, status: 'pass', stdoutPath: null, stderrPath: null },
      ],
      workspace: { dirtyBefore: false, dirtyAfter: false },
      ...overrides,
    };
  }

  it('hard-fails when result.json is missing', () => {
    const out = computeSelfImproveScoreV2({
      result: v2Base(),
      options: { resultJsonPresent: false },
    });
    expect(out.status).toBe('FAILED');
    expect(out.score).toBeLessThan(-500);
    expect(out.notes).toContain('no_result_json: result.json missing on disk; iteration is a hard failure.');
  });

  it('penalizes per-command non-zero exit codes', () => {
    const out = computeSelfImproveScoreV2({
      result: v2Base({
        verification: [
          { command: 'pnpm run build', exitCode: 0, durationMs: 1000, status: 'pass', stdoutPath: null, stderrPath: null },
          { command: 'pnpm test', exitCode: 1, durationMs: 2000, status: 'fail', stdoutPath: null, stderrPath: null },
        ],
      }),
    });
    expect(out.notes.some((n) => n.startsWith('verification_failed'))).toBe(true);
  });

  it('penalizes dirtyAfter', () => {
    const out = computeSelfImproveScoreV2({
      result: v2Base({ workspace: { dirtyBefore: false, dirtyAfter: true } }),
    });
    expect(out.notes).toContain('dirty_after: workspace remained dirty after iteration.');
  });

  it('downgrades IMPROVED with no diff to NEEDS_REVIEW', () => {
    const out = computeSelfImproveScoreV2({
      result: v2Base({
        status: 'IMPROVED',
        patch: { diffPath: 'diff.patch', addedLines: 0, deletedLines: 0, reverted: false },
      }),
    });
    expect(out.status).toBe('NEEDS_REVIEW');
  });

  it('downgrades to NEEDS_REVIEW when changedFiles mismatches actual diff', () => {
    const out = computeSelfImproveScoreV2({
      result: v2Base({ changedFiles: ['src/a.ts'] }),
      options: { actualChangedFiles: ['src/b.ts'] },
    });
    expect(out.status).toBe('NEEDS_REVIEW');
    expect(out.notes.some((n) => n.includes('changed_files_mismatch'))).toBe(true);
  });

  it('forces NEEDS_REVIEW or FAILED on high-risk commands', () => {
    const out = computeSelfImproveScoreV2({
      result: v2Base({ commandsRun: ['rm -rf /tmp/build'] }),
    });
    expect(['NEEDS_REVIEW', 'FAILED']).toContain(out.status);
  });

  it('preserves IMPROVED when v2 signals are clean', () => {
    const out = computeSelfImproveScoreV2({ result: v2Base() });
    expect(out.status).toBe('IMPROVED');
    expect(out.score).toBeGreaterThan(0);
  });
});
