import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const mockResolveActiveAgentConfig = jest.fn();
const mockValidateResolvedAgentConfig = jest.fn();
const mockFormatAgentConfigValidationError = jest.fn();

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: () => mockResolveActiveAgentConfig(),
  validateResolvedAgentConfig: (...args: unknown[]) => mockValidateResolvedAgentConfig(...args),
  formatAgentConfigValidationError: (...args: unknown[]) => mockFormatAgentConfigValidationError(...args),
}));

describe('resolveAutoResearchRunConfig', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockValidateResolvedAgentConfig.mockReturnValue([]);
    mockFormatAgentConfigValidationError.mockReturnValue('invalid config');
  });

  it('uses the latest active Settings model for each new run resolution', async () => {
    const configV25 = {
      configId: 'cfg-1',
      name: 'MiniMax',
      provider: 'minimax',
      model: 'MiniMax-M2.5',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiFormat: 'openai',
      hasApiKey: true,
      hasBaseUrl: true,
      apiKey: 'first-secret-key',
    };
    const configV27 = {
      ...configV25,
      model: 'MiniMax-M2.7',
      apiKey: 'second-secret-key',
    };
    mockResolveActiveAgentConfig
      .mockReturnValueOnce(configV25)
      .mockReturnValueOnce(configV27);

    const { resolveAutoResearchRunConfig } = await import('../runConfig');

    const firstRun = resolveAutoResearchRunConfig();
    const secondRun = resolveAutoResearchRunConfig();

    expect(firstRun.agentConfig.model).toBe('MiniMax-M2.5');
    expect(firstRun.snapshot.model).toBe('MiniMax-M2.5');
    expect(secondRun.agentConfig.model).toBe('MiniMax-M2.7');
    expect(secondRun.snapshot.model).toBe('MiniMax-M2.7');
    expect(firstRun.snapshot.model).toBe('MiniMax-M2.5');
    expect(firstRun.snapshot.source).toBe('settings.activeConfig');
    expect(secondRun.snapshot.keyPreview).toContain('chars');
  });

  it('throws the shared validation error when the active config is invalid', async () => {
    mockResolveActiveAgentConfig.mockReturnValue(null);
    mockValidateResolvedAgentConfig.mockReturnValue([{ field: 'config', message: 'missing config' }]);

    const { resolveAutoResearchRunConfig } = await import('../runConfig');

    expect(() => resolveAutoResearchRunConfig()).toThrow('invalid config');
  });
});
