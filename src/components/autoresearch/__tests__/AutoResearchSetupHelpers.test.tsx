/** @jest-environment jsdom */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import {
  AutoResearchActiveRunBanner,
  AutoResearchPathSummary,
  AutoResearchRunHistoryCard,
} from '../AutoResearchSetupHelpers';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const { act } = React;

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.statusReflectionFailed': 'Reflection failed',
    'autoresearch.activeRun': 'Active run',
    'autoresearch.viewActiveRun': 'View active run',
    'autoresearch.browseHistory': 'Browse history',
    'autoresearch.summaryExperimentDir': 'Experiment dir',
    'autoresearch.summaryWorkdir': 'Workdir',
    'autoresearch.badgeActive': 'Active',
    'autoresearch.labelIteration': 'Iteration',
    'autoresearch.labelPhase': 'Phase',
    'autoresearch.labelUpdated': 'Updated',
    'autoresearch.labelBest': 'Best',
    'autoresearch.labelExperiment': 'Experiment',
  }[key] ?? key),
}));

function createRun(overrides: Partial<AutoResearchRunRecord> = {}): AutoResearchRunRecord {
  return {
    id: 'run-1',
    title: 'val_acc · /mnt/d/exp',
    status: 'running',
    createdAt: '2026-06-16T20:00:00.000Z',
    updatedAt: '2026-06-16T20:05:00.000Z',
    currentPhase: 'RUN_EXPERIMENT',
    config: {
      experimentDir: '/mnt/d/exp',
      workdir: '/mnt/d/workdir',
      metric: 'val_acc',
      direction: 'higher',
      iterations: 20,
      gpuTemperatureC: 49,
      configSnapshot: {
        configName: 'Primary',
        provider: 'openai',
        model: 'gpt-5',
        keyPresent: true,
        source: 'manual',
      },
    },
    currentIteration: 3,
    bestMetricValue: 0.9132,
    failureCount: 0,
    iterations: [],
    events: [],
    ...overrides,
  };
}

function renderElement(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AutoResearchSetupHelpers', () => {
  it('renders selected path summary with basename and full path', () => {
    const { container, root } = renderElement(
      <AutoResearchPathSummary label="Workdir" path="/mnt/d/WSL/Ubuntu/pipishrimp/.tmp/workdir" />,
    );

    expect(container.textContent).toContain('Workdir');
    expect(container.textContent).toContain('workdir');
    expect(container.textContent).toContain('/mnt/d/WSL/Ubuntu/pipishrimp/.tmp/workdir');

    act(() => {
      root.unmount();
    });
  });

  it('renders active run banner details and actions', () => {
    const run = createRun();
    const { container, root } = renderElement(
      <AutoResearchActiveRunBanner run={run} onView={() => {}} onBrowseHistory={() => {}} />,
    );

    expect(container.textContent).toContain('Active run');
    expect(container.textContent).toContain('View active run');
    expect(container.textContent).toContain('Browse history');
    expect(container.textContent).toContain('Iteration 3/20');
    expect(container.textContent).toContain('Phase RUN EXPERIMENT');

    act(() => {
      root.unmount();
    });
  });

  it('renders richer run history card metadata', () => {
    const run = createRun();
    const { container, root } = renderElement(
      <AutoResearchRunHistoryCard run={run} isSelected={false} isActive={true} onClick={() => {}} />,
    );

    expect(container.textContent).toContain('Active');
    expect(container.textContent).toContain('Best');
    expect(container.textContent).toContain('Experiment');
    expect(container.textContent).toContain('GPU 49C');
    expect(container.textContent).toContain('val_acc: 0.9132');

    act(() => {
      root.unmount();
    });
  });
});
