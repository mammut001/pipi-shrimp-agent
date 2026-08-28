import { describe, expect, it } from '@jest/globals';
import { buildMultiRoundGuidance } from '../iterationPrompt';
import type { IterationMetrics } from '../metricsStore';

function metric(overrides: Partial<IterationMetrics> = {}): IterationMetrics {
  return {
    iteration: 1,
    sessionId: 's1',
    metricName: 'cv_accuracy',
    metricValue: 0.8,
    status: 'IMPROVED',
    hypothesis: 'increase dropout',
    durationMs: 10,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('buildMultiRoundGuidance', () => {
  it('asks the first iteration to establish a baseline', () => {
    const text = buildMultiRoundGuidance({
      iteration: 1,
      maxIterations: 5,
      metricName: 'cv_accuracy',
      direction: 'higher',
      previous: [],
    });
    expect(text).toContain('iteration 1 of 5');
    expect(text).toMatch(/first iteration/i);
    expect(text).toMatch(/baseline/i);
  });

  it('tells later rounds not to repeat a failed hypothesis', () => {
    const text = buildMultiRoundGuidance({
      iteration: 3,
      maxIterations: 5,
      metricName: 'cv_accuracy',
      direction: 'higher',
      previous: [
        metric({ iteration: 1, status: 'FAILED', failReason: 'NaN', hypothesis: 'remove warmup', metricValue: null }),
        metric({ iteration: 2, status: 'NOT_IMPROVED', hypothesis: 'wider hidden layer', metricValue: 0.79 }),
      ],
    });
    expect(text).toContain('Previous iteration 2 was NOT_IMPROVED');
    expect(text).toContain('remove warmup');
    expect(text).toContain('different axis');
  });
});
