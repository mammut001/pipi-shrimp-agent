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
        {
          id: 'event-2',
          kind: 'snapshot_cache_miss',
          title: 'Snapshot cache miss',
          detail: 'https://example.com/next',
          cacheKey: 'target-1:nav-43:mini:dom-2',
          cacheUrl: 'https://example.com/next',
          level: 'info',
          occurredAt: Date.now() - 980,
          source: 'backend',
        },
        {
          id: 'event-3',
          kind: 'snapshot_cache_store',
          title: 'Snapshot cache stored',
          detail: 'https://example.com/next',
          cacheKey: 'target-1:nav-43:mini:dom-2',
          cacheUrl: 'https://example.com/next',
          level: 'success',
          occurredAt: Date.now() - 960,
          source: 'backend',
        },
        {
          id: 'event-4',
          kind: 'snapshot_cache_hit',
          title: 'Snapshot cache hit',
          detail: 'https://example.com/next',
          cacheKey: 'target-1:nav-43:mini:dom-2',
          cacheUrl: 'https://example.com/next',
          level: 'success',
          occurredAt: Date.now() - 930,
          source: 'backend',
        },
        {
          id: 'event-5',
          kind: 'snapshot_cache_miss',
          title: 'Snapshot cache miss',
          detail: 'https://example.com/dashboard',
          cacheKey: 'target-1:nav-42:mini:dom-1',
          cacheUrl: 'https://example.com/dashboard',
          level: 'info',
          occurredAt: Date.now() - 950,
          source: 'backend',
        },
        {
          id: 'event-6',
          kind: 'snapshot_cache_store',
          title: 'Snapshot cache stored',
          detail: 'https://example.com/dashboard',
          cacheKey: 'target-1:nav-42:mini:dom-1',
          cacheUrl: 'https://example.com/dashboard',
          level: 'success',
          occurredAt: Date.now() - 925,
          source: 'backend',
        },
        {
          id: 'event-7',
          kind: 'snapshot_cache_hit',
          title: 'Snapshot cache hit',
          detail: 'https://example.com/dashboard',
          cacheKey: 'target-1:nav-42:mini:dom-1',
          cacheUrl: 'https://example.com/dashboard',
          level: 'success',
          occurredAt: Date.now() - 900,
          source: 'backend',
        },
        {
          id: 'event-8',
          kind: 'snapshot_cache_invalidate',
          title: 'Snapshot cache invalidated',
          detail: 'frameNavigated | https://example.com/dashboard',
          cacheKey: 'target-1:nav-42:mini:dom-1',
          cacheUrl: 'https://example.com/dashboard',
          cacheReason: 'cdp_frame_navigated',
          level: 'warning',
          occurredAt: Date.now() - 800,
          source: 'backend',
        },
        {
          id: 'event-9',
          kind: 'snapshot_cache_store',
          title: 'Snapshot cache stored',
          detail: 'https://example.com/previous',
          cacheKey: 'target-1:nav-41:mini:dom-old',
          cacheUrl: 'https://example.com/previous',
          level: 'success',
          occurredAt: Date.now() - 1_400,
          source: 'backend',
        },
        {
          id: 'event-10',
          kind: 'snapshot_cache_evict',
          title: 'Snapshot cache evicted',
          detail: 'target-1:nav-41:mini:dom-old | https://example.com/previous',
          cacheKey: 'target-1:nav-41:mini:dom-old',
          cacheUrl: 'https://example.com/previous',
          level: 'warning',
          occurredAt: Date.now() - 700,
          source: 'backend',
        },
        {
          id: 'event-11',
          kind: 'snapshot_cache_store',
          title: 'Snapshot cache stored',
          detail: 'https://example.com/next',
          cacheKey: 'target-1:nav-43:mini:dom-legacy',
          cacheUrl: 'https://example.com/next',
          level: 'success',
          occurredAt: Date.now() - 850,
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
        id: 'snapshot-2',
        cacheKey: 'target-1:nav-43:mini:dom-2',
        url: 'https://example.com/next',
        title: 'Next Page',
        viewport: {
          page_x: 0,
          page_y: 96,
          width: 1280,
          height: 720,
        },
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
            index: 1,
            backendNodeId: 101,
            bounds: {
              x: 24,
              y: 128,
              width: 140,
              height: 42,
            },
            selector: 'button[data-action="sync"]',
            status: 'visible clickable',
          },
        ],
        screenshot: {
          kind: 'base64_png',
          value: 'ZmFrZS1pbWFnZQ==',
        },
        createdAt: Date.now() - 1_500,
        navigationId: 'nav-43',
        domVersion: 'dom-2',
        viewportSignature: 'mini',
        source: 'backend',
      },
      snapshotCache: {
        activeKey: 'target-1:nav-43:mini:dom-2',
        entries: [
          {
            key: 'target-1:nav-43:mini:dom-2',
            url: 'https://example.com/next',
            snapshotId: 'snapshot-2',
            createdAt: Date.now() - 1_500,
            lastAccessedAt: Date.now() - 930,
            accessCount: 3,
            source: 'backend',
          },
          {
            key: 'target-1:nav-42:mini:dom-1',
            url: 'https://example.com/dashboard',
            snapshotId: 'snapshot-1',
            createdAt: Date.now() - 2_500,
            lastAccessedAt: Date.now() - 900,
            accessCount: 2,
            invalidatedAt: Date.now() - 800,
            invalidationReason: 'cdp_frame_navigated',
            source: 'backend',
          },
          {
            key: 'target-1:nav-43:mini:dom-legacy',
            url: 'https://example.com/next',
            snapshotId: 'snapshot-legacy',
            createdAt: Date.now() - 2_200,
            lastAccessedAt: Date.now() - 850,
            accessCount: 1,
            source: 'backend',
          },
        ],
        hitCount: 2,
        missCount: 2,
        evictionCount: 1,
        invalidationCount: 1,
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
    expect(markup).toContain('Recent Lifecycle');
    expect(markup).toContain('Grouped by cache key');
    expect(markup).toContain('entry nav-42 · invalidate · dom-1');
    expect(markup).toContain('entry nav-41 · evict · dom-old');
    expect(markup).toContain('cache url https://example.com/previous');
    expect(markup).toContain('Active');
    expect(markup).toContain('current');
    expect(markup).toContain('Invalidated');
    expect(markup).toContain('frame-nav');
    expect(markup).toContain('Evicted');
    expect(markup).toContain('terminal');
    expect(markup).toContain('Entry no longer present in cache.');
    expect(markup).toContain('target-1:nav-42:mini:dom-1');
    expect(markup).toContain('target-1:nav-43:mini:dom-2');
    expect(markup).toContain('target-1:nav-43:mini:dom-legacy');
    expect(markup).toContain('Entry Nav');
    expect(markup).toContain('Latest PageState');
    expect(markup).toContain('nav-42');
    expect(markup).toContain('nav-43');
    expect(markup).toContain('Screenshot Preview');
    expect(markup).toContain('Viewport 1280x720');
    expect(markup).toContain('Highlighted 1 interactive elements with captured bounds.');
    expect(markup).toContain('PageState screenshot for Next Page');
    expect(markup).toContain('#1 · backend_node_id 101');
    expect(markup).toContain('Next Page · nav-43');
    expect(markup).toContain('current-entry');
    expect(markup).toContain('Current PageState is derived from this cache entry.');
    expect(markup).toContain('same-nav');
    expect(markup).toContain('Current PageState shares nav-43 but uses a different cache entry.');
    expect(markup).toContain('newer-nav');
    expect(markup).toContain('Current PageState advanced to nav-43.');
    expect(markup).toContain('miss');
    expect(markup).toContain('store');
    expect(markup).toContain('hit');
    expect(markup).toContain('invalidate: frameNavigated');
    expect(markup).toContain('Latest evict');
    expect(markup).toContain('Access Count');
    expect(markup).toContain('Last Access');
    expect(markup).toContain('Captured');
    expect(markup).toContain('get_page_state');
    expect(markup).toContain('action: click');
    expect(markup).toContain('Idle Timeout');
    expect(markup).toContain('Next Page');
    expect(markup).toContain('Sync Now');
    expect(markup).toContain('Save Report');
    expect(markup).toContain('Copy Markdown');
  });

  it('renders compact snapshot-cache key labels with raw-key tooltips and normalized entry invalidation labels', () => {
    const markup = renderToStaticMarkup(createElement(BrowserDebugPanel));

    expect(markup).toMatch(/cache key <span[^>]*title="target-1:nav-42:mini:dom-1"[^>]*>target-1 · nav-42 · mini · dom-1<\/span>/);
    expect(markup).toContain('title="target-1:nav-42:mini:dom-1"');
    expect(markup).toContain('title="target-1:nav-43:mini:dom-2"');
    expect(markup).toContain('title="target-1:nav-43:mini:dom-legacy"');
    expect(markup).toContain('target-1 · nav-43 · mini · dom-2');
    expect(markup).toContain('target-1 · nav-43 · mini · dom-legacy');
    expect(markup).toContain('target-1 · nav-43 · mini · dom-2 (active)');
    expect(markup).toContain('invalidated');
    expect(markup).toContain('frame-nav');
    expect(markup).not.toContain('cdp_frame_navigated');
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
        activeKey: null,
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
    expect(markup).toContain('No cache lifecycle events yet.');
    expect(markup).toContain('Cache is empty.');
  });
});