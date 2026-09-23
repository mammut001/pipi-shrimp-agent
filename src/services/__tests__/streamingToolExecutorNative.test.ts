import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn();
const mockResolveActiveAgentConfig = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: () => mockResolveActiveAgentConfig(),
}));

jest.mock('@/services/tools/autoresearchBootstrap', () => ({
  AUTORESEARCH_BOOTSTRAP_TOOL_NAMES: ['pdf_read', 'paper_extract_meta'],
}));

jest.mock('@/services/tools/toolExecutionPolicy', () => {
  const actual = jest.requireActual('@/services/tools/toolExecutionPolicy') as Record<string, unknown>;
  return {
    ...actual,
    isLegacyChatOnlyTool: (name: string) => name === 'legacy_chat_tool',
  };
});

import {
  executeLegacyChatTool,
  executeNativeBatch,
  getBootstrapProviderContext,
  mapNativeBatchRawResult,
} from '@/services/streamingToolExecutorNative';

describe('streamingToolExecutorNative', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveActiveAgentConfig.mockReturnValue({
      id: 'cfg',
      provider: 'openai',
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://example.test',
      apiFormat: 'openai',
    });
  });

  describe('getBootstrapProviderContext', () => {
    it('returns nulls when no active config', () => {
      mockResolveActiveAgentConfig.mockReturnValue(null);
      expect(getBootstrapProviderContext()).toEqual({
        activeConfig: null,
        provider: null,
        providerCapabilities: null,
      });
    });

    it('resolves provider hint + capabilities from active config', () => {
      const ctx = getBootstrapProviderContext();
      expect(ctx.activeConfig?.model).toBe('m');
      expect(ctx.provider).toBeTruthy();
      expect(ctx.providerCapabilities).toBeTruthy();
    });
  });

  describe('mapNativeBatchRawResult', () => {
    it('maps string content and status fields', () => {
      const mapped = mapNativeBatchRawResult({
        id: 'r1',
        name: 'read_file',
        content: 'hello',
        is_error: false,
        status: 'success',
        terminal_status: 'success',
        error_code: null,
      }, 42);
      expect(mapped).toMatchObject({
        id: 'r1',
        content: 'hello',
        is_error: false,
        status: 'success',
        terminal_status: 'success',
        execution_time_ms: 42,
      });
    });

    it('stringifies non-string content and flags errors', () => {
      const mapped = mapNativeBatchRawResult({
        id: 'r2',
        name: 'x',
        content: { nested: true },
        is_error: true,
      }, 7);
      expect(mapped.is_error).toBe(true);
      expect(mapped.content).toContain('"nested":true');
      expect(mapped.error_message).toContain('"nested":true');
    });
  });

  describe('executeLegacyChatTool', () => {
    it('marks Error: prefix as is_error', async () => {
      mockInvoke.mockResolvedValue('Error: boom');
      const result = await executeLegacyChatTool(
        { id: 'l1', name: 'legacy_chat_tool', arguments: { a: 1 } },
        'sess',
        '/tmp',
        'chat',
        undefined,
        Date.now() - 5,
      );
      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Error: boom');
      expect(mockInvoke).toHaveBeenCalledWith(
        'execute_tool',
        expect.objectContaining({ toolName: 'legacy_chat_tool', sessionId: 'sess' }),
      );
    });
  });

  describe('executeNativeBatch', () => {
    it('returns empty for empty input', async () => {
      await expect(executeNativeBatch([], 's', () => {}, 1000)).resolves.toEqual({
        results: [],
        errors: [],
      });
    });

    it('routes registry tools through execute_tool_batch and preserves order', async () => {
      mockInvoke.mockResolvedValue([
        { id: 'a', name: 'read_file', content: 'A', is_error: false },
        { id: 'b', name: 'write_file', content: 'B', is_error: false },
      ]);
      const progress: string[] = [];
      const { results, errors } = await executeNativeBatch(
        [
          { id: 'a', name: 'read_file', arguments: {} },
          { id: 'b', name: 'write_file', arguments: {} },
        ],
        'sess',
        (n) => progress.push(n),
        30_000,
      );
      expect(errors).toHaveLength(0);
      expect(results.map((r) => r.id)).toEqual(['a', 'b']);
      expect(results.map((r) => r.content)).toEqual(['A', 'B']);
      expect(progress).toEqual(['read_file', 'write_file']);
      expect(mockInvoke).toHaveBeenCalledWith(
        'execute_tool_batch',
        expect.objectContaining({ sessionId: 'sess' }),
      );
    });

    it('injects bootstrap provider context for autoresearch tools', async () => {
      mockInvoke.mockResolvedValue([
        { id: 'p1', name: 'pdf_read', content: '{}', is_error: false },
      ]);
      await executeNativeBatch(
        [{ id: 'p1', name: 'pdf_read', arguments: { path: '/x.pdf' } }],
        'sess',
        () => {},
        30_000,
      );
      const call = mockInvoke.mock.calls.find((c) => c[0] === 'execute_tool_batch');
      expect(call).toBeTruthy();
      const payload = call![1] as { toolCalls: Array<{ apiKey?: string; model?: string }> };
      expect(payload.toolCalls[0].apiKey).toBe('k');
      expect(payload.toolCalls[0].model).toBe('m');
    });
  });
});
