/** @jest-environment jsdom */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { formatAutoResearchEventDump, formatAutoResearchEventLine } from '@/services/autoresearch/eventPresentation';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';

jest.mock('../AutoResearchDashboardHeader', () => ({
  AutoResearchDashboardHeader: () => React.createElement('div', null, 'header'),
}));

jest.mock('../AutoResearchRunChips', () => ({
  AutoResearchRunChips: () => React.createElement('div', null, 'chips'),
}));

jest.mock('../AutoResearchDashboardMetricCard', () => ({
  AutoResearchDashboardMetricCard: () => React.createElement('div', null, 'metric-card'),
}));

jest.mock('../AutoResearchDashboardTable', () => ({
  AutoResearchDashboardTable: () => React.createElement('div', null, 'table'),
}));

jest.mock('@/services/autoresearch/demoRun', () => ({
  isDemoRun: () => false,
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('AutoResearchDashboardView clipboard actions', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const writeText = jest.fn(async () => undefined);

  const run: AutoResearchRunRecord = {
    id: 'run-local-1',
    title: 'Digits cv_accuracy',
    status: 'running',
    createdAt: '2026-05-11T10:00:00.000Z',
    updatedAt: '2026-05-11T10:05:00.000Z',
    config: {
      experimentDir: '/tmp/digits',
      workdir: '/tmp/digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 3,
      baseline: 0.9633,
      configSnapshot: {
        configId: 'cfg-1',
        configName: 'MiniMax',
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
    },
    currentIteration: 2,
    bestMetricValue: 0.9633,
    bestIteration: 1,
    failureCount: 0,
    iterations: [],
    events: [
      {
        id: 'event-1',
        runId: 'run-local-1',
        timestamp: '2026-05-11T10:01:00.000Z',
        level: 'info',
        phase: 'agent_execution',
        message: 'Iteration 1 started.',
      },
      {
        id: 'event-2',
        runId: 'run-local-1',
        timestamp: '2026-05-11T10:04:00.000Z',
        level: 'warn',
        phase: 'agent_execution',
        message: 'Tool budget 2/17 used (1 successful, 2 failed).',
        metadata: {
          tool_budget_used: 2,
          tool_budget_max: 17,
          failed_calls: 2,
          successful_calls: 1,
        },
      },
    ],
    liveOutputExcerpt: 'line 1\nline 2\n',
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });
    writeText.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('copies live output, all event lines, and single event lines', async () => {
    const { AutoResearchDashboardView } = await import('../AutoResearchDashboardView');

    await act(async () => {
      root.render(React.createElement(AutoResearchDashboardView, {
        run,
        liveOutput: 'line 1\nline 2\nline 3\n',
      }));
    });

    const timelineButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Timeline');
    expect(timelineButton).not.toBeNull();
    await act(async () => {
      timelineButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const copyAllButton = container.querySelector('[data-copy-target="recent-events-all"]') as HTMLButtonElement | null;
    const copyOneButton = container.querySelector('[data-copy-target="recent-event-line"]') as HTMLButtonElement | null;

    expect(copyAllButton).not.toBeNull();
    expect(copyOneButton).not.toBeNull();

    await act(async () => {
      copyAllButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenNthCalledWith(1, formatAutoResearchEventDump(run.events));

    await act(async () => {
      copyOneButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenNthCalledWith(2, '[2026-05-11T10:01:00.000Z] [PLAN_HYPOTHESIS] Iteration 1 started.');

    const debugButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Debug');
    expect(debugButton).not.toBeNull();
    await act(async () => {
      debugButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const copyRawEventsButton = container.querySelector('[data-copy-target="debug-raw-events"]') as HTMLButtonElement | null;
    const copyRawConversationButton = container.querySelector('[data-copy-target="debug-raw-conversation"]') as HTMLButtonElement | null;
    expect(copyRawEventsButton).not.toBeNull();
    expect(copyRawConversationButton).not.toBeNull();
    expect(container.querySelector('[data-copy-target="live-output-copy"]')).toBeNull();

    await act(async () => {
      copyRawEventsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenNthCalledWith(3, formatAutoResearchEventDump(run.events));

    await act(async () => {
      copyRawConversationButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenNthCalledWith(4, 'line 1\nline 2\nline 3\n');
  });
});
