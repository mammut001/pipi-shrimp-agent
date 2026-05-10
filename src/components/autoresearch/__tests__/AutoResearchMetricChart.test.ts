import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.lowerIsBetter': 'lower is better',
    'autoresearch.higherIsBetter': 'higher is better',
    'autoresearch.detail.metricHistory': 'Metric History',
    'autoresearch.detail.noParsedMetricPoints': 'No parsed metric points yet.',
    'autoresearch.detail.baseline': 'Baseline',
    'autoresearch.detail.best': 'Best',
    'autoresearch.detail.iterationAxis': 'iteration',
    'autoresearch.detail.keepBreakthrough': 'keep / breakthrough',
    'autoresearch.detail.discard': 'discard',
    'autoresearch.detail.failedNoMetric': 'failed/no metric',
  }[key] ?? key),
}));

function createRun(iterations: AutoResearchRunRecord['iterations'] = []): AutoResearchRunRecord {
  return {
    id: 'run-1',
    title: 'digits · cv_accuracy',
    status: 'completed',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:05:00.000Z',
    config: {
      experimentDir: '/tmp/digits',
      workdir: '/tmp/autoresearch',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
      baseline: 0.963284,
      configSnapshot: {
        configName: 'MiniMax',
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
    },
    currentIteration: iterations.length,
    bestMetricValue: null,
    bestIteration: null,
    failureCount: 0,
    iterations,
    events: [],
  };
}

let AutoResearchMetricChart: typeof import('../AutoResearchMetricChart').AutoResearchMetricChart;

describe('AutoResearchMetricChart', () => {
  beforeAll(async () => {
    ({ AutoResearchMetricChart } = await import('../AutoResearchMetricChart'));
  });

  it('renders a baseline and metric points', () => {
    const html = renderToStaticMarkup(createElement(AutoResearchMetricChart, {
      run: createRun([{ id: 'i1', index: 1, status: 'completed', metricValue: 0.968 }]),
    }));

    expect(html).toContain('Metric History');
    expect(html).toContain('cv_accuracy');
    expect(html).toContain('baseline 0.963284');
    expect(html).toContain('iteration 1');
  });

  it('renders an empty state when no numeric metric exists', () => {
    const html = renderToStaticMarkup(createElement(AutoResearchMetricChart, {
      run: createRun([]),
      points: [],
    }));

    expect(html).toContain('No parsed metric points yet.');
  });

  it('renders dashboard variant styling for benchmark mode', () => {
    const html = renderToStaticMarkup(createElement(AutoResearchMetricChart, {
      run: createAutoResearchDemoRun(),
      variant: 'dashboard',
    }));

    expect(html).toContain('data-variant="dashboard"');
    expect(html).toContain('#b8c7e8');
    expect(html).toContain('stroke-dasharray="4 6"');
  });
});
