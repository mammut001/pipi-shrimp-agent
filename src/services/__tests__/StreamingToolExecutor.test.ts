import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useSettingsStore } from '@/store';

const mockInvoke = jest.fn();
const mockRunPreToolUseHooks = jest.fn();
const mockResolveActiveAgentConfig = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: () => mockResolveActiveAgentConfig(),
}));

jest.mock('@/store/mcpStore', () => ({
  useMCPStore: {
    getState: () => ({
      runtimes: [{ id: 'runtime-1', name: 'server' }],
    }),
  },
}));

jest.mock('@/services/tools/preToolUseHooks', () => ({
  runPreToolUseHooks: (...args: unknown[]) => mockRunPreToolUseHooks(...args),
}));

jest.mock('@/services/tools/autoresearchBootstrap', () => ({
  AUTORESEARCH_BOOTSTRAP_TOOL_NAMES: ['pdf_read', 'paper_extract_meta', 'baseline_extract', 'arxiv_search'],
}));

import { StreamingToolExecutor } from '@/services/StreamingToolExecutor';

describe('StreamingToolExecutor.executeBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ windowsShellProfile: 'auto' });
    mockRunPreToolUseHooks.mockResolvedValue({ approved: true });
    mockResolveActiveAgentConfig.mockReturnValue({
      id: 'cfg-minimax',
      name: 'MiniMax Global',
      provider: 'minimax',
      apiKey: 'mini-secret',
      model: 'MiniMax-M2.7',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiFormat: 'openai',
      modelProviderId: 'minimax',
    });
  });

  it('routes ssh tools through the native batch executor and preserves order', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'preview_tool_policy') {
        return {
          toolCallId: 'unused',
          toolName: 'unused',
          decision: 'allowed',
        };
      }
      if (command === 'execute_tool_batch') {
        return [
          { id: 'ssh-1', name: 'ssh_read_file', content: '{"content":"ssh-ok"}', is_error: false },
          { id: 'native-1', name: 'read_file', content: 'native-ok', is_error: false },
          { id: 'native-2', name: 'paper_extract_meta', content: '{"paper":"ok"}', is_error: false },
        ];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const executor = new StreamingToolExecutor({ timeoutMs: 5000 });
    const result = await executor.executeBatch([
      { id: 'ssh-1', name: 'ssh_read_file', arguments: { remotePath: '/tmp/x', remoteWorkDir: '/srv/work' } },
      { id: 'native-1', name: 'read_file', arguments: { path: '/tmp/a' } },
      { id: 'native-2', name: 'paper_extract_meta', arguments: { text: 'paper body' } },
    ], {
      sessionId: 'session-1',
      workDir: '/tmp/workdir',
      source: 'assistant_tool_call',
    });

    expect(mockInvoke).toHaveBeenCalledWith('execute_tool_batch', expect.objectContaining({
      sessionId: 'session-1',
      toolCalls: [
        expect.objectContaining({
          id: 'ssh-1',
          name: 'ssh_read_file',
          workDir: '/tmp/workdir',
        }),
        expect.objectContaining({
          id: 'native-1',
          name: 'read_file',
          workDir: '/tmp/workdir',
        }),
        expect.objectContaining({
          id: 'native-2',
          name: 'paper_extract_meta',
          apiKey: 'mini-secret',
          model: 'MiniMax-M2.7',
          provider: 'minimax',
          apiFormat: 'openai',
        }),
      ],
    }));

    expect(result.results.map((item) => item.id)).toEqual(['ssh-1', 'native-1', 'native-2']);
    expect(result.results[0]).toMatchObject({ content: '{"content":"ssh-ok"}', is_error: false });
    expect(result.results[1]).toMatchObject({ content: 'native-ok', is_error: false });
    expect(result.results[2]).toMatchObject({ content: '{"paper":"ok"}', is_error: false });
  });

  it('requires backend-approved confirmation before executing MCP tools', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'preview_tool_policy') {
        return {
          toolCallId: 'tool-1',
          toolName: 'mcp__server__fetch_data',
          decision: 'awaiting_confirmation',
          reason: 'MCP tool execution requires explicit approval.',
          approvalToken: 'approval-1',
        };
      }
      if (command === 'mcp_call_tool') {
        return {
          content: [{ type: 'text', text: 'ok' }],
          is_error: false,
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const requestPermission = jest.fn(async () => true);
    const executor = new StreamingToolExecutor({ timeoutMs: 5000 });
    const result = await executor.executeBatch([
      { id: 'tool-1', name: 'mcp__server__fetch_data', arguments: { query: 'x' } },
    ], {
      sessionId: 'session-1',
      source: 'assistant_tool_call',
      requestPermission,
    });

    expect(requestPermission).toHaveBeenCalledWith({
      id: 'tool-1',
      name: 'mcp__server__fetch_data',
      arguments: '{"query":"x"}',
      reason: 'MCP tool execution requires explicit approval.',
      approvalToken: 'approval-1',
      source: 'assistant_tool_call',
      workDir: undefined,
    });
    expect(mockInvoke).toHaveBeenCalledWith('mcp_call_tool', {
      serverId: 'runtime-1',
      toolName: 'fetch_data',
      args: { query: 'x' },
    });
    expect(result.results[0]).toEqual(expect.objectContaining({
      id: 'tool-1',
      content: 'ok',
      is_error: false,
    }));
  });

  it('forwards approval tokens into native batch execution after confirmation', async () => {
    mockInvoke.mockImplementation(async (command: string, payload?: any) => {
      if (command === 'preview_tool_policy') {
        return {
          toolCallId: 'tool-2',
          toolName: 'execute_command',
          decision: 'awaiting_confirmation',
          reason: 'Assistant tool calls need approval for network or package-install commands.',
          approvalToken: 'approval-2',
        };
      }
      if (command === 'execute_tool_batch') {
        expect(payload.toolCalls[0].approvalToken).toBe('approval-2');
        return [{
          id: 'tool-2',
          name: 'execute_command',
          content: '{"status":"succeeded","stdout":"ok"}',
          is_error: false,
        }];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const requestPermission = jest.fn(async () => true);
    const executor = new StreamingToolExecutor({ timeoutMs: 5000 });
    const result = await executor.executeBatch([
      { id: 'tool-2', name: 'execute_command', arguments: { command: 'curl https://example.com', cwd: '/tmp/workspace' } },
    ], {
      sessionId: 'session-1',
      workDir: '/tmp/workspace',
      source: 'assistant_tool_call',
      requestPermission,
    });

    expect(requestPermission).toHaveBeenCalled();
    expect(result.results[0]).toEqual(expect.objectContaining({
      id: 'tool-2',
      is_error: false,
    }));
  });

  it('injects the active Windows shell profile into execute_command tool calls', async () => {
    useSettingsStore.setState({ windowsShellProfile: 'wsl' });
    mockInvoke.mockImplementation(async (command: string, payload?: any) => {
      if (command === 'preview_tool_policy') {
        return {
          toolCallId: 'tool-shell',
          toolName: 'execute_command',
          decision: 'allowed',
        };
      }
      if (command === 'execute_tool_batch') {
        expect(payload.toolCalls[0].arguments).toContain('"windowsShellProfile":"wsl"');
        return [{
          id: 'tool-shell',
          name: 'execute_command',
          content: '{"status":"succeeded","stdout":"ok"}',
          is_error: false,
        }];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const executor = new StreamingToolExecutor({ timeoutMs: 5000 });
    await executor.executeBatch([
      { id: 'tool-shell', name: 'execute_command', arguments: { command: 'bash scripts/test.sh', cwd: 'C:\\repo' } },
    ], {
      sessionId: 'session-1',
      workDir: 'C:\\repo',
      source: 'assistant_tool_call',
    });
  });

  it('blocks disallowed tools before execution and sanitizes native output', async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'preview_tool_policy') {
        return {
          toolCallId: 'native-1',
          toolName: 'read_file',
          decision: 'allowed',
        };
      }
      if (command === 'execute_tool_batch') {
        return [{
          id: 'native-1',
          name: 'read_file',
          content: 'Authorization: Bearer sk-secret-token',
          is_error: false,
        }];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const executor = new StreamingToolExecutor({ timeoutMs: 5000 });
    const result = await executor.executeBatch([
      { id: 'ssh-1', name: 'ssh_read_file', arguments: { remotePath: '/tmp/x', remoteWorkDir: '/srv/work' } },
      { id: 'native-1', name: 'read_file', arguments: { path: '/tmp/a' } },
    ], {
      sessionId: 'session-2',
      workDir: '/tmp/workdir',
      source: 'assistant_tool_call',
      allowedTools: ['read_file'],
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        id: 'ssh-1',
        is_error: true,
        content: expect.stringContaining('"error_kind":"tool_disabled"'),
      }),
      expect.objectContaining({
        id: 'native-1',
        is_error: false,
        content: 'Authorization: [redacted]',
        sanitized: true,
      }),
    ]);
  });
});
