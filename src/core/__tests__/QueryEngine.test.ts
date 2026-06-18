import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockBuildResolvedChatRequest = jest.fn();
const mockInvokeRustAPIStream = jest.fn();
const mockOnTurnComplete = jest.fn();
const mockGetSettingsState = jest.fn(() => ({
  agentSettings: { maxToolRounds: 4 },
}));

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => mockGetSettingsState(),
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
  createMemoryHook: () => ({
    onTurnComplete: mockOnTurnComplete,
  }),
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
      .mockImplementationOnce(async function* secondToolTurn() {
        yield {
          type: 'tool_call',
          tool: { id: 'tool-2', name: 'write_file', arguments: '{"path":"README.md","content":"x"}' },
        };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1 }, model: 'MiniMax-M2.7' },
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

    const errorEvent = await iterator.next();
    expect(errorEvent.value.type).toBe('error');
    expect((errorEvent.value.error as Error).message).toContain('Exceeded maximum tool rounds (2)');
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(2);
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
    expect(message).toMatch(/Every tool call in the last round was rejected/i);
    expect(message).toMatch(/Ask mode/i);
    expect(message).toMatch(/Agent or Bypass/i);

    // The short-circuit must NOT make a second model call.
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(1);
    const next = await iterator.next();
    expect(next.done).toBe(true);
  });
});
