import type { ResolvedAgentConfig } from '@/services/agentConfig';

const mockAppendLiveOutput = jest.fn();
const mockRunHeadlessAgentTurn = jest.fn();
const mockResolveActiveAgentConfig = jest.fn();
const mockValidateResolvedAgentConfig = jest.fn();
const mockFormatAgentConfigValidationError = jest.fn();
const mockGetAgentConfigDiagnostics = jest.fn();
const mockAddRunEvent = jest.fn();
const mockRequestReflectionDecision = jest.fn();
const mockGetDeterministicRecoveryDecision = jest.fn();
const mockBuildFallbackReflectionDecision = jest.fn();

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: () => ({
      id: 'run-1',
      currentIteration: 3,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      maxIterations: 5,
      runHistory: [
        {
          id: 'run-1',
          events: [
            { phase: 'system', message: 'Run initialized.' },
          ],
        },
      ],
      appendLiveOutput: mockAppendLiveOutput,
      addRunEvent: mockAddRunEvent,
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

jest.mock('../reflection', () => ({
  buildReflectionInputFromState: (input: unknown) => input,
  requestReflectionDecision: (...args: unknown[]) => mockRequestReflectionDecision(...args),
  getDeterministicRecoveryDecision: (...args: unknown[]) => mockGetDeterministicRecoveryDecision(...args),
  buildFallbackReflectionDecision: (...args: unknown[]) => mockBuildFallbackReflectionDecision(...args),
}));

describe('createAutoResearchSendMessage', () => {
  const activeConfig: ResolvedAgentConfig = {
    configId: 'cfg-1',
    name: 'MiniMax Global',
    provider: 'minimax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai',
    hasApiKey: true,
    hasBaseUrl: true,
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
    mockGetDeterministicRecoveryDecision.mockReturnValue(null);
    mockRequestReflectionDecision.mockReset();
    mockBuildFallbackReflectionDecision.mockImplementation((_input, error) => ({
      action: 'stop_tool_exhausted',
      summary: error instanceof Error ? error.message : 'fallback stop',
      userMessage: error instanceof Error ? error.message : 'fallback stop',
      shouldRetry: false,
      confidence: 'medium',
    }));
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
      allowedTools: [
        'get_current_workspace',
        'ssh_exec',
        'ssh_read_file',
        'ssh_upload_file',
      ],
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

  it('keeps using the frozen run config after Settings changes', async () => {
    const frozenConfig = {
      ...activeConfig,
      model: 'MiniMax-M2.7',
    };
    mockResolveActiveAgentConfig.mockReturnValue({
      ...activeConfig,
      model: 'MiniMax-M2.5',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', frozenConfig);

    await expect(sendMessage('system prompt', 'follow-up question')).resolves.toBe('final answer');
    expect(mockResolveActiveAgentConfig).not.toHaveBeenCalled();
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      agentConfig: expect.objectContaining({
        model: 'MiniMax-M2.7',
      }),
    }));
  });

  it('switches to python3 deterministically after python command-not-found failures', async () => {
    mockRunHeadlessAgentTurn
      .mockImplementationOnce(async (input) => {
        await input.onToolCall?.({
          id: 'tool-1',
          name: 'ssh_exec',
          arguments: '{"command":"python run_experiment.py"}',
        });
        await input.onToolResult?.({
          id: 'tool-1',
          name: 'ssh_exec',
          result: '{"stdout":"","stderr":"bash: python: command not found\\n","exitCode":127}',
          durationMs: 42,
        });
        throw new Error('phase=agent_execution; message=python command failed');
      })
      .mockResolvedValueOnce({
        finalText: 'recovered answer',
        finalReasoning: '',
      });
    mockGetDeterministicRecoveryDecision.mockReturnValue({
      action: 'switch_command',
      summary: 'Use python3 instead of python.',
      rootCause: 'python command not found',
      nextCommand: 'python3 run_experiment.py',
      nextPlan: 'Retry once with python3.',
      shouldRetry: true,
      confidence: 'high',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig, {
      environmentSummary: {
        experimentDir: '/tmp/research',
        gitRepo: true,
        repoStatus: 'clean',
        dirtyFileCount: 0,
        preferredPythonCommand: 'python3',
        worktreeWritable: true,
        runScriptPath: '/tmp/research/run_experiment.py',
        notesPath: '/tmp/research/AUTORESEARCH.md',
        recommendedRunCommand: 'python3 run_experiment.py',
      },
      metricName: 'cv_accuracy',
      direction: 'higher',
      maxIterations: 5,
    });

    await expect(sendMessage('system prompt', 'recover please')).resolves.toBe('recovered answer');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(2);
    expect(mockRequestReflectionDecision).not.toHaveBeenCalled();
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Reflection decision: switch_command — Use python3 instead of python.',
      metadata: expect.objectContaining({
        action: 'switch_command',
        rootCause: 'python command not found',
      }),
    }));
    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('python3 run_experiment.py'),
      }),
    );
  });

  it('runs reflection before surfacing a tool-round exhaustion failure', async () => {
    mockRunHeadlessAgentTurn.mockRejectedValueOnce(new Error('Exceeded maximum tool rounds (17)'));
    mockRequestReflectionDecision.mockResolvedValue({
      action: 'stop_tool_exhausted',
      summary: 'The agent exhausted the tool budget without producing the metric.',
      rootCause: 'python command not found',
      userMessage: '工具调用轮数已耗尽。最近的关键错误是：python: command not found。',
      shouldRetry: false,
      confidence: 'medium',
    });

    const { createAutoResearchSendMessage } = await import('../chatAdapter');
    const sendMessage = createAutoResearchSendMessage('/tmp/research', activeConfig);

    await expect(sendMessage('system prompt', 'reflect please')).rejects.toThrow(
      '工具调用轮数已耗尽。最近的关键错误是：python: command not found。',
    );
    expect(mockRequestReflectionDecision).toHaveBeenCalledTimes(1);
    expect(mockAddRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Reflection decision: stop_tool_exhausted — The agent exhausted the tool budget without producing the metric.',
    }));
  });
});
