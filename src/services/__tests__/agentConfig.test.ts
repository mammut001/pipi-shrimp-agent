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
  preserveApiKeyValue,
  resolveDraftApiKeyValue,
  resolveActiveAgentConfig,
  sanitizeApiKeyValue,
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
      apiKey: 'mini-secret',
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

  it('preserves the stored api key when a masked placeholder is submitted', () => {
    expect(preserveApiKeyValue('••••••••', 'real-secret')).toBe('real-secret');
    expect(preserveApiKeyValue('********', 'real-secret')).toBe('real-secret');
    expect(preserveApiKeyValue('', 'real-secret')).toBe('real-secret');
    expect(preserveApiKeyValue('   ', 'real-secret')).toBe('real-secret');
    expect(preserveApiKeyValue('new-secret', 'real-secret')).toBe('new-secret');
  });

  it('preserves the existing key only when editing the same provider draft', () => {
    expect(resolveDraftApiKeyValue('', 'minimax', {
      provider: 'minimax',
      apiKey: 'real-secret',
    })).toBe('real-secret');

    expect(resolveDraftApiKeyValue('', 'anthropic', {
      provider: 'minimax',
      apiKey: 'real-secret',
    })).toBe('');

    expect(resolveDraftApiKeyValue(' Bearer next-secret ', 'minimax', {
      provider: 'minimax',
      apiKey: 'real-secret',
    })).toBe('next-secret');
  });

  it('sanitizes bearer-prefixed keys before resolving config usage', () => {
    expect(sanitizeApiKeyValue('  Bearer mini-secret\t\n')).toBe('mini-secret');
  });
});
