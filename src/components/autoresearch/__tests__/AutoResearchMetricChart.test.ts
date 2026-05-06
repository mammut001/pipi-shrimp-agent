import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from '@jest/globals';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { AutoResearchMetricChart } from '../AutoResearchMetricChart';

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

describe('AutoResearchMetricChart', () => {
  it('renders a baseline and metric points', () => {
    const html = renderToStaticMarkup(React.createElement(AutoResearchMetricChart, {
      run: createRun([{ id: 'i1', index: 1, status: 'completed', metricValue: 0.968 }]),
    }));

    expect(html).toContain('Metric History');
    expect(html).toContain('cv_accuracy');
    expect(html).toContain('baseline 0.963284');
    expect(html).toContain('iteration 1');
  });

  it('renders an empty state when no numeric metric exists', () => {
    const html = renderToStaticMarkup(React.createElement(AutoResearchMetricChart, {
      run: createRun([]),
      points: [],
    }));

    expect(html).toContain('No parsed metric points yet.');
  });
});