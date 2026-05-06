const mockStartSession = jest.fn();
const mockSelectSession = jest.fn();
const mockSetCurrentView = jest.fn();
const mockShowNewChatProjectPicker = jest.fn();
const storage = new Map<string, string>();

jest.mock('@/store', () => ({
  useChatStore: {
    getState: () => ({
      startSession: mockStartSession,
      selectSession: mockSelectSession,
    }),
  },
  useUIStore: {
    getState: () => ({
      setCurrentView: mockSetCurrentView,
      showNewChatProjectPicker: mockShowNewChatProjectPicker,
    }),
  },
}));

describe('startNewChatFlow', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    storage.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
        clear: () => storage.clear(),
      },
      configurable: true,
    });
    mockStartSession.mockResolvedValue('session-1');
  });

  it('shows the project picker by default and creates a project-scoped chat', async () => {
    mockShowNewChatProjectPicker.mockResolvedValue('project-1');
    const { startNewChatFlow } = await import('../newChatFlow');

    await expect(startNewChatFlow('sidebar')).resolves.toBe('session-1');

    expect(mockSetCurrentView).toHaveBeenCalledWith('chat');
    expect(mockShowNewChatProjectPicker).toHaveBeenCalledWith('sidebar');
    expect(mockStartSession).toHaveBeenCalledWith('project-1');
    expect(mockSelectSession).toHaveBeenCalledWith('session-1');
  });

  it('creates a no-project chat only when the user explicitly chooses no project', async () => {
    mockShowNewChatProjectPicker.mockResolvedValue(null);
    const { startNewChatFlow } = await import('../newChatFlow');

    await startNewChatFlow('chat-input');

    expect(mockShowNewChatProjectPicker).toHaveBeenCalledWith('chat-input');
    expect(mockStartSession).toHaveBeenCalledWith(null);
  });

  it('does not create a chat when the picker is cancelled', async () => {
    mockShowNewChatProjectPicker.mockResolvedValue(undefined);
    const { startNewChatFlow } = await import('../newChatFlow');

    await expect(startNewChatFlow('sidebar')).resolves.toBeNull();

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockSelectSession).not.toHaveBeenCalled();
  });

  it('respects the skip-project-picker setting when enabled', async () => {
    localStorage.setItem('ai-agent-skip-project-picker', 'true');
    const { startNewChatFlow } = await import('../newChatFlow');

    await startNewChatFlow('keyboard-shortcut');

    expect(mockShowNewChatProjectPicker).not.toHaveBeenCalled();
    expect(mockStartSession).toHaveBeenCalledWith(null);
  });
});
