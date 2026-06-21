/** @jest-environment jsdom */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.lowerIsBetter': 'lower is better',
    'autoresearch.higherIsBetter': 'higher is better',
    'autoresearch.detail.autoResearch': 'Auto Research',
    'autoresearch.detail.demo': 'Demo',
    'autoresearch.detail.fullReport': 'Full report',
    'autoresearch.detail.open': 'Open',
    'autoresearch.detail.backToRuns': 'Back to Runs',
    'autoresearch.detail.close': 'Close',
    'autoresearch.reflectionReason': 'Reflection reason',
    'autoresearch.recentEvents.copyAll': 'Copy All',
    'autoresearch.recentEvents.copyOne': 'Copy event',
    'autoresearch.liveOutput.copy': 'Copy',
    'autoresearch.liveOutput.download': 'Download .log',
    'autoresearch.statusReflectionFailed': 'Reflection failed',
    'autoresearch.model.unknownProvider': 'Unknown provider',
    'autoresearch.model.unknownModel': 'Unknown model',
    'autoresearch.model.unknownCompact': 'Unknown provider · Unknown model',
  }[key] ?? key),
}));

jest.mock('@/components/document', () => ({
  DocumentContentCard: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DocumentMetadataSidebar: ({ children, sections }: { children?: React.ReactNode; sections?: Array<{ label: string; content: React.ReactNode }> }) => React.createElement(
    'aside',
    null,
    children,
    sections?.map((section) => React.createElement('section', { key: section.label }, section.content)),
  ),
  DocumentDetailShell: ({
    title,
    subtitle,
    onBack,
    backLabel,
    onOpen,
    openLabel,
    onClose,
    headerActions,
    children,
    sidebar,
  }: {
    title: string;
    subtitle?: string | null;
    onBack?: () => void;
    backLabel?: string;
    onOpen?: () => void;
    openLabel?: string;
    onClose?: () => void;
    headerActions?: React.ReactNode;
    children: React.ReactNode;
    sidebar?: React.ReactNode;
  }) => React.createElement(
    'div',
    null,
    React.createElement('h1', null, title),
    subtitle ? React.createElement('p', null, subtitle) : null,
    onBack ? React.createElement('button', { type: 'button', onClick: onBack }, backLabel ?? 'Back') : null,
    onOpen ? React.createElement('button', { type: 'button', onClick: onOpen }, openLabel ?? 'Open') : null,
    onClose ? React.createElement('button', { type: 'button', onClick: onClose }, 'Close') : null,
    headerActions,
    sidebar,
    children,
  ),
}));

jest.mock('../AutoResearchRunChips', () => ({
  AutoResearchRunChips: () => React.createElement('div', null, 'run-chips'),
}));

jest.mock('../AutoResearchDashboardMetricCard', () => ({
  AutoResearchDashboardMetricCard: () => React.createElement('div', null, 'Metric History'),
}));

jest.mock('@/services/autoresearch/demoRun', () => {
  const actual = jest.requireActual('@/services/autoresearch/demoRun') as typeof import('@/services/autoresearch/demoRun');
  return {
    ...actual,
    isDemoRun: () => false,
  };
});

let AutoResearchDashboardView: typeof import('../AutoResearchDashboardView').AutoResearchDashboardView;
let container: HTMLDivElement;
let root: Root;

function buildRun(): AutoResearchRunRecord {
  const base = createAutoResearchDemoRun();
  return {
    ...base,
    id: 'run-structured',
    title: 'Structured AutoResearch Run',
    status: 'failed',
    currentIteration: 2,
    currentPhase: 'FAILED',
    bestMetricValue: 0.91,
    bestIteration: 1,
    failureCount: 1,
    config: {
      ...base.config,
      metric: 'accuracy',
      direction: 'higher',
      preferredPythonCommand: 'python3',
      repoStatus: 'clean',
      dirtyFileCount: 0,
      gpuTelemetryAvailable: true,
      gpuSummary: 'temp=49C, fan=37%, util=41%, memory=1811/8192MB',
      gpuTemperatureC: 49,
      gpuFanSpeedPercent: 37,
      gpuUtilizationPercent: 41,
      gpuMemoryUsedMb: 1811,
      gpuMemoryTotalMb: 8192,
      configSnapshot: {
        configId: 'cfg-openai',
        configName: 'Primary Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        keyPreview: 'sk-demo',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
    },
    iterations: [
      {
        id: 'run-structured-iter-1',
        index: 1,
        status: 'completed',
        phase: 'DONE',
        hypothesis: 'Cache parsed dataset before training.',
        change: 'Cache parsed dataset',
        codeChangesSummary: 'Cache parsed dataset',
        reasoning: 'Keep the cache and compare batch sizes next.',
        reflectionSummary: 'Keep the cache and compare batch sizes next.',
        narrative: 'Tried caching parsed dataset. Changed: cache parsed dataset. Experiment completed with accuracy=0.91. Next: compare batch sizes.',
        executionCommand: 'python run_experiment.py --cache',
        exitCode: 0,
        durationMs: 62000,
        parsedMetrics: {
          accuracy: 0.91,
        },
        metricValue: 0.91,
        artifactPaths: ['/tmp/metrics.json', '/tmp/run.log', '/tmp/diff.patch'],
        startedAt: '2026-05-14T10:00:00.000Z',
        endedAt: '2026-05-14T10:01:02.000Z',
      },
      {
        id: 'run-structured-iter-2',
        index: 2,
        status: 'failed',
        phase: 'FAILED',
        hypothesis: 'Remove validation to speed up the run.',
        change: 'Skip validation',
        codeChangesSummary: 'Skip validation',
        reasoning: 'Restore validation and narrow the diff.',
        reflectionSummary: 'Restore validation and narrow the diff.',
        narrative: 'Removed validation to speed up the run. Changed: skip validation. Experiment failed: schema drift. Next: restore validation and narrow the diff.',
        executionCommand: 'python run_experiment.py --skip-validation',
        exitCode: 1,
        durationMs: 18000,
        parsedMetrics: {
          accuracy: null,
          exitCode: 1,
        },
        metricValue: null,
        error: 'Schema drift in validation fixtures.',
        artifactPaths: ['/tmp/metrics.json', '/tmp/run.log', '/tmp/diff.patch'],
        recoveryActions: [
          { type: 'open_raw_request_summary', supported: true, label: 'Open raw request summary' },
          { type: 'open_logs', supported: true, label: 'Open logs' },
        ],
        startedAt: '2026-05-14T10:02:00.000Z',
        endedAt: '2026-05-14T10:02:18.000Z',
      },
    ],
    events: [
      {
        id: 'event-plan',
        runId: 'run-structured',
        iterationId: 'run-structured-iter-1',
        timestamp: '2026-05-14T10:00:01.000Z',
        level: 'info',
        phase: 'PLAN_HYPOTHESIS',
        type: 'agent_plan',
        message: 'Plan: cache parsed dataset before training.',
        summary: 'Cache parsed dataset before training.',
      },
      {
        id: 'event-thinking',
        runId: 'run-structured',
        iterationId: 'run-structured-iter-1',
        timestamp: '2026-05-14T10:00:02.000Z',
        level: 'debug',
        phase: 'PLAN_HYPOTHESIS',
        type: 'thinking',
        message: 'Inspecting parser hotspots and dataset transforms.',
        summary: 'Inspecting parser hotspots.',
        detail: 'Inspecting parser hotspots and dataset transforms.\nComparing cache placement.\nValidating IO overhead.',
      },
      {
        id: 'event-tool-call',
        runId: 'run-structured',
        iterationId: 'run-structured-iter-1',
        timestamp: '2026-05-14T10:00:03.000Z',
        level: 'info',
        phase: 'EDIT_CODE',
        type: 'tool_call_started',
        message: 'write_file started.',
        summary: 'src/train.py',
        detail: {
          toolName: 'write_file',
          path: 'src/train.py',
          parameterSummary: 'src/train.py',
        },
      },
      {
        id: 'event-tool-result',
        runId: 'run-structured',
        iterationId: 'run-structured-iter-1',
        timestamp: '2026-05-14T10:00:04.000Z',
        level: 'debug',
        phase: 'EDIT_CODE',
        type: 'tool_result',
        message: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11',
        summary: 'write_file output',
        detail: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11',
      },
      {
        id: 'event-metric',
        runId: 'run-structured',
        iterationId: 'run-structured-iter-1',
        timestamp: '2026-05-14T10:01:05.000Z',
        level: 'info',
        phase: 'PARSE_METRICS',
        type: 'metrics_parsed',
        message: 'Metrics parsed for iteration 1.',
        summary: 'Iteration 1 reached accuracy=0.91.',
        detail: {
          metricName: 'accuracy',
          metricValue: 0.91,
        },
      },
      {
        id: 'event-provider-error',
        runId: 'run-structured',
        iterationId: 'run-structured-iter-2',
        timestamp: '2026-05-14T10:02:18.000Z',
        level: 'error',
        phase: 'FAILED',
        type: 'provider_error',
        message: 'Provider rate limited iteration 2.',
        summary: 'Provider rate limited iteration 2.',
        detail: {
          provider: 'OpenAI',
          model: 'gpt-4.1',
        },
      },
    ],
    liveOutputExcerpt: 'RAW LIVE OUTPUT\nline 2',
  };
}

function renderDashboard(run = buildRun()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root.render(React.createElement(AutoResearchDashboardView, { run, liveOutput: run.liveOutputExcerpt }));
  });
}

function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes(label));
  expect(button).toBeTruthy();
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('AutoResearchDashboardView structured UX', () => {
  beforeAll(async () => {
    ({ AutoResearchDashboardView } = await import('../AutoResearchDashboardView'));
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  });

  it('renders the run overview and iteration cards on the default summary tab', () => {
    renderDashboard();

    const text = container.textContent || '';
    expect(text).toContain('Run Overview');
    expect(text).toContain('Current phase');
    expect(text).toContain('Structured AutoResearch Run');
    expect(text).toContain('GPU temperature');
    expect(text).toContain('49C');
    expect(text).toContain('temp=49C, fan=37%, util=41%, memory=1811/8192MB');
    expect(text).toContain('Iteration 2');
    expect(text).toContain('Failure reason');
    expect(text).toContain('Schema drift in validation fixtures.');
    expect(text).toContain('accuracy=0.91');
    expect(text).toContain('Open raw request summary');
    expect(text).not.toContain('RAW LIVE OUTPUT');
  });

  it('surfaces an inspect-only recovery card for interrupted runs', () => {
    const interruptedRun = {
      ...buildRun(),
      status: 'interrupted' as const,
      summary: 'Interrupted after app restart.',
      reason: undefined,
    };

    renderDashboard(interruptedRun);

    const text = container.textContent || '';
    expect(container.querySelector('[data-recovery-card="run"]')).not.toBeNull();
    expect(text).toContain('Inspect-only recovery snapshot');
    expect(text).toContain('Interrupted after app restart.');
    expect(text).toContain('Execution will not auto-resume; start a new run to continue from the saved workspace.');
  });

  it('filters timeline events and keeps thinking/tool output collapsed by default', () => {
    renderDashboard();

    clickButton('Timeline');

    const summaryText = container.textContent || '';
    expect(summaryText).toContain('Iteration 1 reached accuracy=0.91.');
    expect(summaryText).toContain('Provider rate limited iteration 2.');
    expect(summaryText).not.toContain('src/train.py');

    clickButton('Tool calls');
    expect(container.textContent).toContain('src/train.py');
    expect(container.textContent).not.toContain('Provider rate limited iteration 2.');

    clickButton('Raw');
    const thinkingBlock = container.querySelector('details[data-event-kind="thinking"]');
    const toolResultBlock = container.querySelector('details[data-event-kind="tool-result"]');
    expect(thinkingBlock).not.toBeNull();
    expect(toolResultBlock).not.toBeNull();
    expect(thinkingBlock?.hasAttribute('open')).toBe(false);
    expect(toolResultBlock?.hasAttribute('open')).toBe(false);

    clickButton('Metrics');
    expect(container.querySelector('[data-event-kind="metrics"]')).not.toBeNull();

    clickButton('Errors');
    expect(container.querySelector('[data-event-kind="provider-error"]')).not.toBeNull();

    clickButton('Debug');
    expect(container.textContent).toContain('RAW LIVE OUTPUT');
  });
});
