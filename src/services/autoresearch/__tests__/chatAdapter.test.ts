const mockAppendLiveOutput = jest.fn();
const mockRunHeadlessAgentTurn = jest.fn();

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: () => ({
      currentIteration: 3,
      appendLiveOutput: mockAppendLiveOutput,
    }),
  },
}));

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({
      getActiveConfig: () => ({
        apiKey: 'test-key',
      }),
    }),
  },
}));

jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (...args: unknown[]) => mockRunHeadlessAgentTurn(...args),
}));

describe('createAutoResearchSendMessage', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockRunHeadlessAgentTurn.mockImplementation(async (input) => {
      input.onTextDelta?.('partial output');
      input.onReasoningDelta?.('reasoning trace');
      input.onStatus?.('working');
      input.onToolSummary?.('read_file', 'README excerpt');
      return {
        finalText: 'final answer',
        finalReasoning: '',
      };
    });
  });

  it('delegates iterations to the shared headless runner and preserves context history', async () => {
    const { createAutoResearchSendMessage } = await import('../chatAdapter');

    const sendMessage = createAutoResearchSendMessage('/tmp/research');
    const firstResult = await sendMessage('system prompt', 'first question');
    const secondResult = await sendMessage('system prompt', 'second question');

    expect(firstResult).toBe('final answer');
    expect(secondResult).toBe('final answer');
    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        systemPrompt: 'system prompt',
        workDir: '/tmp/research',
        initialMessages: [
          {
            role: 'user',
            content: 'first question',
          },
        ],
      }),
    );
    expect(mockRunHeadlessAgentTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        initialMessages: [
          {
            role: 'user',
            content: 'first question',
          },
          {
            role: 'assistant',
            content: 'final answer',
          },
          {
            role: 'user',
            content: 'second question',
          },
        ],
      }),
    );
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('\n--- Iteration 3 ---\n');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('partial output');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('💭 reasoning trace');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('[status] working\n');
    expect(mockAppendLiveOutput).toHaveBeenCalledWith('  → read_file: README excerpt\n');
  });
});