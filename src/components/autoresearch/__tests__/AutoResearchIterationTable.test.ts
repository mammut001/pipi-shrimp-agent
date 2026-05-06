import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from '@jest/globals';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { AutoResearchIterationTable } from '../AutoResearchIterationTable';

function createRun(): AutoResearchRunRecord {
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
    currentIteration: 3,
    bestMetricValue: null,
    bestIteration: null,
    failureCount: 1,
    iterations: [
      { id: 'i1', index: 1, status: 'completed', metricValue: 0.968, change: 'Adjusted C', commitHash: 'abcdef1234567890' },
      { id: 'i2', index: 2, status: 'completed', metricValue: 0.964, hypothesis: 'Try gamma' },
      { id: 'i3', index: 3, status: 'failed', metricValue: null, error: 'train failed' },
    ],
    events: [],
  };
}

describe('AutoResearchIterationTable', () => {
  it('renders baseline, keep, discard, and failed rows', () => {
    const html = renderToStaticMarkup(React.createElement(AutoResearchIterationTable, {
      run: createRun(),
      selectedIteration: 1,
    }));

    expect(html).toContain('Baseline');
    expect(html).toContain('keep');
    expect(html).toContain('discard');
    expect(html).toContain('failed');
    expect(html).toContain('abcdef1234');
    expect(html).toContain('+0.0047 abs · +0.49%');
  });
});