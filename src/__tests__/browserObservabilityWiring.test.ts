jest.mock('../utils/browserFeatureFlags', () => ({
  BROWSER_FEATURE_FLAG_KEYS: {
    foundationV2: 'PIPI_BROWSER_FOUNDATION_V2',
    pageStateV2: 'PIPI_BROWSER_PAGE_STATE_V2',
    actionsV2: 'PIPI_BROWSER_ACTIONS_V2',
    debugPanel: 'PIPI_BROWSER_DEBUG_PANEL',
  },
  isBrowserDebugPanelEnabled: jest.fn(() => true),
  isBrowserPageStateV2Enabled: jest.fn(() => true),
}));

jest.mock('../utils/browserPageStateClient', () => ({
  getBrowserPageState: jest.fn(),
}));

jest.mock('../utils/browserObservabilityClient', () => ({
  getBrowserObservabilitySnapshot: jest.fn(),
}));

import type { BrowserConnectionStatePayload } from '@/store/cdpStore';
import type { BrowserPageState } from '@/types/browserPageState';

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

let useBrowserAgentStore: typeof import('@/store/browserAgentStore').useBrowserAgentStore;
let useBrowserObservabilityStore: typeof import('@/store/browserObservabilityStore').useBrowserObservabilityStore;
let setupBrowserObservabilityWiring: typeof import('@/store/browserObservabilityWiring').setupBrowserObservabilityWiring;
let useCdpStore: typeof import('@/store/cdpStore').useCdpStore;
let getBrowserPageStateMock: jest.MockedFunction<typeof import('@/utils/browserPageStateClient').getBrowserPageState>;
let getBrowserObservabilitySnapshotMock: jest.MockedFunction<typeof import('@/utils/browserObservabilityClient').getBrowserObservabilitySnapshot>;

const connectionState: BrowserConnectionStatePayload = {
  connected: true,
  launch_mode: 'attach',
  health_status: 'healthy',
  health_failures: 0,
  health_last_transition_at_ms: Date.now(),
  websocket_url: 'ws://127.0.0.1:9222/devtools/browser/test',
  current_url: 'https://example.com/dashboard',
  last_error: null,
  target_id: 'target-1',
  session_id: 'session-1',
  last_activity_at_ms: Date.now(),
  idle_timeout_ms: 300_000,
};

const pageState: BrowserPageState = {
  url: 'https://example.com/dashboard',
  title: 'Dashboard',
  navigation_id: 'nav-42',
  frame_count: 2,
  warnings: ['cross_origin_iframe_partial'],
  screenshot: null,
  elements: [
    {
      index: 1,
      backend_node_id: 101,
      frame_id: 'root',
      role: 'button',
      name: 'Sync Now',
      tag_name: 'button',
      bounds: null,
      is_visible: true,
      is_clickable: true,
      is_editable: false,
      selector_hint: 'button[data-action="sync"]',
      text_hint: null,
      href: null,
      input_type: null,
    },
  ],
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('browserObservabilityWiring', () => {
  beforeAll(async () => {
    ({ useBrowserAgentStore } = await import('@/store/browserAgentStore'));
    ({ useBrowserObservabilityStore } = await import('@/store/browserObservabilityStore'));
    ({ setupBrowserObservabilityWiring } = await import('@/store/browserObservabilityWiring'));
    ({ useCdpStore } = await import('@/store/cdpStore'));
    ({ getBrowserPageState: getBrowserPageStateMock } = await import('@/utils/browserPageStateClient'));
    ({ getBrowserObservabilitySnapshot: getBrowserObservabilitySnapshotMock } = await import('@/utils/browserObservabilityClient'));
  });

  beforeEach(() => {
    localStorageMock.data = {};
    getBrowserPageStateMock.mockReset();
    getBrowserPageStateMock.mockResolvedValue(pageState);
    getBrowserObservabilitySnapshotMock.mockReset();
    getBrowserObservabilitySnapshotMock.mockResolvedValue({
      recent_events: [
        {
          id: 'backend-event-1',
          sequence: 1,
          kind: 'action_completed',
          title: 'click completed',
          detail: 'button[data-action="sync"]',
          level: 'success',
          occurred_at_ms: Date.now() - 1000,
          action_name: 'click',
          benchmark: null,
        },
      ],
      benchmark_report: {
        generated_at_ms: Date.now(),
        total_samples: 1,
        metrics: [
          {
            key: 'action.click',
            label: 'action: click',
            sample_count: 1,
            success_count: 1,
            failure_count: 0,
            average_duration_ms: 120,
            max_duration_ms: 120,
            budget_ms: null,
            over_budget_count: 0,
            attach_samples: 1,
            launch_samples: 0,
          },
        ],
        recent_samples: [],
      },
      snapshot_cache: {
        active_key: 'target-1:nav-42:mini:dom-backend',
        entry_limit: 8,
        entries: [
          {
            key: 'target-1:nav-42:mini:dom-backend',
            url: 'https://example.com/dashboard',
            snapshot_id: 'page-state:target-1:nav-42:mini:dom-backend',
            created_at_ms: Date.now() - 2_000,
            last_accessed_at_ms: Date.now() - 1_000,
            access_count: 2,
            invalidated_at_ms: null,
            invalidation_reason: null,
          },
        ],
        hit_count: 4,
        miss_count: 1,
        eviction_count: 0,
        invalidation_count: 0,
      },
      last_activity_at_ms: Date.now(),
      idle_timeout_ms: 300_000,
    });

    useBrowserAgentStore.setState({
      status: 'idle',
      isWindowOpen: true,
      currentUrl: 'https://example.com/dashboard',
      error: null,
      mode: 'agent_controlled',
      authState: 'authenticated',
      blockReason: null,
      pendingTask: null,
      inspection: null,
      siteProfileId: null,
      connectorType: 'browser_web',
      waitingForUserResume: false,
      lastCompletedTaskId: null,
      lastTaskResult: null,
      logs: [],
      screenshots: [],
      _abortController: null,
      _screenshotInterval: null,
      _isLivePreviewEnabled: true,
      presentationMode: 'mini',
      handoffState: 'no_handoff',
      _isInspecting: false,
    });

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
        activeKey: null,
        entryLimit: 6,
        entries: [],
        hitCount: 0,
        missCount: 0,
        evictionCount: 0,
        invalidationCount: 0,
      },
    });

    useCdpStore.setState({
      status: 'connected',
      errorMessage: null,
      connectionState,
      attachFailureReason: null,
      lastSyncedAt: Date.now(),
      syncConnectionState: jest.fn(async () => connectionState),
    });
  });

  it('hydrates observability snapshots from backend PageState when CDP is connected', async () => {
    const cleanup = setupBrowserObservabilityWiring();
    await flushPromises();

    const state = useBrowserObservabilityStore.getState();
    expect(state.latestPageState?.source).toBe('backend');
    expect(state.latestPageState?.navigationId).toBe('nav-42');
    expect(state.latestPageState?.elements[0]?.selector).toContain('button[data-action="sync"]');
    expect(state.snapshotCache.activeKey).toBe('target-1:nav-42:mini:dom-backend');
    expect(state.snapshotCache.entries[0]?.key).toBe('target-1:nav-42:mini:dom-backend');
    expect(state.snapshotCache.hitCount).toBe(4);
    expect(state.benchmarkReport?.metrics[0]?.key).toBe('action.click');
    expect(state.recentActions[0]?.name).toBe('click');

    cleanup();
  });
});