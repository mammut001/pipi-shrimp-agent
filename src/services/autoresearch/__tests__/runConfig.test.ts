import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockResolveAgentConfig = jest.fn();
const mockValidateResolvedAgentConfig = jest.fn();
const mockFormatAgentConfigValidationError = jest.fn();
const mockGetCapability = jest.fn();
const mockBuildProviderExecutionCapabilities = jest.fn();

const storeState = {
  apiConfigs: [] as Array<Record<string, unknown>>,
  activeConfigId: null as string | null,
  autoResearchLlmSettings: {
    defaultConfigId: null as string | null,
    agentConfigId: null as string | null,
    reflectionConfigId: null as string | null,
  },
};

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => storeState,
  },
}));

jest.mock('@/services/agentConfig', () => ({
  resolveAgentConfig: (...args: unknown[]) => mockResolveAgentConfig(...args),
  validateResolvedAgentConfig: (...args: unknown[]) => mockValidateResolvedAgentConfig(...args),
  formatAgentConfigValidationError: (...args: unknown[]) => mockFormatAgentConfigValidationError(...args),
}));

jest.mock('@/services/llm/capabilities', () => ({
  getCapability: (...args: unknown[]) => mockGetCapability(...args),
  buildProviderExecutionCapabilities: (...args: unknown[]) => mockBuildProviderExecutionCapabilities(...args),
}));

function createResolvedConfig(overrides: Record<string, unknown> = {}) {
  return {
    configId: 'cfg-1',
    name: 'Config',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'openai',
    hasApiKey: true,
    hasBaseUrl: true,
    apiKey: 'secret-key',
    ...overrides,
  };
}

describe('resolveAutoResearchRunConfig', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    storeState.apiConfigs = [];
    storeState.activeConfigId = null;
    storeState.autoResearchLlmSettings = {
      defaultConfigId: null,
      agentConfigId: null,
      reflectionConfigId: null,
    };

    mockResolveAgentConfig.mockImplementation((config: Record<string, unknown>) => createResolvedConfig({
      configId: config.id,
      name: config.name,
      provider: config.provider,
      providerLabel: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      hasApiKey: Boolean(config.apiKey),
      hasBaseUrl: Boolean(config.baseUrl),
    }));
    mockValidateResolvedAgentConfig.mockImplementation((config: { hasApiKey?: boolean }) => (
      config?.hasApiKey ? [] : [{ field: 'apiKey', message: 'missing key' }]
    ));
    mockFormatAgentConfigValidationError.mockReturnValue('invalid config');
    mockGetCapability.mockReturnValue({
      id: 'minimax',
      displayName: 'MiniMax',
      streaming: true,
      toolCalls: 'openai',
      jsonMode: true,
      jsonSchema: false,
      vision: false,
      maxContextTokens: 1_000_000,
      recommendedFor: ['agent'],
    });
    mockBuildProviderExecutionCapabilities.mockReturnValue({
      supportsToolCalls: true,
      supportsToolOpenAI: true,
    });
  });

  it('uses the latest active Settings config when no AutoResearch override is set', async () => {
    storeState.apiConfigs = [
      {
        id: 'cfg-1',
        name: 'MiniMax One',
        provider: 'minimax',
        apiKey: 'key-1',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.1',
      },
    ];
    storeState.activeConfigId = 'cfg-1';

    const { resolveAutoResearchRunConfig } = await import('../runConfig');
    const firstRun = resolveAutoResearchRunConfig();

    storeState.apiConfigs = [
      {
        id: 'cfg-1',
        name: 'MiniMax One',
        provider: 'minimax',
        apiKey: 'key-1',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
      },
    ];

    const secondRun = resolveAutoResearchRunConfig();

    expect(firstRun.agentConfig.model).toBe('MiniMax-M2.1');
    expect(secondRun.agentConfig.model).toBe('MiniMax-M2.7');
    expect(firstRun.snapshot.source).toBe('settings.activeConfig');
    expect(secondRun.runConfigSnapshot.configs.agent.model).toBe('MiniMax-M2.7');
  });

  it('rebuilds the saved provider selection from a persisted run config snapshot', async () => {
    storeState.apiConfigs = [
      {
        id: 'cfg-default',
        name: 'Default Config',
        provider: 'openai',
        apiKey: 'key-openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
      },
      {
        id: 'cfg-agent',
        name: 'Agent Config',
        provider: 'minimax',
        apiKey: 'key-minimax',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
      },
      {
        id: 'cfg-reflection',
        name: 'Reflection Config',
        provider: 'anthropic',
        apiKey: 'key-anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-5',
      },
    ];
    storeState.activeConfigId = 'cfg-default';

    const { resolveAutoResearchRunConfigFromSnapshotFile } = await import('../runConfig');
    const result = resolveAutoResearchRunConfigFromSnapshotFile({
      createdAt: '2026-05-14T00:00:00.000Z',
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
        default: {
          configId: 'cfg-default',
          configName: 'Default Config',
          provider: 'openai',
          providerLabel: 'OpenAI',
          apiFormat: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1',
          keyPreview: 'sk-open',
          keyPresent: true,
          source: 'settings.activeConfig',
        },
        agent: {
          configId: 'cfg-agent',
          configName: 'Agent Config',
          provider: 'minimax',
          providerLabel: 'MiniMax',
          apiFormat: 'openai',
          baseUrl: 'https://api.minimaxi.com/v1',
          model: 'MiniMax-M2.7',
          keyPreview: 'mm-open',
          keyPresent: true,
          source: 'autoresearch.agentOverride',
        },
        reflection: {
          configId: 'cfg-reflection',
          configName: 'Reflection Config',
          provider: 'anthropic',
          providerLabel: 'Anthropic',
          apiFormat: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-5',
          keyPreview: 'an-open',
          keyPresent: true,
          source: 'autoresearch.reflectionOverride',
        },
      },
      capabilities: {
        default: mockGetCapability(),
        agent: mockGetCapability(),
        reflection: mockGetCapability(),
      },
    });

    expect(result.defaultConfig.configId).toBe('cfg-default');
    expect(result.agentConfig.configId).toBe('cfg-agent');
    expect(result.reflectionConfig.configId).toBe('cfg-reflection');
    expect(result.snapshot.source).toBe('savedRunConfig');
  });

  it('honors per-feature agent and reflection overrides', async () => {
    storeState.apiConfigs = [
      {
        id: 'cfg-default',
        name: 'OpenAI Base',
        provider: 'openai',
        apiKey: 'key-openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
      },
      {
        id: 'cfg-agent',
        name: 'MiniMax Agent',
        provider: 'minimax',
        apiKey: 'key-minimax',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
      },
      {
        id: 'cfg-reflection',
        name: 'Anthropic Reflection',
        provider: 'anthropic',
        apiKey: 'key-anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-5',
      },
    ];
    storeState.activeConfigId = 'cfg-default';
    storeState.autoResearchLlmSettings = {
      defaultConfigId: 'cfg-default',
      agentConfigId: 'cfg-agent',
      reflectionConfigId: 'cfg-reflection',
    };

    const { resolveAutoResearchRunConfig } = await import('../runConfig');
    const result = resolveAutoResearchRunConfig();

    expect(result.defaultConfig.configId).toBe('cfg-default');
    expect(result.agentConfig.configId).toBe('cfg-agent');
    expect(result.reflectionConfig.configId).toBe('cfg-reflection');
    expect(result.featureSnapshots.agent.source).toBe('autoresearch.agentOverride');
    expect(result.featureSnapshots.reflection.source).toBe('autoresearch.reflectionOverride');
  });

  it('falls back to the first valid keyed config when there is no active config', async () => {
    storeState.apiConfigs = [
      {
        id: 'cfg-invalid',
        name: 'Broken Config',
        provider: 'openai',
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
      },
      {
        id: 'cfg-valid',
        name: 'Gemini Valid',
        provider: 'gemini',
        apiKey: 'gemini-key',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-2.5-pro',
      },
    ];

    const { resolveAutoResearchRunConfig } = await import('../runConfig');
    const result = resolveAutoResearchRunConfig();

    expect(result.defaultConfig.configId).toBe('cfg-valid');
    expect(result.snapshot.source).toBe('settings.fallbackValidConfig');
  });

  it('refuses to start when the agent provider does not support tool calls', async () => {
    storeState.apiConfigs = [
      {
        id: 'cfg-1',
        name: 'Config One',
        provider: 'openai',
        apiKey: 'key-openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
      },
    ];
    storeState.activeConfigId = 'cfg-1';
    mockBuildProviderExecutionCapabilities.mockReturnValue({
      supportsToolCalls: false,
      supportsToolOpenAI: false,
    });

    const { resolveAutoResearchRunConfig } = await import('../runConfig');

    expect(() => resolveAutoResearchRunConfig()).toThrow('Provider/model does not support tool calls for AutoResearch Advanced. Choose a tool-calling model.');
  });

  it('refuses deepseek reasoning models for AutoResearch agent execution', async () => {
    storeState.apiConfigs = [
      {
        id: 'cfg-1',
        name: 'DeepSeek V4 Pro',
        provider: 'deepseek',
        apiKey: 'key-deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro',
      },
    ];
    storeState.activeConfigId = 'cfg-1';
    mockBuildProviderExecutionCapabilities.mockReturnValue({
      supportsToolCalls: false,
      supportsToolOpenAI: false,
    });

    const { resolveAutoResearchRunConfig } = await import('../runConfig');

    expect(() => resolveAutoResearchRunConfig()).toThrow(
      "DeepSeek model 'deepseek-v4-pro' is not a tool-calling agent model. Use deepseek-chat for the agent config",
    );
  });
});
