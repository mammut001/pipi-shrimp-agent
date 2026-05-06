import { describe, expect, it } from '@jest/globals';
import type { AutoResearchRunRecord } from '../history';
import {
  buildIterationSummaries,
  buildMetricTimeline,
  calculateMetricImpact,
  classifyIterationDecision,
  formatMetricImpact,
  formatMetricValue,
  getBestMetricPoint,
  summarizeIterationChange,
} from '../metricTimeline';

function createRun(overrides: Partial<AutoResearchRunRecord> = {}): AutoResearchRunRecord {
  return {
    id: 'run-1',
    title: 'digits · cv_accuracy',
    status: 'completed',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:05:00.000Z',
    startedAt: '2026-05-06T00:00:00.000Z',
    endedAt: '2026-05-06T00:05:00.000Z',
    config: {
      experimentDir: '/Users/yuhansong/Documents/tiny-autoresearch-digits',
      workdir: '/Users/yuhansong/autoresearch',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
      baseline: 0.963284,
      configSnapshot: {
        configName: 'MiniMax',
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        keyPresent: true,
        keyPreview: 'sk-abc...1234 (20 chars)',
        source: 'settings.activeConfig',
      },
    },
    currentIteration: 3,
    bestMetricValue: null,
    bestIteration: null,
    failureCount: 0,
    iterations: [],
    events: [],
    ...overrides,
  };
}

describe('AutoResearch metric timeline', () => {
  it('includes a baseline point before iteration 1', () => {
    const timeline = buildMetricTimeline(createRun());

    expect(timeline[0]).toMatchObject({
      iteration: 0,
      metricName: 'cv_accuracy',
      value: 0.963284,
      decision: 'baseline',
      isBaseline: true,
      isBestSoFar: true,
    });
  });

  it('classifies higher-is-better keep and discard decisions', () => {
    const run = createRun({
      iterations: [
        { id: 'i1', index: 1, status: 'completed', metricValue: 0.968 },
        { id: 'i2', index: 2, status: 'completed', metricValue: 0.965 },
        { id: 'i3', index: 3, status: 'completed', metricValue: 0.971 },
      ],
    });

    const timeline = buildMetricTimeline(run);

    expect(timeline.map((point) => [point.iteration, point.decision])).toEqual([
      [0, 'baseline'],
      [1, 'keep'],
      [2, 'discard'],
      [3, 'keep'],
    ]);
    expect(getBestMetricPoint(timeline)).toMatchObject({ iteration: 3, value: 0.971 });
  });

  it('classifies lower-is-better keep and discard decisions', () => {
    const run = createRun({
      config: {
        ...createRun().config,
        metric: 'val_loss',
        direction: 'lower',
        baseline: 1,
      },
      iterations: [
        { id: 'i1', index: 1, status: 'completed', metricValue: 0.9 },
        { id: 'i2', index: 2, status: 'completed', metricValue: 0.95 },
        { id: 'i3', index: 3, status: 'completed', metricValue: 0.85 },
      ],
    });

    expect(buildMetricTimeline(run).map((point) => point.decision)).toEqual([
      'baseline',
      'keep',
      'discard',
      'keep',
    ]);
  });

  it('keeps failed and no-metric iterations visible without adding numeric chart values', () => {
    const timeline = buildMetricTimeline(createRun({
      iterations: [
        { id: 'i1', index: 1, status: 'failed', metricValue: null, error: 'train failed' },
        { id: 'i2', index: 2, status: 'completed', metricValue: null },
      ],
    }));

    expect(timeline.map((point) => [point.iteration, point.value, point.decision])).toEqual([
      [0, 0.963284, 'baseline'],
      [1, null, 'failed'],
      [2, null, 'no_metric'],
    ]);
    expect(timeline.filter((point) => point.value !== null)).toHaveLength(1);
  });

  it('formats cv_accuracy impact from baseline', () => {
    const impact = calculateMetricImpact(0.968, 0.963284, 0.963284, 0.963284, 'higher');

    expect(formatMetricValue(0.963284)).toBe('0.963284');
    expect(formatMetricImpact(impact)).toBe('+0.0047 abs · +0.49%');
  });

  it('builds summaries for old records without persisted decision fields', () => {
    const summaries = buildIterationSummaries(createRun({
      iterations: [
        { id: 'i1', index: 1, status: 'completed', metricValue: 0.968, change: 'increase C' },
        { id: 'i2', index: 2, status: 'completed', metricValue: 0.964, hypothesis: 'try gamma' },
      ],
    }));

    expect(summaries.map((summary) => summary.status)).toEqual(['baseline', 'keep', 'discard']);
    expect(summaries[1]?.impactLabel).toBe('+0.0047 abs · +0.49%');
    expect(summaries[2]?.changeSummary).toBe('try gamma');
  });

  it('chooses compact change summary by priority', () => {
    expect(summarizeIterationChange({
      id: 'i1',
      index: 1,
      status: 'completed',
      change: 'explicit change',
      hypothesis: 'fallback hypothesis',
    })).toBe('explicit change');

    expect(summarizeIterationChange({
      id: 'i2',
      index: 2,
      status: 'failed',
      error: 'command failed',
    })).toBe('Error: command failed');

    expect(classifyIterationDecision({ status: 'running', metricValue: null }, 1, 'higher')).toBe('running');
  });
});