/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { startAutoResearchRun } from '@/services/autoresearch/setupFlow';

const mockSetAgentPanelTab = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.localWorkDirPlaceholder': 'Local work dir',
    'autoresearch.remoteWorkDirPlaceholder': 'Remote work dir',
    'autoresearch.experimentDirPlaceholder': 'Experiment project directory',
    'autoresearch.metricNamePlaceholder': 'Metric name',
    'autoresearch.lowerIsBetter': 'Lower is better',
    'autoresearch.higherIsBetter': 'Higher is better',
    'autoresearch.maxIterationsShortPlaceholder': 'max',
    'autoresearch.prefillDefaults': 'Prefilled from AutoResearch defaults.',
    'autoresearch.prefillLastUsed': 'Prefilled from your last run.',
    'autoresearch.resetToDefaults': 'Reset to defaults',
    'autoresearch.start': 'Start AutoResearch',
    'autoresearch.starting': 'Starting AutoResearch...',
    'autoresearch.validationHostRequired': 'SSH host is required.',
    'autoresearch.validationUserRequired': 'SSH user is required.',
    'autoresearch.validationPasswordRequired': 'SSH password is required for password auth.',
    'autoresearch.validationKeyPathRequired': 'SSH key path is required for key auth.',
    'autoresearch.validationWorkdirRequired': 'Workdir is required.',
    'autoresearch.validationExperimentDirRequired': 'Experiment directory is required.',
    'autoresearch.validationMetricRequired': 'Metric name is required.',
    'autoresearch.validationBaselineNumber': 'Baseline must be a number.',
  }[key] ?? key),
}));

jest.mock('@/store', () => ({
  useUIStore: (selector: (state: { setAgentPanelTab: typeof mockSetAgentPanelTab }) => unknown) => selector({
    setAgentPanelTab: mockSetAgentPanelTab,
  }),
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: jest.fn(() => ({
    name: 'AutoResearch Test Config',
    provider: 'test',
    model: 'test-model',
  })),
  validateResolvedAgentConfig: jest.fn(() => []),
  formatAgentConfigValidationError: jest.fn(() => 'agent config invalid'),
}));

jest.mock('@/services/autoresearch/setupFlow', () => {
  const actual = jest.requireActual('@/services/autoresearch/setupFlow') as Record<string, unknown>;
  return {
    ...actual,
    startAutoResearchRun: jest.fn(),
  };
});

function findButtonByText(container: ParentNode, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as HTMLButtonElement | null;
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  act(() => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

let AutoResearchSetupModal: typeof import('../AutoResearchSetupModal').AutoResearchSetupModal;
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderModal() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(createElement(AutoResearchSetupModal));
  });

  return { container, root };
}

describe('AutoResearchSetupModal', () => {
  beforeAll(async () => {
    ({ AutoResearchSetupModal } = await import('../AutoResearchSetupModal'));
  });

  beforeEach(() => {
    mockSetAgentPanelTab.mockReset();
    jest.mocked(startAutoResearchRun).mockReset();
    useAutoResearchStore.getState().resetSession();
    useAutoResearchStore.setState({
      showSetupModal: true,
      loopState: 'idle',
      errorMessage: undefined,
      statusMessage: undefined,
      sshConfig: null,
      lastUsedConfig: null,
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

  it('uses the current edited local values and shows a loading state while starting', async () => {
    let resolveStart: (() => void) | null = null;
    jest.mocked(startAutoResearchRun).mockImplementation(() => new Promise((resolve) => {
      resolveStart = () => resolve({
        sessionId: 'run-1',
        resolvedConfig: {
          mode: 'local',
          host: '',
          user: 'root',
          keyPath: '',
          port: 22,
          remoteWorkDir: '/tmp/edited-workdir',
          authMode: 'agent',
          password: '',
        },
        preflight: {
          agentConfig: {
            configId: 'cfg-1',
            name: 'AutoResearch Test Config',
            provider: 'anthropic',
            model: 'test-model',
            apiFormat: 'openai',
            baseUrl: 'https://example.com',
            hasBaseUrl: true,
            apiKey: 'key',
            hasApiKey: true,
          },
          resolvedExperimentDir: '/tmp/edited-experiment',
          resolvedWorkDir: '/tmp/edited-workdir',
          sessionFilePath: '/tmp/edited-workdir/.pipi-shrimp/session.md',
          livingDocPath: '/tmp/edited-workdir/.pipi-shrimp/autoresearch.md',
          environmentSummary: {
            experimentDir: '/tmp/edited-experiment',
            gitRepo: true,
            repoStatus: 'clean',
            dirtyFileCount: 0,
            preferredPythonCommand: 'python3',
            worktreeWritable: true,
            runScriptPath: '/tmp/edited-experiment/run_experiment.py',
            notesPath: '/tmp/edited-experiment/AUTORESEARCH.md',
            recommendedRunCommand: 'python3 run_experiment.py',
          },
        },
      });
    }));

    const view = renderModal();
    const workdirInput = view.container.querySelector('input[aria-label="AutoResearch workdir"]') as HTMLInputElement | null;
    const experimentInput = view.container.querySelector('input[aria-label="Experiment path"]') as HTMLInputElement | null;
    expect(workdirInput).not.toBeNull();
    expect(experimentInput).not.toBeNull();

    changeInputValue(workdirInput!, '/tmp/edited-workdir');
    changeInputValue(experimentInput!, '/tmp/edited-experiment');

    const startButton = findButtonByText(view.container, 'Start AutoResearch');
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(jest.mocked(startAutoResearchRun)).toHaveBeenCalledWith(expect.objectContaining({
      sshConfig: expect.objectContaining({
        mode: 'local',
        remoteWorkDir: '/tmp/edited-workdir',
      }),
      experimentDir: '/tmp/edited-experiment',
    }), expect.any(Object));
    expect(startButton?.textContent).toContain('Starting AutoResearch...');
    expect(startButton?.disabled).toBe(true);

    await act(async () => {
      resolveStart?.();
      await Promise.resolve();
    });
  });

  it('shows a visible validation error instead of doing nothing for invalid SSH input', async () => {
    jest.mocked(startAutoResearchRun).mockResolvedValue({
      sessionId: 'run-1',
      resolvedConfig: {
        mode: 'ssh',
        host: 'example.com',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      preflight: {
        agentConfig: {
          configId: 'cfg-1',
          name: 'AutoResearch Test Config',
          provider: 'anthropic',
          model: 'test-model',
          apiFormat: 'openai',
          baseUrl: 'https://example.com',
          hasBaseUrl: true,
          apiKey: 'key',
          hasApiKey: true,
        },
        resolvedExperimentDir: '/tmp/exp',
        resolvedWorkDir: '/tmp/work',
        sessionFilePath: '/tmp/work/.pipi-shrimp/session.md',
        livingDocPath: '/tmp/work/.pipi-shrimp/autoresearch.md',
        environmentSummary: {
          experimentDir: '/tmp/exp',
          gitRepo: true,
          repoStatus: 'clean',
          dirtyFileCount: 0,
          preferredPythonCommand: 'python3',
          worktreeWritable: true,
          runScriptPath: '/tmp/exp/run_experiment.py',
          notesPath: '/tmp/exp/AUTORESEARCH.md',
          recommendedRunCommand: 'python3 run_experiment.py',
        },
      },
    });

    const view = renderModal();
    const sshButton = findButtonByText(view.container, 'SSH');
    expect(sshButton).not.toBeNull();

    act(() => {
      sshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const startButton = findButtonByText(view.container, 'Start AutoResearch');
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(view.container.textContent).toContain('SSH host is required.');
    expect(jest.mocked(startAutoResearchRun)).not.toHaveBeenCalled();
  });
});
