const mockSafeInvoke = jest.fn();
const mockCallCompactLLM = jest.fn();
const mockEstimateMessagesTokens = jest.fn();
const mockEstimateMessageTokens = jest.fn();

jest.mock('@/utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
}));

jest.mock('@/services/api/compactLLM', () => ({
  callCompactLLM: (...args: unknown[]) => mockCallCompactLLM(...args),
}));

jest.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@/services/tokens/tokenEstimator', () => ({
  estimateMessagesTokens: (...args: unknown[]) => mockEstimateMessagesTokens(...args),
  estimateMessageTokens: (...args: unknown[]) => mockEstimateMessageTokens(...args),
}));

function createMessages(contents: string[]) {
  return contents.map((content, index) => ({
    id: `msg-${index + 1}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content,
    timestamp: index + 1,
  }));
}

describe('compactConversation attachments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const storage = new Map<string, string>();
    Object.defineProperty(global, 'localStorage', {
      configurable: true,
      value: {
        getItem: jest.fn((key: string) => storage.get(key) ?? null),
        setItem: jest.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: jest.fn((key: string) => {
          storage.delete(key);
        }),
      },
    });

    mockCallCompactLLM.mockResolvedValue('Summary text');
    mockEstimateMessagesTokens.mockResolvedValue(120);
    mockEstimateMessageTokens.mockReturnValue(20);
    mockSafeInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case 'delete_messages_by_ids':
        case 'save_compact_boundary':
          return undefined;
        case 'get_session_memory':
          return null;
        case 'path_exists':
          return args?.path === 'src/index.ts';
        case 'read_file':
          return {
            path: args?.path,
            content: `content for ${String(args?.path ?? '')}`,
          };
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });
  });

  it('keeps compactConversation successful when optional attachment reads fail', async () => {
    mockSafeInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case 'delete_messages_by_ids':
        case 'save_compact_boundary':
          return undefined;
        case 'get_session_memory':
        case 'read_file':
          throw new Error('tauri command unavailable');
        case 'path_exists':
          return true;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    const { compactConversation } = await import('../compact');
    const result = await compactConversation(
      'session-1',
      createMessages([
        'Read "src/index.ts" and summarize it.',
        'Done.',
        'Look at "src/app.tsx" next.',
        'Okay.',
        'Need one more change in "src/main.ts".',
        'Will do.',
      ]),
      { workDir: '/tmp/workdir' },
    );

    expect(result.success).toBe(true);
    expect(result.attachments).toEqual([]);
    expect(mockCallCompactLLM).toHaveBeenCalled();
  });

  it('only attaches existing project files instead of external or build paths', async () => {
    const { compactConversation } = await import('../compact');
    const result = await compactConversation(
      'session-2',
      createMessages([
        'Read "src/index.ts" and compare it to https://example.com/src/index.ts',
        'Done.',
        'Ignore "/usr/local/include/system.ts" and "node_modules/pkg/index.js".',
        'Okay.',
        'We also mentioned "dist/output.js" and "build/script.ts".',
        'Understood.',
      ]),
      { workDir: '/tmp/workdir' },
    );

    expect(result.success).toBe(true);
    expect(result.attachments).toEqual([
      expect.objectContaining({
        type: 'file',
        file_path: 'src/index.ts',
      }),
    ]);
    expect(mockSafeInvoke).not.toHaveBeenCalledWith(
      'path_exists',
      expect.objectContaining({ path: 'node_modules/pkg/index.js' }),
      expect.anything(),
    );
    expect(mockSafeInvoke).not.toHaveBeenCalledWith(
      'path_exists',
      expect.objectContaining({ path: 'dist/output.js' }),
      expect.anything(),
    );
  });
});
