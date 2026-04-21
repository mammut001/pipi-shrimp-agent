import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseBrowserObservabilityStore = jest.fn();
const mockUseCdpStore = jest.fn();
const mockUseChatStore = jest.fn();

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

jest.mock('../utils/browserObservabilityClient', () => ({
  exportBrowserBenchmarkReport: jest.fn().mockResolvedValue('# Browser Benchmark Report'),
}));

jest.mock('@/services/browserBenchmarkArtifacts', () => ({
  DOCS_CHANGED_EVENT: 'pipi:docs-changed',
  saveBrowserBenchmarkArtifact: jest.fn(),
}));

jest.mock('@/store/browserObservabilityStore', () => ({
  useBrowserObservabilityStore: (...args: unknown[]) => mockUseBrowserObservabilityStore(...args),
}));

jest.mock('@/store/cdpStore', () => ({
  useCdpStore: (...args: unknown[]) => mockUseCdpStore(...args),
}));

jest.mock('@/store/chatStore', () => ({
  useChatStore: (...args: unknown[]) => mockUseChatStore(...args),
}));

let BrowserDebugPanel: typeof import('@/components/BrowserDebugPanel').BrowserDebugPanel;

describe('BrowserDebugPanel', () => {
  beforeAll(async () => {
    ({ BrowserDebugPanel } = await import('@/components/BrowserDebugPanel'));
  });

  beforeEach(() => {
    localStorageMock.data = {};
    const observabilityState = {
      debugPanelEnabled: true,
      wiringReady: true,
      isUsingMockData: false,
      session: {
        connected: true,
        mode: 'attach',
        wsStatus: 'healthy',
        currentTarget: 'example.com',
        lastHealthPingAt: Date.now() - 2_000,
        sessionId: 'session-1',
        targetId: 'target-1',
        websocketUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
        currentUrl: 'https://example.com/dashboard',
        lastError: null,
        source: 'backend',
      },
      timeline: [
        {
          id: 'event-1',
          kind: 'health_changed',
          title: 'Health: healthy',
          detail: 'ping ok',
          level: 'success',
          occurredAt: Date.now() - 1_000,
          source: 'backend',
        },
      ],
      recentCommands: [
        {
          id: 'command-1',
          method: 'connect_browser',
          summary: 'Attach to existing Chrome debug target',
          status: 'success',
          startedAt: Date.now() - 5_000,
          finishedAt: Date.now() - 4_500,
          durationMs: 500,
          source: 'frontend',
        },
      ],
      recentActions: [
        {
          id: 'action-1',
          name: 'click',
          detail: 'button[data-action="sync"]',
          status: 'completed',
          createdAt: Date.now() - 900,
          source: 'backend',
        },
      ],
      latestPageState: {
        id: 'snapshot-1',
        cacheKey: 'target-1:nav-42:mini:dom-1',
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
        warnings: [
          {
            id: 'warning-1',
            message: 'cross_origin_iframe_partial',
            severity: 'warning',
          },
        ],
        elements: [
          {
            id: 'element-1',
            label: 'Sync Now',
            role: 'button',
            selector: 'button[data-action="sync"]',
            status: 'visible clickable',
          },
        ],
        createdAt: Date.now() - 1_500,
        navigationId: 'nav-42',
        domVersion: 'dom-1',
        viewportSignature: 'mini',
        source: 'backend',
      },
      snapshotCache: {
        entries: [
          {
            key: 'target-1:nav-42:mini:dom-1',
            url: 'https://example.com/dashboard',
            snapshotId: 'snapshot-1',
            createdAt: Date.now() - 1_500,
            lastAccessedAt: Date.now() - 900,
            accessCount: 2,
            source: 'backend',
          },
        ],
        hitCount: 1,
        missCount: 1,
        evictionCount: 0,
        invalidationCount: 0,
      },
      benchmarkReport: {
        generated_at_ms: Date.now() - 2_000,
        total_samples: 2,
        metrics: [
          {
            key: 'page_state',
            label: 'get_page_state',
            sample_count: 1,
            success_count: 1,
            failure_count: 0,
            average_duration_ms: 380,
            max_duration_ms: 380,
            budget_ms: 500,
            over_budget_count: 0,
            attach_samples: 1,
            launch_samples: 0,
          },
        ],
        recent_samples: [
          {
            id: 'sample-1',
            key: 'action.click',
            label: 'action: click',
            kind: 'action',
            launch_mode: 'attach',
            duration_ms: 160,
            success: true,
            recorded_at_ms: Date.now() - 1_200,
            budget_ms: null,
            detail: 'button[data-action="sync"]',
            error: null,
            memory_before_bytes: null,
            memory_after_bytes: null,
          },
        ],
      },
    };

    const cdpState = {
      status: 'connected',
      errorMessage: null,
      connectionState: {
        connected: true,
        launch_mode: 'attach',
        health_status: 'healthy',
        health_failures: 0,
        health_last_transition_at_ms: Date.now() - 3_000,
        websocket_url: 'ws://127.0.0.1:9222/devtools/browser/test',
        current_url: 'https://example.com/dashboard',
        last_error: null,
        target_id: 'target-1',
        session_id: 'session-1',
        last_activity_at_ms: Date.now() - 750,
        idle_timeout_ms: 300_000,
      },
      attachFailureReason: null,
      lastSyncedAt: Date.now() - 500,
      setupConnectionMonitor: jest.fn(() => jest.fn()),
      connect: jest.fn(async () => true),
      disconnect: jest.fn(async () => {}),
      launchChromeAndConnect: jest.fn(async () => true),
      syncConnectionState: jest.fn(async () => null),
    };

    mockUseBrowserObservabilityStore.mockImplementation(() => observabilityState);
    mockUseCdpStore.mockImplementation((selector?: (state: typeof cdpState) => unknown) => {
      if (typeof selector === 'function') {
        return selector(cdpState);
      }
      return cdpState;
    });
    mockUseChatStore.mockImplementation((selector?: (state: {
      currentSessionId: string | null;
      currentSession: () => { id: string; workDir: string } | null;
    }) => unknown) => {
      const chatState = {
        currentSessionId: 'session-1',
        currentSession: () => ({
          id: 'session-1',
          workDir: '/tmp/pipi/session-1',
        }),
      };

      if (typeof selector === 'function') {
        return selector(chatState);
      }

      return chatState;
    });
  });

  it('renders backend timeline, benchmark, and idle metadata', () => {
    const markup = renderToStaticMarkup(createElement(BrowserDebugPanel));

    expect(markup).toContain('Browser Debug');
    expect(markup).toContain('Health: healthy');
    expect(markup).toContain('get_page_state');
    expect(markup).toContain('action: click');
    expect(markup).toContain('Idle Timeout');
    expect(markup).toContain('Dashboard');
    expect(markup).toContain('Sync Now');
    expect(markup).toContain('Save Report');
    expect(markup).toContain('Copy Markdown');
  });

  it('renders empty-state copy when observability buffers are empty', () => {
    mockUseBrowserObservabilityStore.mockImplementation(() => ({
      debugPanelEnabled: true,
      wiringReady: true,
      isUsingMockData: false,
      session: {
        connected: true,
        mode: 'attach',
        wsStatus: 'healthy',
        currentTarget: 'example.com',
        lastHealthPingAt: Date.now() - 2_000,
        sessionId: 'session-1',
        targetId: 'target-1',
        websocketUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
        currentUrl: 'https://example.com/dashboard',
        lastError: null,
        source: 'backend',
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
      clearTimeline: jest.fn(),
    }));

    const markup = renderToStaticMarkup(createElement(BrowserDebugPanel));

    expect(markup).toContain('No events yet.');
    expect(markup).toContain('No command traces yet.');
    expect(markup).toContain('No benchmark samples yet.');
    expect(markup).toContain('No page state snapshot yet.');
    expect(markup).toContain('Cache is empty.');
  });
});