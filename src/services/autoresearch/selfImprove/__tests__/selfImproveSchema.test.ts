import { describe, expect, it } from '@jest/globals';
import {
  SelfImproveResultSchema,
  parseSelfImproveResult,
  mapSelfImproveStatusToExperimentStatus,
  buildSelfImproveMetricValue,
  type SelfImproveResult,
} from '../schema';

function createValidResult(overrides: Partial<SelfImproveResult> = {}): SelfImproveResult {
  return {
    schemaVersion: 1,
    mode: 'repo_self_improve',
    iteration: 1,
    phaseResults: {
      AUDIT: { phase: 'AUDIT', success: true },
      PLAN: { phase: 'PLAN', success: true },
      PATCH: { phase: 'PATCH', success: true },
      VERIFY: { phase: 'VERIFY', success: true, output: 'All checks passed.' },
      REFLECT: { phase: 'REFLECT', success: true },
      DECIDE_NEXT: { phase: 'DECIDE_NEXT', success: true },
    },
    changedFiles: ['src/utils/logger.ts'],
    commandsRun: ['pnpm run build', 'pnpm test'],
    buildPassed: true,
    testsPassed: true,
    typecheckPassed: true,
    riskLevel: 'low',
    status: 'IMPROVED',
    summary: 'Fixed import.meta.env usage in logger.ts',
    nextRecommendation: 'Fix remaining ESM/CJS interop issues in other files.',
    ...overrides,
  };
}

describe('SelfImproveResultSchema', () => {
  it('accepts a valid self-improve result', () => {
    const result = SelfImproveResultSchema.safeParse(createValidResult());
    expect(result.success).toBe(true);
  });

  it('rejects result with wrong mode', () => {
    const result = SelfImproveResultSchema.safeParse({
      ...createValidResult(),
      mode: 'ml_experiment',
    });
    expect(result.success).toBe(false);
  });

  it('rejects result with invalid status', () => {
    const result = SelfImproveResultSchema.safeParse({
      ...createValidResult(),
      status: 'UNKNOWN',
    });
    expect(result.success).toBe(false);
  });

  it('rejects result with invalid risk level', () => {
    const result = SelfImproveResultSchema.safeParse({
      ...createValidResult(),
      riskLevel: 'extreme',
    });
    expect(result.success).toBe(false);
  });

  it('accepts result with null verification values', () => {
    const result = SelfImproveResultSchema.safeParse(createValidResult({
      buildPassed: null,
      testsPassed: null,
      typecheckPassed: null,
    }));
    expect(result.success).toBe(true);
  });

  it('accepts result with NEEDS_REVIEW status', () => {
    const result = SelfImproveResultSchema.safeParse(createValidResult({
      status: 'NEEDS_REVIEW',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts result with empty phaseResults', () => {
    const result = SelfImproveResultSchema.safeParse(createValidResult({
      phaseResults: {},
    }));
    expect(result.success).toBe(true);
  });
});

describe('parseSelfImproveResult', () => {
  it('parses a valid JSON result from agent output', () => {
    const result = createValidResult();
    const output = `Here is my analysis:\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
    expect(parseSelfImproveResult(output)).toEqual(result);
  });

  it('parses a valid JSON result without fenced code blocks', () => {
    const result = createValidResult();
    const output = `Analysis complete. Result: ${JSON.stringify(result)}`;
    expect(parseSelfImproveResult(output)).toEqual(result);
  });

  it('returns null for output without valid JSON', () => {
    expect(parseSelfImproveResult('No results here.')).toBeNull();
  });

  it('returns null for JSON with wrong schema', () => {
    const output = JSON.stringify({ mode: 'ml_experiment', status: 'IMPROVED' });
    expect(parseSelfImproveResult(output)).toBeNull();
  });

  it('parses the last valid result when multiple exist', () => {
    const first = createValidResult({ summary: 'First attempt' });
    const second = createValidResult({ summary: 'Final result' });
    const output = `${JSON.stringify(first)}\nLater: ${JSON.stringify(second)}`;
    const parsed = parseSelfImproveResult(output);
    expect(parsed?.summary).toBe('Final result');
  });
});

describe('mapSelfImproveStatusToExperimentStatus', () => {
  it('maps IMPROVED to IMPROVED', () => {
    expect(mapSelfImproveStatusToExperimentStatus('IMPROVED')).toBe('IMPROVED');
  });

  it('maps NO_CHANGE to NOT_IMPROVED', () => {
    expect(mapSelfImproveStatusToExperimentStatus('NO_CHANGE')).toBe('NOT_IMPROVED');
  });

  it('maps FAILED to FAILED', () => {
    expect(mapSelfImproveStatusToExperimentStatus('FAILED')).toBe('FAILED');
  });

  it('maps NEEDS_REVIEW to FAILED', () => {
    expect(mapSelfImproveStatusToExperimentStatus('NEEDS_REVIEW')).toBe('FAILED');
  });
});

describe('buildSelfImproveMetricValue', () => {
  it('returns 1.0 when all checks pass', () => {
    const result = createValidResult();
    expect(buildSelfImproveMetricValue(result)).toBe(1);
  });

  it('returns 0.5 when only build and typecheck pass', () => {
    const result = createValidResult({ testsPassed: false });
    expect(buildSelfImproveMetricValue(result)).toBeCloseTo(0.667, 2);
  });

  it('returns null when status is FAILED', () => {
    const result = createValidResult({ status: 'FAILED' });
    expect(buildSelfImproveMetricValue(result)).toBeNull();
  });

  it('returns null when all checks are null', () => {
    const result = createValidResult({
      buildPassed: null,
      testsPassed: null,
      typecheckPassed: null,
      status: 'NO_CHANGE',
    });
    expect(buildSelfImproveMetricValue(result)).toBeNull();
  });
});
