const mockGetActiveConfig = jest.fn();

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({
      getActiveConfig: mockGetActiveConfig,
    }),
  },
}));

import {
  formatAgentConfigValidationError,
  getAgentConfigDiagnostics,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';

describe('agentConfig resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the active settings config with provider defaults', () => {
    mockGetActiveConfig.mockReturnValue({
      id: 'cfg-minimax',
      name: 'MiniMax Global',
      provider: 'minimax',
      apiKey: 'mini-secret',
      model: 'MiniMax-M2.7',
      baseUrl: '',
      modelProviderId: 'minimax',
    });

    const config = resolveActiveAgentConfig();

    expect(config).toMatchObject({
      configId: 'cfg-minimax',
      name: 'MiniMax Global',
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiFormat: 'openai',
      hasApiKey: true,
    });
    expect(getAgentConfigDiagnostics(config!)).toMatchObject({
      selectedConfigName: 'MiniMax Global',
      selectedProvider: 'minimax',
      selectedModel: 'MiniMax-M2.7',
      hasApiKey: true,
      hasBaseURL: true,
      adapterName: 'minimax-openai',
      authorizationHeaderPresent: true,
    });
  });

  it('reports a clear validation error when the active config is missing api key', () => {
    mockGetActiveConfig.mockReturnValue({
      id: 'cfg-openai',
      name: 'CheerySTUDIO',
      provider: 'openai-compatible',
      apiKey: '   ',
      model: 'MiniMax-M2.7',
      baseUrl: 'https://api.example.com/v1',
      modelProviderId: 'openai-compatible',
      apiFormat: 'openai',
    });

    const config = resolveActiveAgentConfig();
    const issues = validateResolvedAgentConfig(config);

    expect(issues).toHaveLength(1);
    expect(formatAgentConfigValidationError(config, issues)).toBe(
      "Agent API config invalid: selected config 'CheerySTUDIO' is missing API key.",
    );
  });

  it('flags unknown providers without falling back silently', () => {
    mockGetActiveConfig.mockReturnValue({
      id: 'cfg-unknown',
      name: 'Mystery Gateway',
      provider: 'mystery-provider',
      apiKey: 'secret',
      model: 'mystery-model',
      baseUrl: 'https://gateway.example.com/v1',
      modelProviderId: 'mystery-provider',
    });

    const config = resolveActiveAgentConfig();
    const issues = validateResolvedAgentConfig(config);

    expect(issues[0]?.field).toBe('provider');
    expect(formatAgentConfigValidationError(config, issues)).toBe(
      "Agent API config invalid: selected config 'Mystery Gateway' uses unknown provider 'mystery-provider'.",
    );
  });
});
