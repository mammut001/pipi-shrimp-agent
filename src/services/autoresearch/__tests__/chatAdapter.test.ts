const mockAppendLiveOutput = jest.fn();
const mockRunHeadlessAgentTurn = jest.fn();
const mockResolveActiveAgentConfig = jest.fn();
const mockValidateResolvedAgentConfig = jest.fn();
const mockFormatAgentConfigValidationError = jest.fn();
const mockGetAgentConfigDiagnostics = jest.fn();

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: () => ({
      currentIteration: 3,
      appendLiveOutput: mockAppendLiveOutput,
    }),
  },
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: () => mockResolveActiveAgentConfig(),
  validateResolvedAgentConfig: (...args: unknown[]) => mockValidateResolvedAgentConfig(...args),
  formatAgentConfigValidationError: (...args: unknown[]) => mockFormatAgentConfigValidationError(...args),
  getAgentConfigDiagnostics: (...args: unknown[]) => mockGetAgentConfigDiagnostics(...args),
}));

jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (...args: unknown[]) => mockRunHeadlessAgentTurn(...args),
}));

jest.mock('../runDir', () => ({
  writeTargetText: jest.fn(),
  appendTargetText: jest.fn(),
}));

jest.mock('../terminalRunner', () => ({
  getCurrentRunDir: () => null,
}));

describe('createAutoResearchSendMessage', () => {
  const activeConfig = {
    configId: 'cfg-1',
    name: 'MiniMax Global',
    provider: 'minimax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai',
    hasApiKey: true,
    apiKey: 'test-key',
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockResolveActiveAgentConfig.mockReturnValue(activeConfig);
    mockValidateResolvedAgentConfig.mockReturnValue([]);
    mockFormatAgentConfigValidationError.mockReturnValue('invalid config');
    mockGetAgentConfigDiagnostics.mockReturnValue({
      selectedConfigName: 'MiniMax Global',
      selectedProvider: 'minimax',
      selectedModel: 'MiniMax-M2.7',
      hasApiKey: true,
      hasBaseURL: true,
      adapterName: 'minimax-openai',
      authorizationHeaderPresent: true,
    });
    mockRunHeadlessAgentTurn.mockImplementation(async (input) => {
      input.onTextDelta?.('partial output');
      input.onReasoningDelta?.('reasoning trace');
      input.onStatus?.('working');
      input.onToolSummary?.('read_file', 'README excerpt');
      await input.onToolCall?.({ id: 'tool-1', name: 'read_file', arguments: '{"path":"README.md"}' });
      await input.onToolResult?.({ id: 'tool-1', name: 'read_file', result: 'README excerpt', durationMs: 12 });
      await input.onAssistantMessage?.('assistant block');
      return {
        finalText: 'final answer',
        finalReasoning: '',
      };
    });
  });

  it('uses the resolved active config for headless agent execution', async () => {
    const { createAutoResearchSendMessage } = await import('../chatAdapter');

    const sendMessage = createAutoResearchSendMessage('/tmp/research');
    await expect(sendMessage('system prompt', 'first question')).resolves.toBe('final answer');

    expect(mockResolveActiveAgentConfig).toHaveBeenCalledTimes(1);
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: 'system prompt',
      workDir: '/tmp/research',
      agentConfig: activeConfig,
      initialMessages: [
        {
          role: 'user',
          content: 'first question',
        },
      ],
    }));
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('\n--- Iteration 3 ---\n');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('partial output');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('💭 reasoning trace');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('[status] working\n');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('  → read_file: README excerpt\n');
  });

  it('does not send requests when authorization would be empty', async () => {
    mockResolveActiveAgentConfig.mockReturnValue({
      ...activeConfig,
      hasApiKey: false,
      apiKey: '   ',
    });
    mockValidateResolvedAgentConfig.mockReturnValue([{ field: 'apiKey', message: 'missing key' }]);

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research');

    await expect(sendMessage('system prompt', 'first question')).rejects.toThrow('invalid config');
    expect(mockRunHeadlessAgentTurn).not.toHaveBeenCalled();
  });
});
