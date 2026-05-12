/** @jest-environment jsdom */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';

const mockDownloadTextFile = jest.fn();
const mockNavigatorWriteText = jest.fn(async () => undefined);
const mockInvoke = jest.fn();
const mockSelectRun = jest.fn();
const mockSetSelectedExperiment = jest.fn();
const mockSetShowSetupModal = jest.fn();
const mockResetSession = jest.fn();

const run: AutoResearchRunRecord = {
  id: 'run-1',
  title: 'Digits local run',
  status: 'running',
  createdAt: '2026-05-12T09:00:00.000Z',
  updatedAt: '2026-05-12T09:05:00.000Z',
  config: {
    experimentDir: '/tmp/digits',
    workdir: '/tmp/digits',
    metric: 'cv_accuracy',
    direction: 'higher',
    iterations: 3,
    baseline: 0.961,
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
  bestMetricValue: 0.9684,
  bestIteration: 2,
  failureCount: 0,
  iterations: [
    {
      id: 'iter-1',
      index: 1,
      status: 'completed',
      hypothesis: 'test hypothesis',
      metricValue: 0.9684,
    },
  ],
  events: [
    {
      id: 'event-1',
      runId: 'run-1',
      timestamp: '2026-05-12T09:01:00.000Z',
      level: 'info',
      phase: 'agent_execution',
      message: 'Iteration 1 started.',
    },
    {
      id: 'event-2',
      runId: 'run-1',
      timestamp: '2026-05-12T09:02:00.000Z',
      level: 'warn',
      phase: 'terminal',
      message: 'stdout captured.',
    },
  ],
  liveOutputExcerpt: 'fallback excerpt\n',
};

const mockState = {
  loopState: 'running' as const,
  errorMessage: undefined as string | undefined,
  liveOutput: '\u001b[31mline 1\u001b[0m\nline 2\n',
  selectedExperiment: -1,
  selectedRunId: 'run-1',
  id: 'run-1',
  setSelectedExperiment: mockSetSelectedExperiment,
  selectRun: mockSelectRun,
  setShowSetupModal: mockSetShowSetupModal,
  resetSession: mockResetSession,
  selectedRun: run,
  selectedRunContext: {
    run,
    isActive: true,
    liveOutput: '\u001b[31mline 1\u001b[0m\nline 2\n',
    reason: undefined,
    statusMessage: undefined,
    loopState: 'running' as const,
    selectedIterationIndex: -1,
  },
  sortedRuns: [run],
};

function resolveState() {
  return {
    ...mockState,
    selectedRun: run,
    selectedRunContext: {
      ...mockState.selectedRunContext,
      run,
    },
    sortedRuns: [run],
  };
}

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: (selector?: (state: ReturnType<typeof resolveState>) => unknown) => {
    const state = resolveState();
    return typeof selector === 'function' ? selector(state) : state;
  },
  getSelectedAutoResearchRun: (state: ReturnType<typeof resolveState>) => state.selectedRun,
  getSelectedAutoResearchRunContext: (state: ReturnType<typeof resolveState>) => state.selectedRunContext,
  getSortedAutoResearchRuns: (state: ReturnType<typeof resolveState>) => state.sortedRuns,
}));

jest.mock('@/services/autoresearch/modelDisplay', () => ({
  buildAutoResearchModelDisplayFromSnapshot: () => ({
    compactLabel: 'MiniMax · MiniMax-M2.7',
  }),
}));

jest.mock('@/services/autoresearch', () => ({
  stopExperimentLoop: jest.fn(),
  pauseExperimentLoop: jest.fn(),
  resumeExperimentLoop: jest.fn(),
}));

jest.mock('@/services/docService', () => ({
  openFileExternal: jest.fn(),
}));

jest.mock('@/utils/clipboard', () => {
  const actual = jest.requireActual('@/utils/clipboard');
  return {
    ...actual,
    downloadTextFile: (...args: unknown[]) => mockDownloadTextFile(...args),
  };
});

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('../autoresearch/AutoResearchRunDetailDocument', () => ({
  AutoResearchRunDetailDocument: () => React.createElement('div', null, 'detail-document'),
}));

describe('AutoResearchPanel live output controls', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockNavigatorWriteText,
      },
    });
    document.execCommand = jest.fn(() => true);
    mockDownloadTextFile.mockClear();
    mockNavigatorWriteText.mockClear();
    mockInvoke.mockClear();
    mockSelectRun.mockClear();
    mockSetSelectedExperiment.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('copies the full live output buffer and shows copied feedback', async () => {
    const { AutoResearchPanel } = await import('../AutoResearchPanel');

    await act(async () => {
      root.render(React.createElement(AutoResearchPanel));
    });

    const copyButton = container.querySelector('[data-copy-target="live-output-copy"]') as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockNavigatorWriteText).toHaveBeenCalledWith('line 1\nline 2\n');
    const feedback = container.querySelector('[data-live-output-feedback="copied"]');
    expect(feedback?.textContent).toBe('Copied');
  });

  it('downloads the visible live output buffer using the iter filename', async () => {
    const { AutoResearchPanel } = await import('../AutoResearchPanel');

    await act(async () => {
      root.render(React.createElement(AutoResearchPanel));
    });

    const downloadButton = container.querySelector('[data-copy-target="live-output-download"]') as HTMLButtonElement | null;
    expect(downloadButton).not.toBeNull();

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockDownloadTextFile).toHaveBeenCalledWith('run-1-iter-002-live.log', 'line 1\nline 2\n');
  });

  it('clears only the visible live output and does not invoke any tauri delete command', async () => {
    const { AutoResearchPanel } = await import('../AutoResearchPanel');

    await act(async () => {
      root.render(React.createElement(AutoResearchPanel));
    });

    const clearButton = container.querySelector('[data-copy-target="live-output-clear"]') as HTMLButtonElement | null;
    const content = container.querySelector('[data-live-output-content]') as HTMLElement | null;

    expect(content?.textContent).toContain('line 1');
    expect(clearButton).not.toBeNull();

    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-live-output-content]')?.textContent).toBe('');
    expect(container.querySelector('[data-live-output-feedback="cleared"]')?.textContent).toBe('Cleared (file kept)');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('exposes per-row copy controls and copies individual event lines plus copy-all output', async () => {
    const { AutoResearchPanel } = await import('../AutoResearchPanel');

    await act(async () => {
      root.render(React.createElement(AutoResearchPanel));
    });

    const copyAllButton = container.querySelector('[data-copy-target="recent-events-all"]') as HTMLButtonElement | null;
    const rowCopyButtons = Array.from(container.querySelectorAll('[data-copy-target="recent-event-line"]')) as HTMLButtonElement[];

    expect(copyAllButton).not.toBeNull();
    expect(rowCopyButtons).toHaveLength(2);
    expect(rowCopyButtons[0]?.className).toContain('group-hover:opacity-100');

    await act(async () => {
      copyAllButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockNavigatorWriteText).toHaveBeenNthCalledWith(
      1,
      '[2026-05-12T09:02:00.000Z] [terminal] stdout captured.\n[2026-05-12T09:01:00.000Z] [agent_execution] Iteration 1 started.',
    );

    await act(async () => {
      rowCopyButtons[0]?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      rowCopyButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mockNavigatorWriteText).toHaveBeenNthCalledWith(
      2,
      '[2026-05-12T09:02:00.000Z] [terminal] stdout captured.',
    );
  });
});
