const mockExecuteTargetCommand = jest.fn();
const mockPathExistsOnTarget = jest.fn();
const mockTestResolvedChatConnection = jest.fn();

jest.mock('@/i18n', () => ({
  getCurrentLocale: () => 'en-US',
  setLocale: () => undefined,
  convertOldLanguageCode: (value: string) => value,
  convertToOldLanguageCode: () => 'en',
  t: (key: string) => ({
    'autoresearch.preflight.notGitRepoTitle': 'Experiment directory is not a Git repository.',
    'autoresearch.preflight.notGitRepoDescription': 'AutoResearch needs Git to create snapshots, inspect diffs, and track changes.',
    'autoresearch.preflight.requiredFiles': 'Required files:',
  }[key] ?? key),
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: jest.fn(),
  validateResolvedAgentConfig: jest.fn(() => []),
  formatAgentConfigValidationError: jest.fn(() => ''),
  getAgentConfigDiagnostics: jest.fn((config) => ({
    selectedConfigName: config.name,
    selectedProvider: config.provider,
    selectedProviderLabel: config.providerLabel,
    selectedModel: config.model,
    hasApiKey: config.hasApiKey,
    hasBaseURL: Boolean(config.baseUrl),
    adapterName: 'minimax-openai',
    authorizationHeaderPresent: true,
  })),
}));

jest.mock('../runDir', () => ({
  executeTargetCommand: (...args: unknown[]) => mockExecuteTargetCommand(...args),
  pathExistsOnTarget: (...args: unknown[]) => mockPathExistsOnTarget(...args),
}));

jest.mock('@/services/resolvedChatRequest', () => ({
  testResolvedChatConnection: (...args: unknown[]) => mockTestResolvedChatConnection(...args),
}));

import { useSettingsStore } from '@/store/settingsStore';
import { runAutoResearchPreflight } from '../preflight';

describe('runAutoResearchPreflight', () => {
  const agentConfig = {
    configId: 'cfg-1',
    name: 'MiniMax Global',
    provider: 'minimax' as const,
    providerLabel: 'MiniMax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai' as const,
    hasApiKey: true,
    hasBaseUrl: true,
    apiKey: 'secret',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteTargetCommand.mockReset();
    mockPathExistsOnTarget.mockReset();
    mockTestResolvedChatConnection.mockReset();
    useSettingsStore.setState({ windowsShellProfile: 'auto' });
    mockTestResolvedChatConnection.mockResolvedValue({
      latencyMs: 42,
      diagnostics: {
        selectedConfigName: 'MiniMax Global',
        selectedProvider: 'minimax',
        selectedModel: 'MiniMax-M2.7',
        apiFormat: 'openai',
        hasApiKey: true,
        hasBaseURL: true,
        adapterName: 'minimax-openai',
        endpointHost: 'api.minimaxi.com',
        endpointPreview: 'https://api.minimaxi.com/v1/chat/completions',
        authorizationHeaderPresent: true,
      },
    });
    mockExecuteTargetCommand
      .mockResolvedValueOnce({ stdout: '/Users/demo', exit_code: 0 })
      .mockResolvedValueOnce({
        stdout: [
          'preferred_python\tpython3',
          'git_repo\t1',
          'dirty_file_count\t0',
          'worktree_writable\t1',
        ].join('\n'),
        exit_code: 0,
      });
    mockPathExistsOnTarget.mockResolvedValue(true);
  });

  it('blocks startup when required experiment files are missing', async () => {
    mockPathExistsOnTarget
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(runAutoResearchPreflight({
      sshConfig: {
        mode: 'local',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/Users/demo/experiment',
      workDir: '~/autoresearch',
      sessionId: 'autoresearch-1',
      agentConfig,
    })).rejects.toThrow('run_experiment.py does not exist: /Users/demo/experiment/run_experiment.py');
  });

  it('returns resolved paths and the fixed agent config on success', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(runAutoResearchPreflight({
      sshConfig: {
        mode: 'local',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/Users/demo/experiment',
      workDir: '~/autoresearch',
      sessionId: 'autoresearch-1',
      agentConfig,
    })).resolves.toEqual(expect.objectContaining({
      agentConfig,
      resolvedExperimentDir: '/Users/demo/experiment',
      resolvedWorkDir: '/Users/demo/autoresearch',
      sessionFilePath: '/Users/demo/autoresearch/session.md',
      livingDocPath: '/Users/demo/autoresearch/runs/autoresearch-1/autoresearch.md',
      environmentSummary: expect.objectContaining({
        experimentDir: '/Users/demo/experiment',
        gitRepo: true,
        repoStatus: 'clean',
        dirtyFileCount: 0,
        preferredPythonCommand: 'python3',
        worktreeWritable: true,
        runScriptPath: '/Users/demo/experiment/run_experiment.py',
        notesPath: '/Users/demo/experiment/AUTORESEARCH.md',
        recommendedRunCommand: 'python3 run_experiment.py',
      }),
    }));

    expect(infoSpy).toHaveBeenCalledWith('[AutoResearch] Startup preflight', expect.objectContaining({
      selectedConfigName: 'MiniMax Global',
      selectedProvider: 'minimax',
      selectedModel: 'MiniMax-M2.7',
      authorizationHeaderPresent: true,
      preferredPythonCommand: 'python3',
      repoStatus: 'clean',
    }));

    infoSpy.mockRestore();
  });

  it('blocks startup when the shared API connection test fails auth', async () => {
    mockTestResolvedChatConnection.mockRejectedValue(new Error('401 Unauthorized: login fail'));

    await expect(runAutoResearchPreflight({
      sshConfig: {
        mode: 'local',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/Users/demo/experiment',
      workDir: '~/autoresearch',
      sessionId: 'autoresearch-1',
      agentConfig,
    })).rejects.toThrow(
      "Agent API config invalid: selected config 'MiniMax Global' failed authentication. Please fix it in Settings.",
    );
  });

  it('blocks startup when no python interpreter is available in the experiment environment', async () => {
    mockExecuteTargetCommand.mockReset();
    mockExecuteTargetCommand
      .mockResolvedValueOnce({ stdout: '/Users/demo', exit_code: 0 })
      .mockResolvedValueOnce({
        stdout: [
          'preferred_python\t',
          'git_repo\t1',
          'dirty_file_count\t0',
          'worktree_writable\t1',
        ].join('\n'),
        exit_code: 0,
      });

    await expect(runAutoResearchPreflight({
      sshConfig: {
        mode: 'local',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/Users/demo/experiment',
      workDir: '~/autoresearch',
      sessionId: 'autoresearch-1',
      agentConfig,
    })).rejects.toThrow('AutoResearch target is missing python3/python in PATH: /Users/demo/experiment');
  });

  it('surfaces a structured message when the experiment directory is not a git repository', async () => {
    mockExecuteTargetCommand.mockReset();
    mockExecuteTargetCommand
      .mockResolvedValueOnce({ stdout: '/Users/demo', exit_code: 0 })
      .mockResolvedValueOnce({
        stdout: [
          'preferred_python\tpython3',
          'git_repo\t0',
          'dirty_file_count\t0',
          'worktree_writable\t1',
        ].join('\n'),
        exit_code: 0,
      });

    await runAutoResearchPreflight({
      sshConfig: {
        mode: 'local',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '~/autoresearch',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/Users/demo/experiment',
      workDir: '~/autoresearch',
      sessionId: 'autoresearch-1',
      agentConfig,
    }).then(
      () => {
        throw new Error('Expected preflight to fail');
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain('Experiment directory is not a Git repository.');
        expect(message).toContain('Required files:');
        expect(message).toContain('git init');
        expect(message).toContain('AUTORESEARCH.md');
      },
    );
  });

  it('converts Windows local paths to WSL paths when the shell profile is WSL', async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows NT' },
      configurable: true,
    });
    useSettingsStore.setState({ windowsShellProfile: 'wsl' });

    mockExecuteTargetCommand.mockReset();
    mockExecuteTargetCommand.mockResolvedValueOnce({
      stdout: [
        'preferred_python\tpython3',
        'git_repo\t1',
        'dirty_file_count\t0',
        'worktree_writable\t1',
      ].join('\n'),
      exit_code: 0,
    });

    try {
      await expect(runAutoResearchPreflight({
        sshConfig: {
          mode: 'local',
          host: '',
          user: '',
          keyPath: '',
          port: 22,
          remoteWorkDir: 'D:\\WSL\\Ubuntu\\autoresearch',
          authMode: 'agent',
          password: '',
        },
        experimentDir: 'D:\\WSL\\Ubuntu\\experiment',
        workDir: 'D:\\WSL\\Ubuntu\\autoresearch',
        sessionId: 'autoresearch-win-wsl',
        agentConfig,
      })).resolves.toEqual(expect.objectContaining({
        resolvedExperimentDir: '/mnt/d/WSL/Ubuntu/experiment',
        resolvedWorkDir: '/mnt/d/WSL/Ubuntu/autoresearch',
        sessionFilePath: '/mnt/d/WSL/Ubuntu/autoresearch/session.md',
        livingDocPath: '/mnt/d/WSL/Ubuntu/autoresearch/runs/autoresearch-win-wsl/autoresearch.md',
        environmentSummary: expect.objectContaining({
          experimentDir: '/mnt/d/WSL/Ubuntu/experiment',
          runScriptPath: '/mnt/d/WSL/Ubuntu/experiment/run_experiment.py',
        }),
      }));

      expect(mockPathExistsOnTarget).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ mode: 'local', remoteWorkDir: '' }),
        '/mnt/d/WSL/Ubuntu/experiment',
      );
    } finally {
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      } else {
        delete (globalThis as { navigator?: unknown }).navigator;
      }
    }
  });
});
