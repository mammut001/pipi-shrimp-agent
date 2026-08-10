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

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({
      agentSettings: {},
    }),
  },
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
        source: 'headless_agent',
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
      toolBudgetSummary: expect.objectContaining({
        successfulCalls: 2,
        failedCalls: 0,
      }),
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
    expect(mockRunChatTurn).toHaveBeenCalledWith(
      'session-2',
      [{ role: 'user', content: 'Do a thing' }],
      expect.stringContaining('HARD RULE: do not call list_files.'),
      undefined,
      false,
      undefined,
      expect.objectContaining({
        allowedTools: ['ssh_exec'],
      }),
      undefined,
    );
    expect(resolveAll).toHaveBeenCalledWith([
      {
        id: 'tool-1',
        content: JSON.stringify({
          error: true,
          error_kind: 'tool_disabled',
          tool: 'write_file',
          message: 'Tool "write_file" is disabled for this AutoResearch run. Allowed tools: ssh_exec',
          cause: 'Allowed tools: ssh_exec',
        }),
      },
    ]);
    expect(onToolSummary).toHaveBeenCalledWith(
      'write_file',
      JSON.stringify({
        error: true,
        error_kind: 'tool_disabled',
        tool: 'write_file',
        message: 'Tool "write_file" is disabled for this AutoResearch run. Allowed tools: ssh_exec',
        cause: 'Allowed tools: ssh_exec',
      }),
    );
    expect(onToolResult).toHaveBeenCalledWith({
      id: 'tool-1',
      name: 'write_file',
      result: JSON.stringify({
        error: true,
        error_kind: 'tool_disabled',
        tool: 'write_file',
        message: 'Tool "write_file" is disabled for this AutoResearch run. Allowed tools: ssh_exec',
        cause: 'Allowed tools: ssh_exec',
      }),
      durationMs: 0,
    });
  });

  it('allows the local AutoResearch tool catalog to write files and execute commands', async () => {
    const resolveAll = jest.fn();
    mockPartitionTools.mockImplementation((tools: unknown[]) => ({
      concurrent: [],
      serial: tools,
    }));
    mockExecuteBatch
      .mockResolvedValueOnce({
        results: [
          {
            id: 'tool-1',
            content: 'Successfully wrote 4 bytes to notes.txt',
            is_error: false,
            execution_time_ms: 4,
          },
        ],
        totalExecutionTime: 4,
        errors: [],
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'tool-2',
            content: '{"stdout":"ok","stderr":"","exitCode":0}',
            is_error: false,
            execution_time_ms: 8,
          },
        ],
        totalExecutionTime: 8,
        errors: [],
      });
    mockRunChatTurn.mockReturnValue(
      createAsyncGenerator([
        {
          type: 'tool_batch_request',
          tools: [
            { id: 'tool-1', name: 'write_file', arguments: '{"path":"notes.txt","content":"note"}' },
            { id: 'tool-2', name: 'execute_command', arguments: '{"command":"python3 run_experiment.py","cwd":"/tmp/headless"}' },
          ],
          _resolveAll: resolveAll,
        },
        {
          type: 'turn_complete',
          tokenUsage: {
            inputTokens: 3,
            outputTokens: 2,
            totalTokens: 5,
          },
        },
      ]),
    );

    const { runHeadlessAgentTurn } = await import('../agentRunner');
    const { buildAutoResearchToolCatalog } = await import('@/services/autoresearch/toolCatalog');
    await runHeadlessAgentTurn({
      sessionId: 'session-local-autoresearch',
      initialMessages: [{ role: 'user', content: 'Run locally' }],
      systemPrompt: 'system prompt',
      allowedTools: buildAutoResearchToolCatalog({ mode: 'local' }),
      resolveWorkDir: jest.fn().mockResolvedValue('/tmp/headless'),
    });

    expect(resolveAll).toHaveBeenCalledWith([
      {
        id: 'tool-1',
        content: 'Successfully wrote 4 bytes to notes.txt',
      },
      {
        id: 'tool-2',
        content: '{"stdout":"ok","stderr":"","exitCode":0}',
      },
    ]);
    expect(mockExecuteBatch).toHaveBeenNthCalledWith(
      1,
      [
        {
          id: 'tool-1',
          name: 'write_file',
          arguments: { path: 'notes.txt', content: 'note' },
        },
      ],
      expect.objectContaining({
        sessionId: 'session-local-autoresearch',
        workDir: '/tmp/headless',
        source: 'headless_agent',
        allowedTools: expect.arrayContaining(['get_current_workspace', 'execute_command', 'read_file', 'write_file', 'create_directory']),
      }),
    );
    expect(mockExecuteBatch).toHaveBeenNthCalledWith(
      2,
      [
        {
          id: 'tool-2',
          name: 'execute_command',
          arguments: { command: 'python3 run_experiment.py', cwd: '/tmp/headless' },
        },
      ],
      expect.objectContaining({
        sessionId: 'session-local-autoresearch',
        workDir: '/tmp/headless',
        source: 'headless_agent',
        allowedTools: expect.arrayContaining(['get_current_workspace', 'execute_command', 'read_file', 'write_file', 'create_directory']),
      }),
    );
  });

  it('defaults AutoResearch headless turns to bypass permission mode', async () => {
    const resolveAll = jest.fn();
    mockRunChatTurn.mockReturnValue(
      createAsyncGenerator([
        {
          type: 'tool_batch_request',
          tools: [
            { id: 'tool-1', name: 'execute_command', arguments: '{"command":"python3 run_experiment.py"}' },
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

    const { runHeadlessAgentTurn } = await import('../agentRunner');
    await runHeadlessAgentTurn({
      sessionId: 'session-autoresearch-bypass',
      initialMessages: [{ role: 'user', content: 'Run one AutoResearch step' }],
      systemPrompt: 'system prompt',
      toolExecutionSource: 'autoresearch_phase',
    });

    expect(mockExecuteBatch).toHaveBeenCalledWith(
      [
        {
          id: 'tool-1',
          name: 'execute_command',
          arguments: { command: 'python3 run_experiment.py' },
        },
      ],
      expect.objectContaining({
        sessionId: 'session-autoresearch-bypass',
        source: 'autoresearch_phase',
        permissionMode: 'bypass',
        executionMode: 'bypass',
      }),
    );
    const [bypassResults] = resolveAll.mock.calls[0] ?? [];
    expect(bypassResults?.[0]?.content).toBe('file contents');
  });

  it('respects an explicit permission mode override for headless turns', async () => {
    const resolveAll = jest.fn();
    mockRunChatTurn.mockReturnValue(
      createAsyncGenerator([
        {
          type: 'tool_batch_request',
          tools: [
            { id: 'tool-1', name: 'read_file', arguments: '{"path":"README.md"}' },
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

    const { runHeadlessAgentTurn } = await import('../agentRunner');
    await runHeadlessAgentTurn({
      sessionId: 'session-explicit-standard',
      initialMessages: [{ role: 'user', content: 'Read one file' }],
      systemPrompt: 'system prompt',
      toolExecutionSource: 'autoresearch_phase',
      permissionMode: 'standard',
    });

    expect(mockExecuteBatch).toHaveBeenCalledWith(
      [
        {
          id: 'tool-1',
          name: 'read_file',
          arguments: { path: 'README.md' },
        },
      ],
      expect.objectContaining({
        sessionId: 'session-explicit-standard',
        source: 'autoresearch_phase',
        permissionMode: 'standard',
        executionMode: undefined,
      }),
    );
    const [standardResults] = resolveAll.mock.calls[0] ?? [];
    expect(standardResults?.[0]?.content).toBe('file contents');
  });

  it('rejects ssh_exec when the run is restricted to the local AutoResearch lane', async () => {
    const resolveAll = jest.fn();
    mockRunChatTurn.mockReturnValue(
      createAsyncGenerator([
        {
          type: 'tool_batch_request',
          tools: [
            { id: 'tool-1', name: 'ssh_exec', arguments: '{"command":"pwd"}' },
          ],
          _resolveAll: resolveAll,
        },
        {
          type: 'turn_complete',
          tokenUsage: {
            inputTokens: 2,
            outputTokens: 1,
            totalTokens: 3,
          },
        },
      ]),
    );

    const { runHeadlessAgentTurn } = await import('../agentRunner');
    const { buildAutoResearchToolCatalog } = await import('@/services/autoresearch/toolCatalog');
    await runHeadlessAgentTurn({
      sessionId: 'session-local-reject',
      initialMessages: [{ role: 'user', content: 'Stay local' }],
      systemPrompt: 'system prompt',
      allowedTools: buildAutoResearchToolCatalog({ mode: 'local' }),
    });

    expect(mockExecuteBatch).not.toHaveBeenCalled();
    const [localRejectResults] = resolveAll.mock.calls[0] ?? [];
    expect(localRejectResults).toHaveLength(1);
    expect(localRejectResults?.[0]?.id).toBe('tool-1');
    const localRejectPayload = JSON.parse(localRejectResults?.[0]?.content ?? '{}');
    expect(localRejectPayload).toMatchObject({
      error: true,
      error_kind: 'tool_disabled',
      tool: 'ssh_exec',
    });
    expect(localRejectPayload.message).toContain('Tool "ssh_exec" is disabled for this AutoResearch run.');
  });

  it('rejects execute_command when the run is restricted to the SSH AutoResearch lane', async () => {
    const resolveAll = jest.fn();
    mockRunChatTurn.mockReturnValue(
      createAsyncGenerator([
        {
          type: 'tool_batch_request',
          tools: [
            { id: 'tool-1', name: 'execute_command', arguments: '{"command":"python3 run_experiment.py"}' },
          ],
          _resolveAll: resolveAll,
        },
        {
          type: 'turn_complete',
          tokenUsage: {
            inputTokens: 2,
            outputTokens: 1,
            totalTokens: 3,
          },
        },
      ]),
    );

    const { runHeadlessAgentTurn } = await import('../agentRunner');
    const { buildAutoResearchToolCatalog } = await import('@/services/autoresearch/toolCatalog');
    await runHeadlessAgentTurn({
      sessionId: 'session-ssh-reject',
      initialMessages: [{ role: 'user', content: 'Stay on SSH tools' }],
      systemPrompt: 'system prompt',
      allowedTools: buildAutoResearchToolCatalog({ mode: 'ssh' }),
    });

    expect(mockExecuteBatch).not.toHaveBeenCalled();
    const [sshRejectResults] = resolveAll.mock.calls[0] ?? [];
    expect(sshRejectResults).toHaveLength(1);
    expect(sshRejectResults?.[0]?.id).toBe('tool-1');
    const sshRejectPayload = JSON.parse(sshRejectResults?.[0]?.content ?? '{}');
    expect(sshRejectPayload).toMatchObject({
      error: true,
      error_kind: 'tool_disabled',
      tool: 'execute_command',
    });
    expect(sshRejectPayload.message).toContain('Tool "execute_command" is disabled for this AutoResearch run.');
  });

  it('rejects unrelated tools when the run is restricted to bootstrap-only tools', async () => {
    const resolveAll = jest.fn();
    mockRunChatTurn.mockReturnValue(
      createAsyncGenerator([
        {
          type: 'tool_batch_request',
          tools: [
            { id: 'tool-1', name: 'execute_command', arguments: '{"command":"pwd"}' },
          ],
          _resolveAll: resolveAll,
        },
        {
          type: 'turn_complete',
          tokenUsage: {
            inputTokens: 2,
            outputTokens: 1,
            totalTokens: 3,
          },
        },
      ]),
    );

    const { AUTORESEARCH_BOOTSTRAP_TOOL_NAMES } = await import('@/services/tools/autoresearchBootstrap');
    const { runHeadlessAgentTurn } = await import('../agentRunner');
    await runHeadlessAgentTurn({
      sessionId: 'session-bootstrap-reject',
      initialMessages: [{ role: 'user', content: 'Bootstrap only' }],
      systemPrompt: 'system prompt',
      allowedTools: [...AUTORESEARCH_BOOTSTRAP_TOOL_NAMES],
    });

    expect(mockExecuteBatch).not.toHaveBeenCalled();
    const [bootstrapRejectResults] = resolveAll.mock.calls[0] ?? [];
    expect(bootstrapRejectResults).toHaveLength(1);
    expect(bootstrapRejectResults?.[0]?.id).toBe('tool-1');
    const bootstrapRejectPayload = JSON.parse(bootstrapRejectResults?.[0]?.content ?? '{}');
    expect(bootstrapRejectPayload).toMatchObject({
      error: true,
      error_kind: 'tool_disabled',
      tool: 'execute_command',
    });
    expect(bootstrapRejectPayload.message).toContain('Tool "execute_command" is disabled for this AutoResearch run.');
  });

  it('times out and cleans up when the underlying stream never resolves', async () => {
    const mockReturn = jest.fn().mockResolvedValue({ done: true, value: undefined });
    let passedSignal: AbortSignal | undefined;
    const iterator = {
      next: () => new Promise<IteratorResult<unknown>>(() => {}),
      return: mockReturn,
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    mockRunChatTurn.mockImplementation((_a, _b, _c, _d, _e, _f, options) => {
      passedSignal = options?.signal;
      return iterator;
    });

    const { runHeadlessAgentTurn } = await import('../agentRunner');

    const promise = runHeadlessAgentTurn({
      sessionId: 'session-never-resolving',
      initialMessages: [{ role: 'user', content: 'Stalled' }],
      systemPrompt: 'system prompt',
      timeoutMs: 50,
    });

    await expect(promise).rejects.toThrow('Headless agent turn timed out after 50ms');
    expect(mockReturn).toHaveBeenCalled();
    expect(passedSignal?.aborted).toBe(true);
  });

  it('aborts immediately when AbortSignal triggers during a never-resolving stream', async () => {
    const mockReturn = jest.fn().mockResolvedValue({ done: true, value: undefined });
    const iterator = {
      next: () => new Promise<IteratorResult<unknown>>(() => {}),
      return: mockReturn,
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    mockRunChatTurn.mockReturnValue(iterator);

    const controller = new AbortController();
    const { runHeadlessAgentTurn } = await import('../agentRunner');

    const promise = runHeadlessAgentTurn({
      sessionId: 'session-never-resolving-abort',
      initialMessages: [{ role: 'user', content: 'Abort test' }],
      systemPrompt: 'system prompt',
      timeoutMs: 10000,
      signal: controller.signal,
    });

    setTimeout(() => {
      controller.abort();
    }, 20);

    await expect(promise).rejects.toThrow('Headless agent turn aborted');
    expect(mockReturn).toHaveBeenCalled();
  });

  it('aborts signal when getNextEngineEvent timeout promise rejects during never resolving next', async () => {
    const mockReturn = jest.fn().mockResolvedValue({ done: true, value: undefined });
    let passedSignal: AbortSignal | undefined;
    const iterator = {
      next: () => new Promise<IteratorResult<unknown>>(() => {}), // never resolving next
      return: mockReturn,
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    mockRunChatTurn.mockImplementation((_a, _b, _c, _d, _e, _f, options) => {
      passedSignal = options?.signal;
      return iterator;
    });

    const { runHeadlessAgentTurn } = await import('../agentRunner');

    const promise = runHeadlessAgentTurn({
      sessionId: 'session-never-resolving-catch-test',
      initialMessages: [{ role: 'user', content: 'Never resolving next' }],
      systemPrompt: 'system prompt',
      timeoutMs: 30,
    });

    await expect(promise).rejects.toThrow('Headless agent turn timed out after 30ms');
    expect(passedSignal?.aborted).toBe(true);
    expect(mockReturn).toHaveBeenCalled();
  });
});
