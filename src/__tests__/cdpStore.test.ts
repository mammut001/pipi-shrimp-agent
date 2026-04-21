jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

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

const invokeMock = invoke as jest.MockedFunction<typeof invoke>;

let useCdpStore: typeof import('@/store/cdpStore').useCdpStore;
let useBrowserObservabilityStore: typeof import('@/store/browserObservabilityStore').useBrowserObservabilityStore;

describe('cdpStore', () => {
  beforeAll(async () => {
    ({ useCdpStore } = await import('@/store/cdpStore'));
    ({ useBrowserObservabilityStore } = await import('@/store/browserObservabilityStore'));
  });

  beforeEach(() => {
    localStorageMock.data = {};
    invokeMock.mockReset();

    useBrowserObservabilityStore.setState({
      debugPanelEnabled: true,
      wiringReady: false,
      isUsingMockData: false,
      session: {
        connected: false,
        mode: 'unknown',
        wsStatus: 'disconnected',
        currentTarget: 'No target',
        lastHealthPingAt: null,
        sessionId: null,
        targetId: null,
        websocketUrl: null,
        currentUrl: null,
        lastError: null,
        source: 'derived',
      },
      timeline: [],
      recentCommands: [],
      recentActions: [],
      latestPageState: null,
      benchmarkReport: null,
      snapshotCache: {
        entries: [],
        hitCount: 0,
        missCount: 0,
        evictionCount: 0,
        invalidationCount: 0,
      },
    });

    useCdpStore.setState({
      status: 'disconnected',
      errorMessage: null,
      connectionState: null,
      attachFailureReason: null,
      lastSyncedAt: null,
    });
  });

  it('surfaces launch mode after launch_chrome_debug succeeds', async () => {
    const now = Date.now();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'launch_chrome_debug') {
        return 'Chrome 已启动并接管浏览器（模式: launch）';
      }

      if (command === 'get_browser_connection_state') {
        return {
          connected: true,
          launch_mode: 'launch',
          health_status: 'healthy',
          health_failures: 0,
          health_last_transition_at_ms: now,
          websocket_url: 'ws://127.0.0.1:9222/devtools/browser/test',
          current_url: 'https://example.com/dashboard',
          last_error: null,
          target_id: 'target-1',
          session_id: 'session-1',
          last_activity_at_ms: now,
          idle_timeout_ms: 300_000,
        };
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    await expect(useCdpStore.getState().launchChromeAndConnect()).resolves.toBe(true);

    const state = useCdpStore.getState();
    expect(state.status).toBe('connected');
    expect(state.connectionState?.launch_mode).toBe('launch');
    expect(state.connectionState?.current_url).toBe('https://example.com/dashboard');

    const commandTrace = useBrowserObservabilityStore.getState().recentCommands[0];
    expect(commandTrace?.method).toBe('launch_chrome_debug');
    expect(commandTrace?.status).toBe('success');
  });

  it('maps CHROME_NEEDS_RESTART errors to a stable attach failure reason', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'launch_chrome_debug') {
        throw new Error('CHROME_NEEDS_RESTART: Chrome 正在运行但未开启调试端口');
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    await expect(useCdpStore.getState().launchChromeAndConnect()).resolves.toBe(false);

    const state = useCdpStore.getState();
    expect(state.status).toBe('error');
    expect(state.attachFailureReason).toBe('chrome_needs_restart');
    expect(state.errorMessage).toContain('Chrome 当前正在运行但未开启调试端口');

    const commandTrace = useBrowserObservabilityStore.getState().recentCommands[0];
    expect(commandTrace?.method).toBe('launch_chrome_debug');
    expect(commandTrace?.status).toBe('error');
  });
});