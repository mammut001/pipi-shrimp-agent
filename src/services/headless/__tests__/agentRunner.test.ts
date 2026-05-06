const mockRunChatTurn = jest.fn();
const mockExecuteBatch = jest.fn();
const mockPartitionTools = jest.fn();

jest.mock('@/core/QueryEngine', () => ({
  runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
}));

jest.mock('@/services/StreamingToolExecutor', () => ({
  StreamingToolExecutor: jest.fn().mockImplementation(() => ({
    executeBatch: (...args: unknown[]) => mockExecuteBatch(...args),
  })),
  partitionTools: (...args: unknown[]) => mockPartitionTools(...args),
}));

function createAsyncGenerator(events: unknown[]) {
  return (async function* generate() {
    for (const event of events) {
      yield event;
    }
  })();
}

describe('runHeadlessAgentTurn', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPartitionTools.mockImplementation((tools: unknown[]) => ({
      concurrent: tools,
      serial: [],
    }));
    mockExecuteBatch.mockResolvedValue({
      results: [
        {
          id: 'tool-2',
          content: 'file contents',
          is_error: false,
          execution_time_ms: 7,
        },
      ],
      totalExecutionTime: 1,
      errors: [],
    });
  });

  it('resolves a workDir for workspace-sensitive tools and merges manual tool results', async () => {
    const resolveAll = jest.fn();
    mockRunChatTurn.mockReturnValue(
      createAsyncGenerator([
        { type: 'status_update', message: 'planning' },
        { type: 'text_delta', content: 'Hello' },
        { type: 'reasoning_delta', content: ' step' },
        {
          type: 'tool_batch_request',
          tools: [
            { id: 'tool-1', name: 'get_current_workspace', arguments: '{}' },
            { id: 'tool-2', name: 'read_file', arguments: '{"path":"README.md"}' },
          ],
          _resolveAll: resolveAll,
        },
        {
          type: 'turn_complete',
          tokenUsage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
      ]),
    );

    const onStatus = jest.fn();
    const onTextDelta = jest.fn();
    const onReasoningDelta = jest.fn();
    const onToolSummary = jest.fn();
    const onAssistantMessage = jest.fn();
    const onToolCall = jest.fn();
    const onToolResult = jest.fn();
    const onWorkDirResolved = jest.fn();
    const resolveWorkDir = jest.fn().mockResolvedValue('/tmp/headless');

    const { runHeadlessAgentTurn } = await import('../agentRunner');
    const result = await runHeadlessAgentTurn({
      sessionId: 'session-1',
      initialMessages: [{ role: 'user', content: 'Summarize the repo' }],
      systemPrompt: 'system prompt',
      resolveWorkDir,
      onWorkDirResolved,
      onStatus,
      onTextDelta,
      onReasoningDelta,
      onToolSummary,
      onAssistantMessage,
      onToolCall,
      onToolResult,
    });

    expect(resolveWorkDir).toHaveBeenCalledTimes(1);
    expect(onWorkDirResolved).toHaveBeenCalledWith('/tmp/headless');
    expect(mockExecuteBatch).toHaveBeenCalledWith(
      [
        {
          id: 'tool-2',
          name: 'read_file',
          arguments: { path: 'README.md' },
        },
      ],
      expect.objectContaining({
        sessionId: 'session-1',
        workDir: '/tmp/headless',
      }),
    );
    expect(resolveAll).toHaveBeenCalledWith([
      {
        id: 'tool-1',
        content: JSON.stringify({
          work_dir: '/tmp/headless',
          message: 'Current working directory: /tmp/headless',
        }),
      },
      {
        id: 'tool-2',
        content: 'file contents',
      },
    ]);
    expect(onStatus).toHaveBeenCalledWith('planning');
    expect(onTextDelta).toHaveBeenCalledWith('Hello');
    expect(onReasoningDelta).toHaveBeenCalledWith(' step');
    expect(onToolSummary).toHaveBeenCalledWith(
      'get_current_workspace',
      JSON.stringify({
        work_dir: '/tmp/headless',
        message: 'Current working directory: /tmp/headless',
      }),
    );
    expect(onToolSummary).toHaveBeenCalledWith('read_file', 'file contents');
    expect(onToolCall).toHaveBeenNthCalledWith(1, {
      id: 'tool-1',
      name: 'get_current_workspace',
      arguments: '{}',
    });
    expect(onToolCall).toHaveBeenNthCalledWith(2, {
      id: 'tool-2',
      name: 'read_file',
      arguments: '{"path":"README.md"}',
    });
    expect(onToolResult).toHaveBeenNthCalledWith(1, {
      id: 'tool-1',
      name: 'get_current_workspace',
      result: JSON.stringify({
        work_dir: '/tmp/headless',
        message: 'Current working directory: /tmp/headless',
      }),
      durationMs: 0,
    });
    expect(onToolResult).toHaveBeenNthCalledWith(2, {
      id: 'tool-2',
      name: 'read_file',
      result: 'file contents',
      durationMs: 7,
    });
    expect(onAssistantMessage).toHaveBeenCalledWith('Hello');
    expect(result).toEqual({
      finalText: 'Hello',
      finalReasoning: ' step',
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });
  });

  it('returns a targeted error result for tools that are disallowed by the caller', async () => {
    const resolveAll = jest.fn();
    mockRunChatTurn.mockReturnValue(
      createAsyncGenerator([
        {
          type: 'tool_batch_request',
          tools: [
            { id: 'tool-1', name: 'write_file', arguments: '{"path":"README.md","content":"oops"}' },
          ],
          _resolveAll: resolveAll,
        },
        {
          type: 'turn_complete',
          tokenUsage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
          },
        },
      ]),
    );

    const onToolSummary = jest.fn();
    const onToolResult = jest.fn();

    const { runHeadlessAgentTurn } = await import('../agentRunner');
    await runHeadlessAgentTurn({
      sessionId: 'session-2',
      initialMessages: [{ role: 'user', content: 'Do a thing' }],
      systemPrompt: 'system prompt',
      allowedTools: ['ssh_exec'],
      onToolSummary,
      onToolResult,
    });

    expect(mockExecuteBatch).not.toHaveBeenCalled();
    expect(resolveAll).toHaveBeenCalledWith([
      {
        id: 'tool-1',
        content: 'Error: Tool "write_file" is disabled for this AutoResearch run. Allowed tools: ssh_exec',
      },
    ]);
    expect(onToolSummary).toHaveBeenCalledWith(
      'write_file',
      'Error: Tool "write_file" is disabled for this AutoResearch run. Allowed tools: ssh_exec',
    );
    expect(onToolResult).toHaveBeenCalledWith({
      id: 'tool-1',
      name: 'write_file',
      result: 'Error: Tool "write_file" is disabled for this AutoResearch run. Allowed tools: ssh_exec',
      durationMs: 0,
    });
  });
});
