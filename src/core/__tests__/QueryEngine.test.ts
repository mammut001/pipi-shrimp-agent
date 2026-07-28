import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockBuildResolvedChatRequest = jest.fn();
const mockInvokeRustAPIStream = jest.fn();
const mockOnTurnComplete = jest.fn();
const mockCreateMemoryHook = jest.fn(() => ({
  onTurnComplete: mockOnTurnComplete,
}));
const mockGetSettingsState = jest.fn(() => ({
  agentSettings: { maxToolRounds: 4 },
}));
const mockChatStoreState = {
  sessions: [] as Array<{ id: string; pipiOutputDir?: string }>,
};

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => mockGetSettingsState(),
  },
  useChatStore: {
    getState: () => mockChatStoreState,
  },
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: jest.fn(),
  validateResolvedAgentConfig: jest.fn(() => []),
  formatAgentConfigValidationError: jest.fn(() => ''),
}));

jest.mock('@/services/resolvedChatRequest', () => ({
  buildResolvedChatRequest: (...args: unknown[]) => mockBuildResolvedChatRequest(...args),
}));

jest.mock('@/core/streamAdapter', () => ({
  invokeRustAPIStream: (...args: unknown[]) => mockInvokeRustAPIStream(...args),
}));

jest.mock('@/services/memory/memoryHooks', () => ({
  createMemoryHook: (...args: unknown[]) => mockCreateMemoryHook(...args),
}));

jest.mock('@/services/tools/toolResultSanitizer', () => ({
  sanitizeToolResultForModel: (_tool: string, value: string) => value,
}));

import { runChatTurn } from '../QueryEngine';

describe('QueryEngine context overflow fallback', () => {
  const resolvedConfig = {
    configId: 'cfg-1',
    name: 'MiniMax Global',
    provider: 'minimax' as const,
    providerLabel: 'MiniMax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai' as const,
    hasApiKey: true,
    hasBaseUrl: true,
    apiKey: 'secret',
  };

  beforeEach(() => {
    mockInvokeRustAPIStream.mockReset();
    mockBuildResolvedChatRequest.mockReset();
    mockCreateMemoryHook.mockClear();
    mockChatStoreState.sessions = [];
    mockGetSettingsState.mockReturnValue({
      agentSettings: { maxToolRounds: 4 },
    });
    mockBuildResolvedChatRequest.mockImplementation((_config, rawOptions) => {
      const options = rawOptions as {
        messages: Array<Record<string, unknown>>;
        systemPrompt: string;
        sessionId: string;
      };
      return ({
      params: {
        messages: options.messages,
        apiKey: 'secret',
        model: 'MiniMax-M2.7',
        baseUrl: 'https://api.minimaxi.com/v1',
        systemPrompt: options.systemPrompt,
        sessionId: options.sessionId,
        apiFormat: 'openai',
      },
      diagnostics: {
        selectedConfigName: 'MiniMax Global',
        selectedProvider: 'minimax',
        selectedModel: 'MiniMax-M2.7',
        apiFormat: 'openai',
        hasApiKey: true,
        hasBaseURL: true,
        adapterName: 'minimax-openai',
        endpointHost: 'api.minimaxi.com',
        endpointPreview: 'https://api.minimaxi.com/v1/chat/completions',
        authorizationHeaderPresent: true,
        estimatedContextChars: 10,
        contextWasPruned: false,
        droppedContextCount: 0,
        droppedContextReasons: [],
      },
      });
    });
  });

  it('hydrates memory hook with the session PiPi Output Folder from chat store', async () => {
    mockChatStoreState.sessions = [
      { id: 'session-1', pipiOutputDir: '/tmp/pipi-output/session-1' },
    ];
    mockInvokeRustAPIStream.mockImplementationOnce(async function* succeed() {
      yield { type: 'text_delta', content: 'OK' };
      yield {
        type: 'api_response_complete',
        response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
      };
    });

    for await (const _event of runChatTurn(
      'session-1',
      [{ role: 'user', content: 'hello' }],
      'system prompt',
      '/tmp/project',
      false,
      resolvedConfig,
    )) {
      // drain
    }

    expect(mockCreateMemoryHook).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      pipiOutputDir: '/tmp/pipi-output/session-1',
    });
  });

  it('retries once with strict budget mode before surfacing a failure', async () => {
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* fail() {
        throw new Error('Context compression check failed. Consider freeing up space.');
      })
      .mockImplementationOnce(async function* succeed() {
        yield { type: 'text_delta', content: 'OK' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      });

    const events = [];
    for await (const event of runChatTurn(
      'session-1',
      [{ role: 'user', content: 'hello' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'status_update', message: 'Context too large, retrying with a pruned request.' },
      { type: 'text_delta', content: 'OK' },
      {
        type: 'turn_complete',
        tokenUsage: { input_tokens: 1, output_tokens: 1, model: 'MiniMax-M2.7' },
      },
    ]);
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      1,
      resolvedConfig,
      expect.objectContaining({ contextBudget: { strict: false } }),
    );
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      2,
      resolvedConfig,
      expect.objectContaining({ contextBudget: { strict: true } }),
    );
  });

  it('reserves a final response round before hard tool exhaustion', async () => {
    mockGetSettingsState.mockReturnValue({
      agentSettings: { maxToolRounds: 2 },
    });

    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* firstToolTurn() {
        yield {
          type: 'tool_call',
          tool: { id: 'tool-1', name: 'read_file', arguments: '{"path":"README.md"}' },
        };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      })
      .mockImplementationOnce(async function* finalSummaryTurn() {
        yield { type: 'text_delta', content: 'Here is what I found.' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 3 }, model: 'MiniMax-M2.7' },
        };
      });

    const iterator = runChatTurn(
      'session-2',
      [{ role: 'user', content: 'hello' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    );

    const statusEvent = await iterator.next();
    expect(statusEvent.value).toEqual({
      type: 'status_update',
      message: 'Executing 1 tool(s): read_file',
    });

    const toolBatchEvent = await iterator.next();
    expect(toolBatchEvent.value.type).toBe('tool_batch_request');
    toolBatchEvent.value._resolveAll([{ id: 'tool-1', content: 'README contents' }]);

    let completeEvent = await iterator.next();
    while (completeEvent.value?.type === 'text_delta') {
      completeEvent = await iterator.next();
    }
    expect(completeEvent.value.type).toBe('turn_complete');
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(2);
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      2,
      resolvedConfig,
      expect.objectContaining({ noTools: true }),
    );
  });

  it('retries once when the model emits text-form tool calls instead of structured tool_calls', async () => {
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* malformed() {
        throw new Error('malformed_tool_call: Assistant emitted text-form tool calls instead of structured tool_calls.');
      })
      .mockImplementationOnce(async function* recovered() {
        yield { type: 'text_delta', content: 'Recovered' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 2, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      });

    const events = [];
    for await (const event of runChatTurn(
      'session-3',
      [{ role: 'user', content: 'use a tool if needed' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'status_update',
        message: 'Model emitted text-form tool calls. Retrying with a structured tool-calling reminder.',
      },
      { type: 'text_delta', content: 'Recovered' },
      {
        type: 'turn_complete',
        tokenUsage: { input_tokens: 2, output_tokens: 1, model: 'MiniMax-M2.7' },
      },
    ]);
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      1,
      resolvedConfig,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('structured OpenAI function-calling channel named tool_calls'),
      }),
    );
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      2,
      resolvedConfig,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Your previous response used text-form tool calls, which were ignored. Use the structured tool_calls channel only.',
          }),
        ]),
      }),
    );
  });

  it('surfaces an explicit user-facing error after malformed_tool_call retries are exhausted', async () => {
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* malformedOnce() {
        throw new Error('malformed_tool_call: Assistant emitted text-form tool calls instead of structured tool_calls.');
      })
      .mockImplementationOnce(async function* malformedTwice() {
        throw new Error('malformed_tool_call: Assistant emitted text-form tool calls instead of structured tool_calls.');
      })
      .mockImplementationOnce(async function* malformedThrice() {
        throw new Error('malformed_tool_call: Assistant emitted text-form tool calls instead of structured tool_calls.');
      });

    const events = [];
    for await (const event of runChatTurn(
      'session-malformed-exhausted',
      [{ role: 'user', content: 'use tools' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    )) {
      events.push(event);
    }

    expect(events.slice(0, 2)).toEqual([
      {
        type: 'status_update',
        message: 'Model emitted text-form tool calls. Retrying with a structured tool-calling reminder.',
      },
      {
        type: 'status_update',
        message: 'Model repeated text-form tool calls. Retrying with a stricter structured tool-calling reminder.',
      },
    ]);
    const errorEvent = events[events.length - 1];
    expect(errorEvent.type).toBe('error');
    expect(errorEvent.error).toBeInstanceOf(Error);
    expect(errorEvent.error.message).toMatch(/after 2 automatic retries/i);
    expect(errorEvent.error.message).toMatch(/not a silent interrupt/i);
    expect(errorEvent.error.message).toMatch(/malformed_tool_call/);
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(3);
  });

  it('retries twice when the model repeatedly emits text-form tool calls before recovering', async () => {
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* malformedOnce() {
        throw new Error('malformed_tool_call: Assistant emitted text-form tool calls instead of structured tool_calls.');
      })
      .mockImplementationOnce(async function* malformedTwice() {
        throw new Error('malformed_tool_call: Assistant emitted text-form tool calls instead of structured tool_calls.');
      })
      .mockImplementationOnce(async function* recovered() {
        yield { type: 'text_delta', content: 'Recovered after second retry' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 3, output_tokens: 2 }, model: 'MiniMax-M2.7' },
        };
      });

    const events = [];
    for await (const event of runChatTurn(
      'session-4',
      [{ role: 'user', content: 'inspect the project and use tools if needed' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'status_update',
        message: 'Model emitted text-form tool calls. Retrying with a structured tool-calling reminder.',
      },
      {
        type: 'status_update',
        message: 'Model repeated text-form tool calls. Retrying with a stricter structured tool-calling reminder.',
      },
      { type: 'text_delta', content: 'Recovered after second retry' },
      {
        type: 'turn_complete',
        tokenUsage: { input_tokens: 3, output_tokens: 2, model: 'MiniMax-M2.7' },
      },
    ]);
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(3);
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      3,
      resolvedConfig,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Your previous response used text-form tool calls, which were ignored. Use the structured tool_calls channel only.',
          }),
          expect.objectContaining({
            role: 'user',
            content: 'Your previous response still used text-form or XML tool calls. Reply using only the structured tool_calls channel. Do not emit XML tags, markdown, or prose describing the tool call.',
          }),
        ]),
      }),
    );
  });
});

describe('QueryEngine all-failed tool batch short-circuit', () => {
  const resolvedConfig = {
    configId: 'cfg-1',
    name: 'MiniMax Global',
    provider: 'minimax' as const,
    providerLabel: 'MiniMax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai' as const,
    hasApiKey: true,
    hasBaseUrl: true,
    apiKey: 'secret',
  };

  beforeEach(() => {
    mockInvokeRustAPIStream.mockReset();
    mockBuildResolvedChatRequest.mockReset();
    mockGetSettingsState.mockReturnValue({
      agentSettings: { maxToolRounds: 4 },
    });
    mockBuildResolvedChatRequest.mockImplementation((_config, rawOptions) => {
      const options = rawOptions as { messages: Array<Record<string, unknown>>; systemPrompt: string; sessionId: string };
      return ({
        params: {
          messages: options.messages,
          apiKey: 'secret',
          model: 'MiniMax-M2.7',
          baseUrl: 'https://api.minimaxi.com/v1',
          systemPrompt: options.systemPrompt,
          sessionId: options.sessionId,
          apiFormat: 'openai',
        },
        diagnostics: {
          selectedConfigName: 'MiniMax Global',
          selectedProvider: 'minimax',
          selectedModel: 'MiniMax-M2.7',
          apiFormat: 'openai',
          hasApiKey: true,
          hasBaseURL: true,
          adapterName: 'minimax-openai',
          endpointHost: 'api.minimaxi.com',
          endpointPreview: 'https://api.minimaxi.com/v1/chat/completions',
          authorizationHeaderPresent: true,
          estimatedContextChars: 10,
          contextWasPruned: false,
          droppedContextCount: 0,
          droppedContextReasons: [],
        },
      });
    });
  });

  it('yields an actionable error when every tool call in a batch failed', async () => {
    // First turn: the model tries two tool calls. The consumer
    // resolves both as errors. The second turn would normally
    // burn another model round — but the all-failed short-circuit
    // surfaces an actionable error mentioning Ask/Agent/Bypass
    // instead.
    mockInvokeRustAPIStream.mockImplementationOnce(async function* toolTurn() {
      yield {
        type: 'tool_call',
        tool: { id: 'tool-1', name: 'read_file', arguments: '{"path":"../forbidden"}' },
      };
      yield {
        type: 'tool_call',
        tool: { id: 'tool-2', name: 'execute_command', arguments: '{"command":"rm -rf /"}' },
      };
      yield {
        type: 'api_response_complete',
        response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
      };
    });

    const iterator = runChatTurn(
      'session-ask-1',
      [{ role: 'user', content: '你能做什么？' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    );

    const status = await iterator.next();
    expect(status.value).toEqual({
      type: 'status_update',
      message: 'Executing 2 tool(s): read_file, execute_command',
    });

    const batch = await iterator.next();
    expect(batch.value.type).toBe('tool_batch_request');
    // Simulate the consumer rejecting both tool calls (e.g. Ask
    // mode outer guard, dangerous-command hook, etc.).
    batch.value._resolveAll([
      { id: 'tool-1', content: 'Error: Tool execution is disabled in Ask mode. Switch to Agent or Bypass to run tools.' },
      { id: 'tool-2', content: 'Error: Blocked: Attempting to delete root filesystem' },
    ]);

    const error = await iterator.next();
    expect(error.value.type).toBe('error');
    const message = (error.value.error as Error).message;
    expect(message).toMatch(/本轮所有工具调用都被拒绝/);
    expect(message).toMatch(/Ask mode/i);
    expect(message).toMatch(/Agent or Bypass/i);

    // The short-circuit must NOT make a second model call.
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(1);
    const next = await iterator.next();
    expect(next.done).toBe(true);
  });

  it('feeds recoverable file-not-found errors back to the model instead of aborting', async () => {
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* missingReadmeTurn() {
        yield {
          type: 'tool_call',
          tool: { id: 'tool-1', name: 'read_file', arguments: '{"path":"README.md"}' },
        };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      })
      .mockImplementationOnce(async function* recoveredTurn() {
        yield { type: 'text_delta', content: 'Found NOTICE.md instead.' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 2, output_tokens: 3 }, model: 'MiniMax-M2.7' },
        };
      });

    const iterator = runChatTurn(
      'session-recover-1',
      [{ role: 'user', content: 'Read the FocusApp README and summarize it.' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    );

    const status = await iterator.next();
    expect(status.value).toEqual({
      type: 'status_update',
      message: 'Executing 1 tool(s): read_file',
    });

    const batch = await iterator.next();
    expect(batch.value.type).toBe('tool_batch_request');
    batch.value._resolveAll([
      {
        id: 'tool-1',
        content: "Error: Failed to read file '/Users/dogecoin/Documents/GitHub/FocusApp/README.md': os error 2",
      },
    ]);

    let completeEvent = await iterator.next();
    while (completeEvent.value?.type === 'text_delta') {
      completeEvent = await iterator.next();
    }

    expect(completeEvent.value.type).toBe('turn_complete');
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(2);
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      2,
      resolvedConfig,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('__TOOL_RESULT__:tool-1:'),
          }),
        ]),
      }),
    );
  });
});

describe('QueryEngine Ask-mode noTools contract', () => {
  const resolvedConfig = {
    configId: 'cfg-1',
    name: 'MiniMax Global',
    provider: 'minimax' as const,
    providerLabel: 'MiniMax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiFormat: 'openai' as const,
    hasApiKey: true,
    hasBaseUrl: true,
    apiKey: 'secret',
  };

  beforeEach(() => {
    mockInvokeRustAPIStream.mockReset();
    mockBuildResolvedChatRequest.mockReset();
    mockGetSettingsState.mockReturnValue({
      agentSettings: { maxToolRounds: 4 },
    });
    mockBuildResolvedChatRequest.mockImplementation((_config, rawOptions) => {
      const options = rawOptions as {
        messages: Array<Record<string, unknown>>;
        systemPrompt: string;
        sessionId: string;
      };
      return ({
      params: {
        messages: options.messages,
        apiKey: 'secret',
        model: 'MiniMax-M2.7',
        baseUrl: 'https://api.minimaxi.com/v1',
        systemPrompt: options.systemPrompt,
        sessionId: options.sessionId,
        apiFormat: 'openai',
      },
      diagnostics: {
        selectedConfigName: 'MiniMax Global',
        selectedProvider: 'minimax',
        selectedModel: 'MiniMax-M2.7',
        apiFormat: 'openai',
        hasApiKey: true,
        hasBaseURL: true,
        adapterName: 'minimax-openai',
        endpointHost: 'api.minimaxi.com',
        endpointPreview: 'https://api.minimaxi.com/v1/chat/completions',
        authorizationHeaderPresent: true,
        estimatedContextChars: 10,
        contextWasPruned: false,
        droppedContextCount: 0,
        droppedContextReasons: [],
      },
      });
    });
  });

  it('Ask mode (noTools=true) does not inject the OpenAI tool-calling protocol addendum', async () => {
    mockInvokeRustAPIStream.mockImplementationOnce(async function* askReply() {
      yield { type: 'text_delta', content: '我可以帮你写代码、读文件、回答问题。' };
      yield {
        type: 'api_response_complete',
        response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
      };
    });

    const events = [];
    for await (const event of runChatTurn(
      'session-ask-2',
      [{ role: 'user', content: '你能做什么？' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
      { noTools: true },
    )) {
      events.push(event);
    }

    expect(events.find((e) => e.type === 'turn_complete')).toBeTruthy();
    // System prompt must NOT include the tool-call addendum.
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(1);
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledWith(
      resolvedConfig,
      expect.objectContaining({
        noTools: true,
        systemPrompt: 'system prompt',
      }),
    );
    const call = mockBuildResolvedChatRequest.mock.calls[0]?.[1] as { systemPrompt?: string };
    expect(call?.systemPrompt).not.toMatch(/structured OpenAI function-calling channel named tool_calls/);
  });

  it('Plan mode (allowedTools non-empty) still injects the OpenAI tool-calling protocol addendum', async () => {
    mockInvokeRustAPIStream.mockImplementationOnce(async function* planReply() {
      yield { type: 'text_delta', content: 'Plan written to docs.' };
      yield {
        type: 'api_response_complete',
        response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
      };
    });

    for await (const event of runChatTurn(
      'session-plan-1',
      [{ role: 'user', content: 'plan this' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
      { allowedTools: ['read_file', 'list_files'] },
    )) {
      // Drain the iterator.
      if (event.type === 'turn_complete') break;
    }

    expect(mockBuildResolvedChatRequest).toHaveBeenCalledWith(
      resolvedConfig,
      expect.objectContaining({
        allowedTools: ['read_file', 'list_files'],
      }),
    );
    const call = mockBuildResolvedChatRequest.mock.calls[0]?.[1] as { systemPrompt?: string };
    expect(call?.systemPrompt).toMatch(/structured OpenAI function-calling channel named tool_calls/);
    expect(call?.systemPrompt).toMatch(/HARD RULE: you may call only these tools in this turn: read_file, list_files/);
  });

  it('Tool-budget final summary round uses noTools=true and does not inject the tool-call protocol', async () => {
    mockGetSettingsState.mockReturnValue({
      agentSettings: { maxToolRounds: 2 },
    });

    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* toolTurn() {
        yield {
          type: 'tool_call',
          tool: { id: 'tool-1', name: 'read_file', arguments: '{"path":"README.md"}' },
        };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      })
      .mockImplementationOnce(async function* finalSummary() {
        yield { type: 'text_delta', content: 'Final summary here.' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      });

    const iterator = runChatTurn(
      'session-final-summary',
      [{ role: 'user', content: 'inspect and summarize' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    );

    // Drain the tool batch.
    const status = await iterator.next();
    expect(status.value.type).toBe('status_update');
    const batch = await iterator.next();
    expect(batch.value.type).toBe('tool_batch_request');
    batch.value._resolveAll([{ id: 'tool-1', content: 'README contents' }]);

    // Drain the final summary turn.
    let event = await iterator.next();
    while (event.value?.type === 'text_delta' || event.value?.type === 'status_update') {
      event = await iterator.next();
    }
    expect(event.value.type).toBe('turn_complete');

    // The second (final) request must be noTools=true and must NOT
    // include the OpenAI tool-call protocol addendum — otherwise the
    // model would loop back into tool calls right at the budget edge.
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(2);
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      2,
      resolvedConfig,
      expect.objectContaining({ noTools: true }),
    );
    const finalCall = mockBuildResolvedChatRequest.mock.calls[1]?.[1] as { systemPrompt?: string };
    expect(finalCall?.systemPrompt).not.toMatch(/structured OpenAI function-calling channel named tool_calls/);
  });

  it('Ask mode lazy tool-call nudge never fires (no tools available)', async () => {
    // The classic Ask-mode regression: model replies with planning
    // text like "Let me read the README..." — the lazy-nudge must NOT
    // fire when noTools is true, otherwise we burn a model round
    // forcing the model to call tools it can't actually use.
    mockInvokeRustAPIStream.mockImplementationOnce(async function* askLazy() {
      yield { type: 'text_delta', content: '让我先读取一下项目结构，然后给你一个简单介绍。' };
      yield {
        type: 'api_response_complete',
        response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
      };
    });

    const events = [];
    for await (const event of runChatTurn(
      'session-ask-3',
      [{ role: 'user', content: '你能做什么？' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
      { noTools: true },
    )) {
      events.push(event);
    }

    // Expect a turn_complete with no retry / nudge.
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === 'turn_complete')).toBeTruthy();
    expect(events.find((e) => e.type === 'status_update' && /nudge/i.test(String((e as { message?: string }).message ?? '')))).toBeUndefined();
  });

  it('retries once when every Plan-mode tool call is rejected for leaving the allowed tool lane', async () => {
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* toolTurn() {
        yield {
          type: 'tool_call',
          tool: { id: 'tool-1', name: 'execute_command', arguments: '{"command":"ls"}' },
        };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      })
      .mockImplementationOnce(async function* recovered() {
        yield { type: 'text_delta', content: '## Execution Plan: README summary update' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 2, output_tokens: 4 }, model: 'MiniMax-M2.7' },
        };
      });

    const iterator = runChatTurn(
      'session-plan-retry',
      [{ role: 'user', content: 'inspect the repo and draft a plan' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
      { allowedTools: ['read_file', 'list_files', 'search_files'] },
    );

    const status = await iterator.next();
    expect(status.value).toEqual({
      type: 'status_update',
      message: 'Executing 1 tool(s): execute_command',
    });

    const batch = await iterator.next();
    expect(batch.value.type).toBe('tool_batch_request');
    batch.value._resolveAll([
      { id: 'tool-1', content: 'Error: This tool is not allowed in Plan mode (read-only inspection and plan docs only).' },
    ]);

    const retryStatus = await iterator.next();
    expect(retryStatus.value).toEqual({
      type: 'status_update',
      message: 'Model called disallowed tools. Retrying with a stricter allowlist reminder (read_file, list_files, search_files).',
    });

    let event = await iterator.next();
    while (event.value?.type === 'text_delta') {
      event = await iterator.next();
    }
    expect(event.value).toEqual({
      type: 'turn_complete',
      tokenUsage: { input_tokens: 2, output_tokens: 4, model: 'MiniMax-M2.7' },
    });

    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      2,
      resolvedConfig,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Only these tools are allowed in this turn: read_file, list_files, search_files.'),
          }),
        ]),
      }),
    );
  });

  it('clears tool batch timeout handle after execution to prevent open handle hangs', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* toolTurn() {
        yield {
          type: 'tool_call',
          tool: { id: 'tool-cleanup-1', name: 'read_file', arguments: '{"path":"README.md"}' },
        };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      })
      .mockImplementationOnce(async function* summaryTurn() {
        yield { type: 'text_delta', content: 'Done.' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
        };
      });

    const iterator = runChatTurn(
      'session-cleanup-test',
      [{ role: 'user', content: 'hello' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    );

    await iterator.next(); // status_update
    const toolBatchEvent = await iterator.next();
    toolBatchEvent.value._resolveAll([{ id: 'tool-cleanup-1', content: 'Content' }]);

    let completeEvent = await iterator.next();
    while (completeEvent.value?.type === 'text_delta') {
      completeEvent = await iterator.next();
    }

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
