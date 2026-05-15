/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { AutoResearchPanel } from '../AutoResearchPanel';
import { useAutoResearchStore } from '@/store/autoresearchStore';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(createElement(AutoResearchPanel));
  });

  return { container, root };
}

describe('AutoResearchPanel', () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    useAutoResearchStore.setState({
      id: 'run-1',
      loopState: 'running',
      currentIteration: 1,
      maxIterations: 5,
      bestMetric: 0.91,
      metricDirection: 'higher',
      metricName: 'cv_accuracy',
      consecutiveFailures: 0,
      experimentDir: '/tmp/exp',
      sessionFilePath: '/tmp/work/session.md',
      livingDocPath: '/tmp/work/report.md',
      startedAt: '2026-05-11T00:00:00.000Z',
      experiments: [],
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/work',
        authMode: 'agent',
        password: '',
      },
      agentConfigSnapshot: {
        configId: 'cfg-1',
        configName: 'Primary Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        keyPreview: 'sk-xxxx',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
      telegramConfig: {
        enabled: false,
        chatId: null,
        notifyOnImproved: true,
        notifyOnFailed: true,
        trendReportInterval: 10,
      },
      liveOutput: 'iteration log',
      selectedExperiment: -1,
      terminalVisible: false,
      terminalReady: false,
      terminalSessionId: null,
      terminalCwd: '/tmp/work',
      errorMessage: undefined,
      statusMessage: undefined,
      selectedRunId: 'run-1',
      lastUsedConfig: null,
      showSetupModal: false,
      runHistory: [
        {
          id: 'run-1',
          title: 'digits · cv_accuracy',
          status: 'running',
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:01:00.000Z',
          startedAt: '2026-05-11T00:00:00.000Z',
          config: {
            experimentDir: '/tmp/exp',
            workdir: '/tmp/work',
            sessionFilePath: '/tmp/work/session.md',
            livingDocPath: '/tmp/work/report.md',
            metric: 'cv_accuracy',
            direction: 'higher',
            iterations: 5,
            baseline: 0.9,
            configSnapshot: {
              configId: 'cfg-1',
              configName: 'Primary Config',
              provider: 'openai',
              providerLabel: 'OpenAI',
              apiFormat: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4.1',
              keyPreview: 'sk-xxxx',
              keyPresent: true,
              source: 'settings.activeConfig',
            },
          },
          currentIteration: 1,
          bestMetricValue: 0.91,
          bestIteration: 1,
          failureCount: 0,
          iterations: [],
          events: [],
          summary: undefined,
          liveOutputExcerpt: 'iteration log',
        },
      ],
    });
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
  });

  it('renders the snapshot-backed model label in the history row and active run card', () => {
    const view = renderPanel();

    expect(view.container.textContent).toContain('Primary Config · OpenAI · gpt-4.1');
    expect(view.container.textContent).not.toContain('[object Object]');
  });

  it('shows inspect-only recovery guidance for interrupted runs', () => {
    useAutoResearchStore.setState((state) => ({
      ...state,
      id: '',
      loopState: 'idle',
      runHistory: state.runHistory.map((run) => (
        run.id === 'run-1'
          ? {
            ...run,
            status: 'interrupted',
            summary: 'Interrupted after app restart.',
          }
          : run
      )),
    }));

    const view = renderPanel();

    expect(view.container.textContent).toContain('Inspect-only recovery snapshot');
    expect(view.container.textContent).toContain('Execution will not auto-resume; start a new run to continue from the saved workspace.');
  });
});