const localStorageMock = {
  data: {} as Record<string, string>,
  getItem: jest.fn((key: string) => localStorageMock.data[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    localStorageMock.data[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete localStorageMock.data[key];
  }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('uiStore deprecated browser view compatibility', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorageMock.data = {};
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
  });

  it('migrates persisted browser view to chat on initialization', async () => {
    localStorageMock.data['ai-agent-current-view'] = 'browser';

    const { useUIStore } = await import('@/store/uiStore');

    expect(useUIStore.getState().currentView).toBe('chat');
    expect(localStorageMock.data['ai-agent-current-view']).toBe('chat');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('ai-agent-current-view', 'chat');
  });

  it('redirects browser view writes to chat and keeps the chat workspace visible', async () => {
    const { useUIStore } = await import('@/store/uiStore');

    useUIStore.getState().setCurrentView('browser');

    expect(useUIStore.getState().currentView).toBe('chat');
    expect(useUIStore.getState().browserDockMode).toBe('split');
    expect(useUIStore.getState().browserPaneVisible).toBe(true);
    expect(useUIStore.getState().browserSplitFocus).toBe('chat');
    expect(localStorageMock.data['ai-agent-current-view']).toBe('chat');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('ai-agent-current-view', 'chat');
  });
});