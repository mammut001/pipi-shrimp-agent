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
    jest.clearAllMocks();
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
  });

  it('retries once with strict budget mode before surfacing a failure', async () => {
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
    expect((errorEvent.value.error as Error).message).toContain('Exceeded maximum tool rounds (4)');
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(2);
  });
});
