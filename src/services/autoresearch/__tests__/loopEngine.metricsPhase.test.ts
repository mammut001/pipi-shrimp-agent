/**
 * Unit tests for AG-02 PR2b metrics-phase helpers extracted from loopEngine.ts.
 */
import { describe, expect, it } from '@jest/globals';
import {
  buildIterationNarrative,
  buildIterationParsedMetrics,
  buildIterationRecoveryActions,
  buildRateLimitRetryNarrative,
  isToolBudgetExhaustedReason,
  mergeArtifactPaths,
} from '../loopEngine.metricsPhase';

describe('loopEngine.metricsPhase helpers', () => {
  it('mergeArtifactPaths dedupes and drops blanks', () => {
    expect(mergeArtifactPaths(['a', 'b'], ['b', ' ', 'c'], undefined, ['a'])).toEqual(['a', 'b', 'c']);
  });

  it('buildIterationNarrative covers failed and successful outcomes', () => {
    expect(
      buildIterationNarrative({
        hypothesis: 'Try AdamW',
        change: 'lr=1e-3',
        status: 'FAILED',
        metricName: 'loss',
        metricValue: null,
        failReason: 'boom',
        nextStep: 'retry',
      }),
    ).toContain('Experiment failed: boom');

    expect(
      buildIterationNarrative({
        hypothesis: 'Try AdamW',
        status: 'IMPROVED',
        metricName: 'loss',
        metricValue: 0.5,
      }),
    ).toContain('loss=0.5');
  });

  it('buildIterationParsedMetrics merges extra fields', () => {
    expect(buildIterationParsedMetrics('loss', 1.25, { acc: 0.9 })).toEqual({
      loss: 1.25,
      acc: 0.9,
    });
  });

  it('buildRateLimitRetryNarrative includes cooldown', () => {
    expect(
      buildRateLimitRetryNarrative({
        iteration: 3,
        cooldownSeconds: 15,
        message: '429',
      }),
    ).toContain('15s');
  });

  it('isToolBudgetExhaustedReason detects budget exhaustion markers', () => {
    expect(isToolBudgetExhaustedReason(undefined)).toBe(false);
    expect(isToolBudgetExhaustedReason('tool_budget_exhausted')).toBe(true);
    expect(isToolBudgetExhaustedReason('Tool budget exhausted before evaluation')).toBe(true);
    expect(isToolBudgetExhaustedReason('budget exhausted before evaluation completed')).toBe(true);
    expect(isToolBudgetExhaustedReason('oom')).toBe(false);
  });

  it('buildIterationRecoveryActions emits increase_tool_budget only for budget fails', () => {
    expect(buildIterationRecoveryActions({ status: 'IMPROVED', hasLogs: true })).toEqual([]);

    const plain = buildIterationRecoveryActions({
      status: 'FAILED',
      hasLogs: false,
      failReason: 'parse error',
    });
    expect(plain.some((a) => a.type === 'increase_tool_budget')).toBe(false);
    expect(plain.find((a) => a.type === 'open_logs')?.supported).toBe(false);

    const budget = buildIterationRecoveryActions({
      status: 'FAILED',
      hasLogs: true,
      failReason: 'tool budget exhausted before evaluation completed',
    });
    expect(budget.some((a) => a.type === 'increase_tool_budget')).toBe(true);
  });
});
