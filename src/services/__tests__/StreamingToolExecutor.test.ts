const mockInvoke = jest.fn();
const mockRunSshExec = jest.fn();
const mockRunSshReadFile = jest.fn();
const mockRunSshUpload = jest.fn();
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
    getState: () => ({ runtimes: [] }),
  },
}));

jest.mock('@/tools/impl/SshTool', () => ({
  runSshExec: (...args: unknown[]) => mockRunSshExec(...args),
  runSshReadFile: (...args: unknown[]) => mockRunSshReadFile(...args),
  runSshUpload: (...args: unknown[]) => mockRunSshUpload(...args),
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

  it('delegates native tools to execute_tool_batch while keeping ssh tools local and preserving order', async () => {
    mockInvoke.mockResolvedValue([
      { id: 'native-1', content: 'native-ok', is_error: false },
      { id: 'native-2', content: '{"paper":"ok"}', is_error: false },
    ]);
    mockRunSshReadFile.mockResolvedValue({ remotePath: '/tmp/x', content: 'ssh-ok' });

    const executor = new StreamingToolExecutor({ timeoutMs: 5000 });
    const result = await executor.executeBatch([
      { id: 'ssh-1', name: 'ssh_read_file', arguments: { remotePath: '/tmp/x' } },
      { id: 'native-1', name: 'read_file', arguments: { path: '/tmp/a' } },
      { id: 'native-2', name: 'paper_extract_meta', arguments: { text: 'paper body' } },
    ], {
      sessionId: 'session-1',
      workDir: '/tmp/workdir',
    });

    expect(mockRunSshReadFile).toHaveBeenCalledWith({ remotePath: '/tmp/x' });
    expect(mockInvoke).toHaveBeenCalledWith('execute_tool_batch', expect.objectContaining({
      sessionId: 'session-1',
      toolCalls: [
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
    expect(result.results[0]).toMatchObject({
      content: JSON.stringify({ remotePath: '/tmp/x', content: 'ssh-ok' }),
      is_error: false,
    });
    expect(result.results[1]).toMatchObject({ content: 'native-ok', is_error: false });
    expect(result.results[2]).toMatchObject({ content: '{"paper":"ok"}', is_error: false });
  });

  it('blocks disallowed frontend-only tools before execution and sanitizes native output', async () => {
    mockInvoke.mockResolvedValue([
      {
        id: 'native-1',
        name: 'read_file',
        content: 'Authorization: Bearer sk-secret-token',
        is_error: false,
      },
    ]);

    const executor = new StreamingToolExecutor({ timeoutMs: 5000 });
    const result = await executor.executeBatch([
      { id: 'ssh-1', name: 'ssh_read_file', arguments: { remotePath: '/tmp/x' } },
      { id: 'native-1', name: 'read_file', arguments: { path: '/tmp/a' } },
    ], {
      sessionId: 'session-2',
      workDir: '/tmp/workdir',
      allowedTools: ['read_file'],
    });

    expect(mockRunSshReadFile).not.toHaveBeenCalled();
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
