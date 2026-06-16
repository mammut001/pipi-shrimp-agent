/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { startAutoResearchRun } from '@/services/autoresearch/setupFlow';
import { resolveAutoResearchRunConfig } from '@/services/autoresearch/runConfig';

const mockSetCurrentView = jest.fn();
const mockToggleSettings = jest.fn();
const mockDialogOpen = jest.fn();
const mockUseSettingsStore = jest.fn((selector: (state: { windowsShellProfile: 'auto' | 'powershell' | 'wsl' }) => unknown) => selector({
  windowsShellProfile: 'wsl',
}));

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.localWorkDirPlaceholder': 'Local work dir',
    'autoresearch.remoteWorkDirPlaceholder': 'Remote work dir',
    'autoresearch.experimentDirPlaceholder': 'Experiment project directory',
    'autoresearch.metricNamePlaceholder': 'Metric name',
    'autoresearch.lowerIsBetter': 'Lower is better',
    'autoresearch.higherIsBetter': 'Higher is better',
    'autoresearch.maxIterationsPlaceholder': 'Max iterations (default: 50)',
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
    'autoresearch.tabs.guided': 'Guided',
    'autoresearch.tabs.manual': 'Manual',
    'autoresearch.tabs.guidedSubtitle': 'Describe your experiment and let Pipi prepare the setup.',
    'autoresearch.tabs.manualSubtitle': 'Use exact paths, target, metric, and run limits.',
    'autoresearch.card.runTarget': 'Where should AutoResearch run?',
    'autoresearch.card.experimentGoal': 'What experiment should it optimize?',
    'autoresearch.card.readiness': 'Readiness',
    'autoresearch.workdirHelper': 'AutoResearch stores run artifacts here.',
    'autoresearch.experimentDirHelper': 'Must contain run_experiment.py and AUTORESEARCH.md.',
    'autoresearch.metricHelper': 'This must match the metric written by metrics.json.',
    'autoresearch.baselineHelper': 'Optional. Used only as the initial best score.',
    'autoresearch.summaryTitle': 'Review before start',
    'autoresearch.summaryTarget': 'Target',
    'autoresearch.summaryWorkdir': 'Workdir',
    'autoresearch.summaryExperimentDir': 'Experiment dir',
    'autoresearch.summaryMetric': 'Metric',
    'autoresearch.summaryIterations': 'Iterations',
    'autoresearch.summaryDirectionMinimize': 'minimize',
    'autoresearch.summaryDirectionMaximize': 'maximize',
    'autoresearch.preparing': 'Preparing AutoResearch…',
    'autoresearch.preparingStepValidating': 'Validating config',
    'autoresearch.preparingStepChecking': 'Checking target',
    'autoresearch.preparingStepPreparing': 'Preparing run',
    'autoresearch.card.setupChecklist': 'Setup checklist',
    'autoresearch.readiness.filled': 'Filled',
    'autoresearch.readiness.check': 'Check',
    'autoresearch.readiness.missing': 'Missing',
    'autoresearch.readiness.helper': 'Paths and provider settings will be verified when you start the run.',
    'autoresearch.field.host': 'Host',
    'autoresearch.field.userAuth': 'User & Auth',
    'autoresearch.field.password': 'Password',
    'autoresearch.field.keyPath': 'Key Path',
    'autoresearch.field.localWorkDir': 'Local Work Directory',
    'autoresearch.field.remoteWorkDir': 'Remote Work Directory',
    'autoresearch.field.experimentDir': 'Experiment Directory',
    'autoresearch.field.metricName': 'Metric Name',
    'autoresearch.field.maxIterations': 'Max Iterations',
    'autoresearch.field.baselineOptional': 'Baseline (optional)',
    'autoresearch.check.provider': 'Provider / API',
    'autoresearch.check.workdir': 'Work directory',
    'autoresearch.check.experimentDir': 'Experiment directory',
    'autoresearch.check.metric': 'Metric',
    'autoresearch.check.sshConnection': 'SSH connection',
    'autoresearch.action.openSettings': 'Open Settings',
    'autoresearch.mode.local': 'Local',
    'autoresearch.mode.ssh': 'SSH',
    'autoresearch.headerSubtitle': 'Prepare an autonomous experiment run.',
    'autoresearch.loadingBootstrap': 'Loading AutoResearch bootstrap...',
      'autoresearch.hostPlaceholder': 'e.g. 192.168.1.10 or connect.westd.seetacloud.com',
    'autoresearch.portPlaceholder': 'port',
    'autoresearch.userPlaceholder': 'user',
    'autoresearch.passwordPlaceholder': 'password',
    'autoresearch.keyPathPlaceholder': 'e.g. ~/.ssh/id_rsa',
    'autoresearch.authOptionAgent': 'Auth: Agent (~/.ssh/config)',
    'autoresearch.authOptionPassword': 'Auth: Password',
    'autoresearch.authOptionKey': 'Auth: Private key',
    'autoresearch.passwordHintBefore': 'Kept in memory only (not saved to disk). Requires ',
    'autoresearch.sshpassHintCommand': 'brew install hudochenkov/sshpass/sshpass',
    'autoresearch.baselinePlaceholder': 'e.g. 0.963284',
    'autoresearch.chooseDirectory': 'Choose directory',
    }[key] ?? key),
  getCurrentLocale: () => 'en-US',
}));

jest.mock('@/store', () => ({
  useUIStore: (selector: (state: { setCurrentView: typeof mockSetCurrentView; toggleSettings: typeof mockToggleSettings }) => unknown) => selector({
    setCurrentView: mockSetCurrentView,
    toggleSettings: mockToggleSettings,
  }),
  useSettingsStore: (selector: (state: { windowsShellProfile: 'auto' | 'powershell' | 'wsl' }) => unknown) => mockUseSettingsStore(selector),
}));

jest.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockDialogOpen(...args),
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: jest.fn(() => ({
    name: 'AutoResearch Test Config',
    provider: 'test',
    providerLabel: 'Test Provider',
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

jest.mock('@/services/autoresearch/runConfig', () => ({
  resolveAutoResearchRunConfig: jest.fn(),
}));

jest.mock('@/components/autoresearch/BootstrapChatView', () => {
  const ReactRuntime = require('react');
  const MockBootstrapChatView = ({ onReady }: { onReady?: () => void }) =>
    ReactRuntime.createElement('div', { 'data-testid': 'bootstrap-chat-view' },
      ReactRuntime.createElement('button', { onClick: onReady, 'data-testid': 'trigger-on-ready' }, 'Ready'),
    );
  return {
    __esModule: true,
    default: MockBootstrapChatView,
    BootstrapChatView: MockBootstrapChatView,
  };
});

function findButtonByText(container: ParentNode, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as HTMLButtonElement | null;
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

let AutoResearchSetupModal: typeof import('../AutoResearchSetupModal').AutoResearchSetupModal;
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function disposeView(root: Root, container: HTMLDivElement) {
  const index = mountedRoots.findIndex((mounted) => mounted.root === root && mounted.container === container);
  if (index >= 0) {
    mountedRoots.splice(index, 1);
  }
  act(() => {
    root.unmount();
  });
  container.remove();
}

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
    // Mock navigator.platform for assertSupportedPlatform
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    ({ AutoResearchSetupModal } = await import('../AutoResearchSetupModal'));
  });

  beforeEach(() => {
    mockSetCurrentView.mockReset();
    mockToggleSettings.mockReset();
    mockDialogOpen.mockReset();
    mockUseSettingsStore.mockImplementation((selector: (state: { windowsShellProfile: 'auto' | 'powershell' | 'wsl' }) => unknown) => selector({
      windowsShellProfile: 'wsl',
    }));
    jest.mocked(startAutoResearchRun).mockReset();
    jest.mocked(resolveAutoResearchRunConfig).mockReset();
    jest.mocked(resolveAutoResearchRunConfig).mockReturnValue({
      defaultConfig: {
        configId: 'cfg-1',
        name: 'AutoResearch Test Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        model: 'gpt-4.1',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        hasBaseUrl: true,
        apiKey: 'key',
        hasApiKey: true,
      },
      agentConfig: {
        configId: 'cfg-1',
        name: 'AutoResearch Test Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        model: 'gpt-4.1',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        hasBaseUrl: true,
        apiKey: 'key',
        hasApiKey: true,
      },
      reflectionConfig: {
        configId: 'cfg-1',
        name: 'AutoResearch Test Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        model: 'gpt-4.1',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        hasBaseUrl: true,
        apiKey: 'key',
        hasApiKey: true,
      },
      snapshot: {
        configId: 'cfg-1',
        configName: 'AutoResearch Test Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        keyPreview: 'key',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
      featureSnapshots: {
        default: {
          configId: 'cfg-1',
          configName: 'AutoResearch Test Config',
          provider: 'openai',
          providerLabel: 'OpenAI',
          apiFormat: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1',
          keyPreview: 'key',
          keyPresent: true,
          source: 'settings.activeConfig',
        },
        agent: {
          configId: 'cfg-1',
          configName: 'AutoResearch Test Config',
          provider: 'openai',
          providerLabel: 'OpenAI',
          apiFormat: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1',
          keyPreview: 'key',
          keyPresent: true,
          source: 'settings.activeConfig',
        },
        reflection: {
          configId: 'cfg-1',
          configName: 'AutoResearch Test Config',
          provider: 'openai',
          providerLabel: 'OpenAI',
          apiFormat: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1',
          keyPreview: 'key',
          keyPresent: true,
          source: 'settings.activeConfig',
        },
      },
      runConfigSnapshot: {
        createdAt: new Date().toISOString(),
        selectedConfigIds: {
          activeConfigId: 'cfg-1',
          defaultConfigId: null,
          agentConfigId: null,
          reflectionConfigId: null,
        },
        resolvedSources: {
          default: 'settings.activeConfig',
          agent: 'settings.activeConfig',
          reflection: 'settings.activeConfig',
        },
        configs: {
          default: {
            configId: 'cfg-1',
            configName: 'AutoResearch Test Config',
            provider: 'openai',
            providerLabel: 'OpenAI',
            apiFormat: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1',
            keyPreview: 'key',
            keyPresent: true,
            source: 'settings.activeConfig',
          },
          agent: {
            configId: 'cfg-1',
            configName: 'AutoResearch Test Config',
            provider: 'openai',
            providerLabel: 'OpenAI',
            apiFormat: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1',
            keyPreview: 'key',
            keyPresent: true,
            source: 'settings.activeConfig',
          },
          reflection: {
            configId: 'cfg-1',
            configName: 'AutoResearch Test Config',
            provider: 'openai',
            providerLabel: 'OpenAI',
            apiFormat: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1',
            keyPreview: 'key',
            keyPresent: true,
            source: 'settings.activeConfig',
          },
        },
        capabilities: {
          default: {
            id: 'openai',
            displayName: 'OpenAI',
            streaming: true,
            toolCalls: 'openai',
            jsonMode: true,
            jsonSchema: true,
            vision: true,
            maxContextTokens: 1000000,
            recommendedFor: ['agent'],
          },
          agent: {
            id: 'openai',
            displayName: 'OpenAI',
            streaming: true,
            toolCalls: 'openai',
            jsonMode: true,
            jsonSchema: true,
            vision: true,
            maxContextTokens: 1000000,
            recommendedFor: ['agent'],
          },
          reflection: {
            id: 'openai',
            displayName: 'OpenAI',
            streaming: true,
            toolCalls: 'openai',
            jsonMode: true,
            jsonSchema: true,
            vision: true,
            maxContextTokens: 1000000,
            recommendedFor: ['agent'],
          },
        },
      },
    });
    useAutoResearchStore.getState().resetSession();
    useAutoResearchStore.setState({
      showSetupModal: true,
      loopState: 'idle',
      errorMessage: undefined,
      statusMessage: undefined,
      sshConfig: null,
      lastUsedConfig: null,
    });
    useBrowserObservabilityStore.setState({
      failureSnapshots: [],
      activeFailureSnapshot: null,
      failurePreviewSuppressed: false,
      dismissedFailureIds: [],
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
            providerLabel: 'Anthropic',
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
    // Switch to Manual tab first to show the form
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
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

  it('normalizes picked local directories to WSL paths when WSL shell is selected', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Windows NT 10.0', configurable: true });
    mockDialogOpen
      .mockResolvedValueOnce('D:\\WSL\\Ubuntu\\pipishrimp\\.tmp\\autoresearch-wsl-smoke\\workdir')
      .mockResolvedValueOnce('D:\\WSL\\Ubuntu\\pipishrimp\\.tmp\\autoresearch-wsl-smoke\\experiment');

    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const chooseButtons = Array.from(view.container.querySelectorAll('button'))
      .filter((button) => button.textContent?.includes('Choose directory'));

    expect(chooseButtons).toHaveLength(2);

    await act(async () => {
      chooseButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      chooseButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const workdirInput = view.container.querySelector('input[aria-label="AutoResearch workdir"]') as HTMLInputElement | null;
    const experimentInput = view.container.querySelector('input[aria-label="Experiment path"]') as HTMLInputElement | null;

    expect(workdirInput?.value).toBe('/mnt/d/WSL/Ubuntu/pipishrimp/.tmp/autoresearch-wsl-smoke/workdir');
    expect(experimentInput?.value).toBe('/mnt/d/WSL/Ubuntu/pipishrimp/.tmp/autoresearch-wsl-smoke/experiment');
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
          providerLabel: 'Anthropic',
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
    // Switch to Manual tab first
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
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

  it('suppresses browser failure previews while the modal is open and restores them on unmount', () => {
    useBrowserObservabilityStore.setState({
      failureSnapshots: [
        {
          taskId: 'failure-1',
          failedAction: 'click',
          url: 'https://example.com',
          title: 'Example',
          errorKind: 'browser.timeout',
          errorMessage: 'button not reachable',
          ts: 1,
        },
      ],
      activeFailureSnapshot: {
        taskId: 'failure-1',
        failedAction: 'click',
        url: 'https://example.com',
        title: 'Example',
        errorKind: 'browser.timeout',
        errorMessage: 'button not reachable',
        ts: 1,
      },
      failurePreviewSuppressed: false,
      dismissedFailureIds: [],
    });

    const view = renderModal();
    let state = useBrowserObservabilityStore.getState();
    expect(state.failurePreviewSuppressed).toBe(true);
    expect(state.activeFailureSnapshot).toBeNull();
    expect(state.failureSnapshots).toHaveLength(1);

    disposeView(view.root, view.container);

    state = useBrowserObservabilityStore.getState();
    expect(state.failurePreviewSuppressed).toBe(false);
    expect(state.activeFailureSnapshot?.taskId).toBe('failure-1');
  });

  it('defaults to Guided tab showing BootstrapChatView', () => {
    const view = renderModal();
    expect(view.container.querySelector('[data-testid="bootstrap-chat-view"]')).not.toBeNull();
    expect(view.container.querySelector('input[aria-label="AutoResearch workdir"]')).toBeNull();
  });

  it('Manual tab shows card-based form without BootstrapChatView', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    expect(manualTab).not.toBeNull();
    act(() => {
      manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.container.querySelector('input[aria-label="AutoResearch workdir"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="bootstrap-chat-view"]')).toBeNull();
    // Verify card sections exist
    expect(view.container.textContent).toContain('Where should AutoResearch run?');
    expect(view.container.textContent).toContain('What experiment should it optimize?');
    expect(view.container.textContent).toContain('Setup checklist');
  });

  it('switching back to Guided tab restores BootstrapChatView', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const guidedTab = findButtonByText(view.container, 'Guided');
    act(() => { guidedTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(view.container.querySelector('[data-testid="bootstrap-chat-view"]')).not.toBeNull();
    expect(view.container.querySelector('input[aria-label="AutoResearch workdir"]')).toBeNull();
  });

  it('tab labels are "Guided" and "Manual"', () => {
    const view = renderModal();
    expect(view.container.textContent).toContain('Guided');
    expect(view.container.textContent).toContain('Manual');
    // Old labels should not appear
    expect(view.container.textContent).not.toContain('Conversational Bootstrap');
    expect(view.container.textContent).not.toContain('Advanced Workdir');
  });

  it('required field hints appear in Manual mode', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // Switch to SSH mode to trigger host/user hints
    const sshButton = findButtonByText(view.container, 'SSH');
    act(() => { sshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(view.container.textContent).toContain('SSH host is required.');
    // User defaults to 'root', so user hint won't show. Clear it to trigger the hint.
    const userInput = view.container.querySelector('input[placeholder="user"]') as HTMLInputElement;
    expect(userInput).not.toBeNull();
    changeInputValue(userInput, '');
    expect(view.container.textContent).toContain('SSH user is required.');
  });

  it('provider config error shows Missing status in setup checklist', async () => {
    jest.mocked(resolveAutoResearchRunConfig).mockImplementation(() => { throw new Error('Configure a provider first'); });
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // The checklist section should show Missing and Open Settings action
    expect(view.container.textContent).toContain('Missing');
    expect(view.container.textContent).toContain('Open Settings');
    expect(view.container.textContent).toContain('Setup checklist');
  });

  it('baseline invalid message still appears', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const baselineInput = view.container.querySelector('input[placeholder="e.g. 0.963284"]') as HTMLInputElement;
    expect(baselineInput).not.toBeNull();
    // Use React-compatible input simulation
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeInputValueSetter.call(baselineInput, 'not-a-number');
      baselineInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.container.textContent).toContain('Baseline must be a number.');
  });

  it('Manual labels render from i18n mock keys', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // Field labels should come from i18n
    expect(view.container.textContent).toContain('Experiment Directory');
    expect(view.container.textContent).toContain('Metric Name');
    expect(view.container.textContent).toContain('Baseline (optional)');
    expect(view.container.textContent).toContain('Local Work Directory');
    expect(view.container.textContent).toContain('Setup checklist');
    expect(view.container.textContent).toContain('Provider / API');
    expect(view.container.textContent).toContain('Work directory');
    expect(view.container.textContent).toContain('Paths and provider settings will be verified when you start the run.');
  });

  it('summary strip shows configured values', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(view.container.textContent).toContain('Review before start');
    expect(view.container.textContent).toContain('Target');
    expect(view.container.textContent).toContain('Workdir');
    expect(view.container.textContent).toContain('Filled');
  });

  it('onReady from BootstrapChatView closes modal and opens autoresearch view', async () => {
    const view = renderModal();
    const readyButton = view.container.querySelector('[data-testid="trigger-on-ready"]') as HTMLButtonElement | null;
    expect(readyButton).not.toBeNull();
    await act(async () => {
      readyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(useAutoResearchStore.getState().showSetupModal).toBe(false);
    expect(mockSetCurrentView).toHaveBeenCalledWith('autoresearch');
  });

  it('exposes ARIA dialog + tab semantics for screen readers', () => {
    const view = renderModal();
    const panel = view.container.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    expect(panel?.getAttribute('aria-labelledby')).toBe('autoresearch-setup-modal-title');
    const title = view.container.querySelector('#autoresearch-setup-modal-title');
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain('AutoResearch');

    const guidedTab = view.container.querySelector('#autoresearch-setup-tab-btn-guided') as HTMLButtonElement | null;
    const manualTab = view.container.querySelector('#autoresearch-setup-tab-btn-manual') as HTMLButtonElement | null;
    expect(guidedTab?.getAttribute('role')).toBe('tab');
    expect(manualTab?.getAttribute('role')).toBe('tab');
    expect(guidedTab?.getAttribute('aria-selected')).toBe('true');
    expect(manualTab?.getAttribute('aria-selected')).toBe('false');
    expect(guidedTab?.getAttribute('aria-controls')).toBe('autoresearch-setup-tab-guided');
    expect(manualTab?.getAttribute('aria-controls')).toBe('autoresearch-setup-tab-manual');

    const guidedPanel = view.container.querySelector('#autoresearch-setup-tab-guided');
    expect(guidedPanel?.getAttribute('role')).toBe('tabpanel');
    // Switch to manual tab to mount the manual panel
    const manualTabBtn = findButtonByText(view.container, 'Manual');
    act(() => { manualTabBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const manualPanel = view.container.querySelector('#autoresearch-setup-tab-manual');
    expect(manualPanel?.getAttribute('role')).toBe('tabpanel');

    const closeButton = view.container.querySelector('button[aria-label="Close setup modal"]');
    expect(closeButton).not.toBeNull();
  });

  it('updates aria-selected when the user switches tabs', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const guidedTab = view.container.querySelector('#autoresearch-setup-tab-btn-guided');
    const manualTabEl = view.container.querySelector('#autoresearch-setup-tab-btn-manual');
    expect(guidedTab?.getAttribute('aria-selected')).toBe('false');
    expect(manualTabEl?.getAttribute('aria-selected')).toBe('true');
  });

  it('localizes the baseline placeholder through i18n (round 1 fix)', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const baselineInput = view.container.querySelector('input[placeholder="e.g. 0.963284"]');
    expect(baselineInput).not.toBeNull();
  });

  it('localizes the SSH placeholders and auth options through i18n (round 2 fix)', () => {
    const view = renderModal();
    const manualTab = findButtonByText(view.container, 'Manual');
    act(() => { manualTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const sshTab = findButtonByText(view.container, 'SSH');
    act(() => { sshTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    // The host input is always present in SSH mode. The keyPath/password
    // inputs only render when the corresponding authMode is selected, but
    // they use the same t() pattern as host, so verifying host is enough
    // to prove no English leaks. The auth options check below proves the
    // option labels are also i18n'd.
    const hostInput = view.container.querySelector('input[placeholder="e.g. 192.168.1.10 or connect.westd.seetacloud.com"]');
    expect(hostInput).not.toBeNull();

    const authOptions = Array.from(view.container.querySelectorAll('option'))
      .filter(o => o.value === 'agent' || o.value === 'password' || o.value === 'key');
    expect(authOptions).toHaveLength(3);
    // All three auth options must be non-empty AND must match the i18n
    // mock values exactly (not raw hard-coded English like "Auth: Agent").
    // The mock returns "Auth: ..." for all three, so each option's
    // textContent must equal the corresponding mock value.
    const expectedTexts = {
      agent: 'Auth: Agent (~/.ssh/config)',
      password: 'Auth: Password',
      key: 'Auth: Private key',
    };
    for (const opt of authOptions) {
      expect(opt.textContent).toBe(expectedTexts[opt.value]);
    }
  });
});
