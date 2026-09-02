import { describe, expect, it, jest } from '@jest/globals';
import { validateAutoResearchSetupDraft } from '../setupFlow';

const mockRunAutoResearchPreflight = jest.fn();
const mockResolveAutoResearchRunConfigFromSnapshotFile = jest.fn();
const mockGetSessionRunPaths = jest.fn();
const mockReadTargetText = jest.fn();
const mockCreateAutoResearchSendMessage = jest.fn();
const mockStartExperimentLoop = jest.fn();

const mockStoreState = {
  id: '',
  loopState: 'idle',
  runHistory: [] as Array<Record<string, unknown>>,
  setError: jest.fn(),
  setLastUsedConfig: jest.fn(),
  activateHistoricalRun: jest.fn(),
};

jest.mock('@/i18n', () => ({
  t: (key: string) => ({
    'autoresearch.connectionTestRequired': 'Run a successful connection test before starting AutoResearch.',
    'autoresearch.validationHostRequired': 'SSH host is required.',
    'autoresearch.validationUserRequired': 'SSH user is required.',
    'autoresearch.validationPasswordRequired': 'SSH password is required for password auth.',
    'autoresearch.validationKeyPathRequired': 'SSH key path is required for key auth.',
    'autoresearch.validationWorkdirRequired': 'Workdir is required.',
    'autoresearch.validationWorkdirAbsolute': 'AutoResearch workspace must be an absolute or home (~) path.',
    'autoresearch.validationExperimentDirRequired': 'Experiment directory is required.',
    'autoresearch.validationExperimentDirAbsolute': 'Target project must be an absolute or home (~) path.',
    'autoresearch.validationMetricRequired': 'Metric name is required.',
    'autoresearch.validationBaselineNumber': 'Baseline must be a number.',
  }[key] ?? key),
}));

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: () => mockStoreState,
  },
  getActiveAutoResearchRun: () => mockStoreState.runHistory.find((run) => run.id === mockStoreState.id) ?? null,
  isAutoResearchTerminalState: (status: string | null | undefined) => Boolean(status && ['reflection_failed', 'failed', 'completed', 'stopped', 'interrupted'].includes(status)),
}));

jest.mock('../platformGuard', () => ({
  assertSupportedPlatform: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../preflight', () => ({
  runAutoResearchPreflight: (...args: unknown[]) => mockRunAutoResearchPreflight(...args),
}));

jest.mock('../runConfig', () => ({
  resolveAutoResearchRunConfigFromSnapshotFile: (...args: unknown[]) => mockResolveAutoResearchRunConfigFromSnapshotFile(...args),
}));

jest.mock('../runDir', () => ({
  getSessionRunPaths: (...args: unknown[]) => mockGetSessionRunPaths(...args),
  readTargetText: (...args: unknown[]) => mockReadTargetText(...args),
}));

jest.mock('../chatAdapter', () => ({
  createAutoResearchSendMessage: (...args: unknown[]) => mockCreateAutoResearchSendMessage(...args),
}));

jest.mock('../loopEngine', () => ({
  startExperimentLoop: (...args: unknown[]) => mockStartExperimentLoop(...args),
}));

describe('validateAutoResearchSetupDraft', () => {
  it('requires a successful connection test when requested', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '~/Documents/tiny-autoresearch-digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
      baselineInput: '',
      requireConnectionTest: true,
      connectionTestStatus: 'idle',
    });

    expect(result.value).toBeNull();
    expect(result.error).toBe('Run a successful connection test before starting AutoResearch.');
  });

  it('rejects relative workspace path', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '.',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/exp',
      metric: 'val_loss',
      direction: 'lower',
      iterations: 5,
      baselineInput: '',
    });

    expect(result.value).toBeNull();
    expect(result.error).toBe('AutoResearch workspace must be an absolute or home (~) path.');
  });

  it('rejects relative experiment directory path', () => {
    const result = validateAutoResearchSetupDraft({
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
      experimentDir: './relative-exp',
      metric: 'val_loss',
      direction: 'lower',
      iterations: 5,
      baselineInput: '',
    });

    expect(result.value).toBeNull();
    expect(result.error).toBe('Target project must be an absolute or home (~) path.');
  });

  it('normalizes valid local setup values', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '  ~/autoresearch  ',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '  ~/Documents/tiny-autoresearch-digits  ',
      metric: ' cv_accuracy ',
      direction: 'Higher',
      iterations: 99,
      baselineInput: '0.91',
    });

    expect(result.error).toBeNull();
    expect(result.value).toEqual({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '~/Documents/tiny-autoresearch-digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 50,
      baseline: 0.91,
    });
  });

  it('surfaces SSH validation errors instead of silently returning', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'ssh',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '~/Documents/tiny-autoresearch-digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
      baselineInput: '',
    });

    expect(result.value).toBeNull();
    expect(result.error).toBe('SSH host is required.');
  });

  it('refuses to start a new run while another run is already active', async () => {
    mockStoreState.id = 'run-active';
    mockStoreState.loopState = 'running';
    mockStoreState.runHistory = [{ id: 'run-active', status: 'running' }];

    const { startAutoResearchRun } = await import('../setupFlow');

    await expect(startAutoResearchRun({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '~/Documents/tiny-autoresearch-digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
      baseline: null,
    }, {
      setSshConfig: jest.fn(),
      setLastUsedConfig: jest.fn(),
      initSession: jest.fn(),
    })).rejects.toThrow('AutoResearch is still running. Stop the active run before you start a new run.');

    mockStoreState.id = '';
    mockStoreState.loopState = 'idle';
    mockStoreState.runHistory = [];
  });

  it('resumes an interrupted run from the saved snapshot and restarts the loop', async () => {
    mockStoreState.id = '';
    mockStoreState.loopState = 'idle';
    mockStoreState.setError.mockReset();
    mockStoreState.setLastUsedConfig.mockReset();
    mockStoreState.activateHistoricalRun.mockReset();
    mockRunAutoResearchPreflight.mockReset();
    mockResolveAutoResearchRunConfigFromSnapshotFile.mockReset();
    mockGetSessionRunPaths.mockReset();
    mockReadTargetText.mockReset();
    mockCreateAutoResearchSendMessage.mockReset();
    mockStartExperimentLoop.mockReset();

    mockStoreState.runHistory = [{
      id: 'run-interrupted',
      status: 'interrupted',
      currentIteration: 2,
      updatedAt: '2026-05-14T10:00:00.000Z',
      liveOutputExcerpt: 'restored output',
      bestIteration: 1,
      config: {
        experimentDir: '/tmp/exp-original',
        workdir: '/tmp/work-original',
        metric: 'cv_accuracy',
        direction: 'higher',
        iterations: 5,
        baseline: 0.91,
      },
      iterations: [
        {
          id: 'iter-1',
          index: 1,
          status: 'completed',
          hypothesis: 'Keep cache warm',
          change: 'Cache parsed dataset',
          metricValue: 0.93,
          reasoning: 'Improved stability',
          durationMs: 1200,
          startedAt: '2026-05-14T09:00:00.000Z',
          endedAt: '2026-05-14T09:00:01.200Z',
        },
      ],
      resumeToken: {
        schemaVersion: 1,
        sessionId: 'run-interrupted',
        status: 'interrupted',
        sshConfig: {
          mode: 'local',
          host: '',
          user: 'root',
          keyPath: '',
          port: 22,
          remoteWorkDir: '/tmp/work-original',
          authMode: 'agent',
          password: '',
        },
        experimentDir: '/tmp/exp-original',
        metricName: 'cv_accuracy',
        metricDirection: 'higher',
        maxIterations: 5,
        baseline: 0.91,
        currentIteration: 2,
        pendingIteration: 3,
        replayIteration: true,
        resumable: true,
        createdAt: '2026-05-14T08:59:00.000Z',
        lastUpdatedAt: '2026-05-14T10:00:00.000Z',
      },
      events: [],
    }];

    mockGetSessionRunPaths.mockReturnValue({
      runConfigPath: '/tmp/work-original/runs/run-interrupted/run_config.json',
    });
    mockReadTargetText.mockResolvedValue(JSON.stringify({
      createdAt: '2026-05-14T08:59:00.000Z',
      selectedConfigIds: {
        activeConfigId: 'cfg-default',
        defaultConfigId: null,
        agentConfigId: 'cfg-agent',
        reflectionConfigId: 'cfg-reflection',
      },
      resolvedSources: {
        default: 'settings.activeConfig',
        agent: 'autoresearch.agentOverride',
        reflection: 'autoresearch.reflectionOverride',
      },
      configs: {
        default: { configId: 'cfg-default' },
        agent: { configId: 'cfg-agent' },
        reflection: { configId: 'cfg-reflection' },
      },
      capabilities: {
        default: { toolCalls: 'openai' },
        agent: { toolCalls: 'openai' },
        reflection: { toolCalls: 'openai' },
      },
    }));
    mockResolveAutoResearchRunConfigFromSnapshotFile.mockReturnValue({
      agentConfig: { configId: 'cfg-agent', provider: 'openai', model: 'gpt-4.1' },
      reflectionConfig: { configId: 'cfg-reflection', provider: 'openai', model: 'gpt-4.1-mini' },
      snapshot: {
        configId: 'cfg-agent',
        configName: 'Agent Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        keyPreview: 'sk-xxxx',
        keyPresent: true,
        source: 'savedRunConfig',
      },
      runConfigSnapshot: { createdAt: '2026-05-14T08:59:00.000Z' },
    });
    mockRunAutoResearchPreflight.mockResolvedValue({
      resolvedWorkDir: '/tmp/work-resolved',
      resolvedExperimentDir: '/tmp/exp-resolved',
      sessionFilePath: '/tmp/work-resolved/session.md',
      livingDocPath: '/tmp/work-resolved/runs/run-interrupted/autoresearch.md',
      environmentSummary: 'python=3.12',
    });
    mockCreateAutoResearchSendMessage.mockReturnValue('send-message');
    mockStartExperimentLoop.mockResolvedValue(undefined);

    const { resumeInterruptedAutoResearchRun } = await import('../setupFlow');
    const result = await resumeInterruptedAutoResearchRun('run-interrupted');

    expect(mockGetSessionRunPaths).toHaveBeenCalledWith({
      mode: 'local',
      host: '',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/tmp/work-original',
      authMode: 'agent',
      password: '',
    }, 'run-interrupted');
    expect(mockResolveAutoResearchRunConfigFromSnapshotFile).toHaveBeenCalledWith(expect.objectContaining({
      selectedConfigIds: expect.objectContaining({
        agentConfigId: 'cfg-agent',
        reflectionConfigId: 'cfg-reflection',
      }),
    }));
    expect(mockRunAutoResearchPreflight).toHaveBeenCalledWith({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/work-original',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/exp-original',
      workDir: '/tmp/work-original',
      sessionId: 'run-interrupted',
      metricName: 'cv_accuracy',
      agentConfig: { configId: 'cfg-agent', provider: 'openai', model: 'gpt-4.1' },
    });
    expect(mockStoreState.setLastUsedConfig).toHaveBeenCalledWith({
      workdir: '/tmp/work-resolved',
      experimentDir: '/tmp/exp-resolved',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
    });
    expect(mockStoreState.activateHistoricalRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-interrupted',
      experimentDir: '/tmp/exp-resolved',
      sessionFilePath: '/tmp/work-resolved/session.md',
      livingDocPath: '/tmp/work-resolved/runs/run-interrupted/autoresearch.md',
      pendingIteration: 3,
      liveOutput: 'restored output',
      experiments: [expect.objectContaining({
        iteration: 1,
        status: 'IMPROVED',
      })],
    }));
    expect(mockCreateAutoResearchSendMessage).toHaveBeenCalledWith(
      '/tmp/exp-resolved',
      { configId: 'cfg-agent', provider: 'openai', model: 'gpt-4.1' },
      expect.objectContaining({
        environmentSummary: 'python=3.12',
        metricName: 'cv_accuracy',
        direction: 'higher',
        maxIterations: 5,
        reflectionConfig: { configId: 'cfg-reflection', provider: 'openai', model: 'gpt-4.1-mini' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mockStartExperimentLoop).toHaveBeenCalledWith('send-message', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(result).toEqual(expect.objectContaining({
      sessionId: 'run-interrupted',
      pendingIteration: 3,
      resolvedConfig: expect.objectContaining({
        remoteWorkDir: '/tmp/work-resolved',
      }),
      preflight: expect.objectContaining({
        resolvedExperimentDir: '/tmp/exp-resolved',
      }),
    }));
  });
});
