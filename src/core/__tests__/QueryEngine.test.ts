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
          response: { usage: { input_tokens: 1, output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0}, model: 'MiniMax-M2.7' },
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
        tokenUsage: { input_tokens: 1, output_tokens: 1, model: 'MiniMax-M2.7',
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0},
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
    mockInvokeRustAPIStream.mockReset();
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* firstToolTurn() {
        yield {
          type: 'tool_call',
          tool: { id: 'tool-1', name: 'read_file', arguments: '{"path":"README.md"}' },
        };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0}, model: 'MiniMax-M2.7' },
        };
      })
      .mockImplementationOnce(async function* secondToolTurn() {
        yield {
          type: 'tool_call',
          tool: { id: 'tool-2', name: 'write_file', arguments: '{"path":"README.md","content":"x"}' },
        };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 1, output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0}, model: 'MiniMax-M2.7' },
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

  it('retries once when the model emits text-form tool calls instead of structured tool_calls', async () => {
    mockInvokeRustAPIStream.mockReset();
    mockInvokeRustAPIStream
      .mockImplementationOnce(async function* malformed() {
        throw new Error('malformed_tool_call: Assistant emitted text-form tool calls instead of structured tool_calls.');
      })
      .mockImplementationOnce(async function* recovered() {
        yield { type: 'text_delta', content: 'Recovered' };
        yield {
          type: 'api_response_complete',
          response: { usage: { input_tokens: 2, output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0}, model: 'MiniMax-M2.7' },
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
        tokenUsage: { input_tokens: 2, output_tokens: 1, model: 'MiniMax-M2.7',
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0},
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
    mockInvokeRustAPIStream.mockReset();
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
          response: { usage: { input_tokens: 3, output_tokens: 2,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0}, model: 'MiniMax-M2.7' },
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
        tokenUsage: { input_tokens: 3, output_tokens: 2, model: 'MiniMax-M2.7',
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0},
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

  it('nudges the model to continue when it returns an empty response after a tool result', async () => {
    mockInvokeRustAPIStream.mockReset();
    mockInvokeRustAPIStream
      // Round 1: model says "好" and calls a tool — classic "acknowledge then look" pattern.
      .mockImplementationOnce(async function* round1AckAndTool() {
        yield { type: 'text_delta', content: '好' };
        yield {
          type: 'tool_call',
          tool: { id: 'tool-look-1', name: 'list_files', arguments: '{"path":"."}' },
        };
        yield {
          type: 'api_response_complete',
          response: {
            usage: {
              input_tokens: 5,
              output_tokens: 2,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            model: 'MiniMax-M2.7',
          },
        };
      })
      // Round 2: model returns an EMPTY stream — no text, no tools. Without the nudge, the
      // turn would end here with the user seeing only "好".
      .mockImplementationOnce(async function* round2Empty() {
        yield {
          type: 'api_response_complete',
          response: {
            usage: {
              input_tokens: 6,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            model: 'MiniMax-M2.7',
          },
        };
      })
      // Round 3: after the nudge, the model finally produces real follow-up content.
      .mockImplementationOnce(async function* round3Recovered() {
        yield { type: 'text_delta', content: '这个项目是 Pipi-Shrimp Agent,主要由 Tauri + React 构建。' };
        yield {
          type: 'api_response_complete',
          response: {
            usage: {
              input_tokens: 7,
              output_tokens: 14,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            model: 'MiniMax-M2.7',
          },
        };
      });

    const iterator = runChatTurn(
      'session-empty-after-tool',
      [{ role: 'user', content: '看一下这个项目' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    );

    const events: any[] = [];

    // Drive the iterator manually so we can resolve the tool batch when it shows up.
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
      if (next.value.type === 'tool_batch_request') {
        next.value._resolveAll([{ id: 'tool-look-1', content: 'README.md\npackage.json\nsrc/' }]);
      }
    }

    // The status_update from the nudge must appear, AND the turn must complete with the
    // recovered round-3 content. If the bug regresses, turn_complete would come right after
    // the tool batch with no continuation prompt and no round-3 text.
    const statusUpdates = events
      .filter((event) => event.type === 'status_update')
      .map((event) => event.message);
    expect(statusUpdates).toContain(
      'Model returned an empty response after tool results. Nudging it to continue.',
    );
    const textDeltas = events
      .filter((event) => event.type === 'text_delta')
      .map((event) => event.content)
      .join('');
    expect(textDeltas).toBe('好这个项目是 Pipi-Shrimp Agent,主要由 Tauri + React 构建。');
    expect(events[events.length - 1].type).toBe('turn_complete');

    // The continuation prompt must have been injected before the round-3 request.
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(3);
    expect(mockBuildResolvedChatRequest).toHaveBeenNthCalledWith(
      3,
      resolvedConfig,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('did not respond afterward'),
          }),
        ]),
      }),
    );
  });

  it('does not nudge when the model is the first to respond (no prior tool result)', async () => {
    // Regression guard: the nudge must only fire when the IMMEDIATE prior message was a tool
    // result. A plain empty first response should still complete the turn normally (so the
    // existing context-overflow / no-content paths keep working).
    mockInvokeRustAPIStream.mockReset();
    mockInvokeRustAPIStream.mockImplementationOnce(async function* emptyFirstResponse() {
      yield {
        type: 'api_response_complete',
        response: {
          usage: {
            input_tokens: 4,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          model: 'MiniMax-M2.7',
        },
      };
    });

    const events: any[] = [];
    for await (const event of runChatTurn(
      'session-empty-first',
      [{ role: 'user', content: 'hi' }],
      'system prompt',
      undefined,
      false,
      resolvedConfig,
    )) {
      events.push(event);
    }

    const statusUpdates = events
      .filter((event) => event.type === 'status_update')
      .map((event) => event.message);
    expect(statusUpdates).not.toContain(
      'Model returned an empty response after tool results. Nudging it to continue.',
    );
    expect(events[events.length - 1].type).toBe('turn_complete');
    expect(mockBuildResolvedChatRequest).toHaveBeenCalledTimes(1);
  });
});
