const mockExecuteTargetCommand = jest.fn();
const mockPathExistsOnTarget = jest.fn();

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: jest.fn(),
  validateResolvedAgentConfig: jest.fn(() => []),
  formatAgentConfigValidationError: jest.fn(() => ''),
  getAgentConfigDiagnostics: jest.fn((config) => ({
    selectedConfigName: config.name,
    selectedProvider: config.provider,
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

import { runAutoResearchPreflight } from '../preflight';

describe('runAutoResearchPreflight', () => {
  const agentConfig = {
    configId: 'cfg-1',
    name: 'MiniMax Global',
    provider: 'minimax' as const,
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai' as const,
    hasApiKey: true,
    apiKey: 'secret',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteTargetCommand.mockResolvedValue({ stdout: '/Users/demo', exit_code: 0 });
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
    })).resolves.toEqual({
      agentConfig,
      resolvedExperimentDir: '/Users/demo/experiment',
      resolvedWorkDir: '/Users/demo/autoresearch',
      sessionFilePath: '/Users/demo/autoresearch/session.md',
      livingDocPath: '/Users/demo/autoresearch/runs/autoresearch-1/autoresearch.md',
    });

    expect(infoSpy).toHaveBeenCalledWith('[AutoResearch] Startup preflight', expect.objectContaining({
      selectedConfigName: 'MiniMax Global',
      selectedProvider: 'minimax',
      selectedModel: 'MiniMax-M2.7',
      authorizationHeaderPresent: true,
    }));

    infoSpy.mockRestore();
  });
});
