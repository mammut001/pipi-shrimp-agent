const mockInvokeRustAPIStream = jest.fn();

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({
      getActiveConfig: () => null,
    }),
  },
}));

jest.mock('@/core/streamAdapter', () => ({
  invokeRustAPIStream: (...args: unknown[]) => mockInvokeRustAPIStream(...args),
}));

import { describe, expect, it, beforeEach, jest } from '@jest/globals';

import {
  buildResolvedChatRequest,
  buildEndpointPreview,
  getResolvedChatDiagnostics,
  testResolvedChatConnection,
} from '../resolvedChatRequest';
import { resolveAgentConfig } from '../agentConfig';
import { buildConnectionFailureDetails } from '../settings/settingsConnection';

const minimaxConfig = {
  configId: 'cfg-minimax',
  name: 'MiniMax Global',
  provider: 'minimax' as const,
  model: 'MiniMax-M2.7',
  baseUrl: 'https://api.minimaxi.com/v1/',
  apiFormat: 'openai' as const,
  hasApiKey: true,
  hasBaseUrl: true,
  apiKey: 'secret-key',
};

describe('resolvedChatRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks settings-style test requests before sending when api key is missing', () => {
    expect(() => buildResolvedChatRequest({
      ...minimaxConfig,
      hasApiKey: false,
      apiKey: '   ',
    }, {
      messages: [{ role: 'user', content: 'ping' }],
      systemPrompt: 'test',
      sessionId: 'settings-test',
      noTools: true,
    })).toThrow("Agent API config invalid: selected config 'MiniMax Global' is missing API key.");

    expect(mockInvokeRustAPIStream).not.toHaveBeenCalled();
  });

  it('normalizes openai-compatible endpoint previews without duplicate /v1/v1', () => {
    expect(buildEndpointPreview({
      ...minimaxConfig,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1/',
    })).toBe('https://api.example.com/v1/chat/completions');
  });

  it('builds the correct chat completions endpoint when baseUrl omits trailing slash', () => {
    expect(buildEndpointPreview({
      ...minimaxConfig,
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
    })).toBe('https://api.example.com/v1/chat/completions');
  });

  it('passes Authorization-capable diagnostics when apiKey exists', async () => {
    mockInvokeRustAPIStream.mockImplementation(async function* stream() {
      yield { type: 'text_delta', content: 'OK' };
      yield { type: 'api_response_complete', response: {} };
    });

    const result = await testResolvedChatConnection(minimaxConfig, 'settings-api-test');

    expect(result.diagnostics.authorizationHeaderPresent).toBe(true);
    expect(mockInvokeRustAPIStream).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'secret-key',
      apiFormat: 'openai',
      baseUrl: 'https://api.minimaxi.com/v1/',
      noTools: true,
      sessionId: 'settings-api-test',
    }));
  });

  it('uses the normalized resolved config so openai-compatible requests keep a clean bearer token', () => {
    const resolved = resolveAgentConfig({
      id: 'cfg-minimax',
      name: 'MiniMax Global',
      provider: 'minimax',
      apiKey: '  Bearer secret-key \n',
      model: 'MiniMax-M2.7',
      baseUrl: '',
      modelProviderId: 'minimax',
    });

    const request = buildResolvedChatRequest(resolved, {
      messages: [{ role: 'user', content: 'ping' }],
      systemPrompt: 'test',
      sessionId: 'settings-test',
      noTools: true,
    });

    expect(request.params.apiKey).toBe('secret-key');
    expect(request.params.provider).toBe('minimax');
    expect(request.diagnostics.authorizationHeaderPresent).toBe(true);
    expect(request.params.apiFormat).toBe('openai');
    expect(request.params.baseUrl).toBe('https://api.minimaxi.com/v1');
    expect(request.params.providerCapabilities).toMatchObject({
      supportsThinking: false,
      supportsToolCalls: true,
      supportsStreaming: true,
      usesResponsesApi: false,
    });
  });

  it('carries provider capability hints for deepseek requests', () => {
    const request = buildResolvedChatRequest({
      ...minimaxConfig,
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      baseUrl: 'https://api.deepseek.com',
    }, {
      messages: [{ role: 'user', content: 'ping' }],
      systemPrompt: 'test',
      sessionId: 'deepseek-test',
      noTools: true,
    });

    expect(request.params.provider).toBe('deepseek');
    expect(request.params.providerCapabilities).toMatchObject({
      supportsToolCalls: true,
      supportsStreaming: true,
      maxOutputTokens: 8192,
    });
  });

  it('prunes oversized request context before invoking the model', () => {
    const request = buildResolvedChatRequest(minimaxConfig, {
      messages: [
        { role: 'user', content: 'old'.repeat(20) },
        { role: 'assistant', content: 'older'.repeat(20) },
        { role: 'user', content: `__TOOL_RESULT__:tool-1:${'x'.repeat(500)}` },
        { role: 'user', content: 'latest' },
      ],
      systemPrompt: 'system'.repeat(15_000),
      sessionId: 'budgeted-test',
      noTools: true,
      contextBudget: {
        maxChars: 300,
        maxMessages: 3,
        maxToolOutputChars: 60,
      },
    });

    expect(request.diagnostics.contextWasPruned).toBe(true);
    expect(request.diagnostics.droppedContextCount).toBeGreaterThan(0);
    expect(request.params.messages[request.params.messages.length - 1]).toEqual({ role: 'user', content: 'latest' });
    expect(request.params.messages.some((message) => String(message.content).includes('[tool output truncated]'))).toBe(true);
    expect(request.params.systemPrompt).toContain('[system prompt truncated]');
  });

  it('formats provider object errors into clear details instead of [object Object]', async () => {
    mockInvokeRustAPIStream.mockImplementation(async function* stream() {
      throw {
        error: {
          message: 'login fail: missing Authorization header',
          http_code: '401',
        },
        request_id: 'req-123',
      };
    });

    await expect(testResolvedChatConnection(minimaxConfig, 'settings-api-test')).rejects.toMatchObject({
      message: 'login fail: missing Authorization header',
      httpCode: '401',
      requestId: 'req-123',
    });

    const diagnostics = getResolvedChatDiagnostics(minimaxConfig);
    const detailText = buildConnectionFailureDetails(diagnostics, {
      error: { message: 'login fail: missing Authorization header', http_code: '401' },
      request_id: 'req-123',
    });

    expect(detailText).toContain('HTTP: 401');
    expect(detailText).toContain('Request ID: req-123');
    expect(detailText).toContain('Reason: login fail: missing Authorization header');
    expect(detailText).not.toContain('[object Object]');
  });
});
