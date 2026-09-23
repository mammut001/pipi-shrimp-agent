import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@/store/mcpStore', () => ({
  useMCPStore: {
    getState: () => ({
      runtimes: [{ id: 'runtime-1', name: 'server' }],
    }),
  },
}));

import {
  executeFrontendOnlyBatch,
  executeFrontendOnlyTool,
  executeMCPTool,
} from '@/services/streamingToolExecutorFrontend';

describe('streamingToolExecutorFrontend', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('executeMCPTool', () => {
    it('returns tool_not_found for invalid MCP names', async () => {
      const result = await executeMCPTool(
        { id: 't1', name: 'not-an-mcp-tool', arguments: {} },
        Date.now(),
        5_000,
      );
      expect(result.is_error).toBe(true);
      expect(result.error_message).toContain('Invalid MCP tool name');
      const body = JSON.parse(result.content);
      expect(body.error_kind).toBe('tool_not_found');
    });

    it('returns transient_failure when MCP server is not connected', async () => {
      const result = await executeMCPTool(
        { id: 't2', name: 'mcp__missing__tool', arguments: {} },
        Date.now(),
        5_000,
      );
      expect(result.is_error).toBe(true);
      expect(result.error_message).toContain("MCP server 'missing' is not connected");
    });

    it('maps mcp_call_tool content blocks on success', async () => {
      mockInvoke.mockResolvedValue({
        content: [{ type: 'text', text: 'ok-from-mcp' }],
        is_error: false,
      });
      const result = await executeMCPTool(
        { id: 't3', name: 'mcp__server__echo', arguments: { q: 1 } },
        Date.now(),
        5_000,
        'sess-1',
        'chat',
      );
      expect(result.is_error).toBe(false);
      expect(result.content).toBe('ok-from-mcp');
      expect(mockInvoke).toHaveBeenCalledWith(
        'mcp_call_tool',
        expect.objectContaining({
          serverId: 'runtime-1',
          toolName: 'echo',
          mcpToolName: 'mcp__server__echo',
          toolCallId: 't3',
          sessionId: 'sess-1',
        }),
      );
    });
  });

  describe('executeFrontendOnlyTool', () => {
    it('errors for unsupported non-MCP frontend tools', async () => {
      const result = await executeFrontendOnlyTool(
        { id: 'u1', name: 'mystery_frontend', arguments: {} },
        5_000,
      );
      expect(result.is_error).toBe(true);
      expect(result.error_message).toContain('unsupported tool');
    });
  });

  describe('executeFrontendOnlyBatch', () => {
    it('finalizes MCP results and reports progress', async () => {
      mockInvoke.mockResolvedValue({
        content: [{ type: 'text', text: 'batch-ok' }],
        is_error: false,
      });
      const progress: string[] = [];
      const { results, errors } = await executeFrontendOnlyBatch(
        [{ id: 'b1', name: 'mcp__server__echo', arguments: {} }],
        (name) => progress.push(name),
        5_000,
      );
      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('batch-ok');
      expect(progress).toEqual(['mcp__server__echo']);
    });
  });
});
