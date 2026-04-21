import { useBrowserObservabilityStore } from '../store/browserObservabilityStore';

const mockLocalStorage = {
  data: {} as Record<string, string>,
  getItem: jest.fn((key: string) => mockLocalStorage.data[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    mockLocalStorage.data[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete mockLocalStorage.data[key];
  }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

describe('browserObservabilityStore', () => {
  beforeEach(() => {
    mockLocalStorage.data = {};
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
  });

  it('seeds mock data for debug rollout scaffolding', () => {
    useBrowserObservabilityStore.getState().seedMockData();

    const state = useBrowserObservabilityStore.getState();
    expect(state.isUsingMockData).toBe(true);
    expect(state.timeline.length).toBeGreaterThan(0);
    expect(state.recentCommands.length).toBeGreaterThan(0);
    expect(state.recentActions.length).toBeGreaterThan(0);
    expect(state.latestPageState?.source).toBe('mock');
  });

  it('tracks snapshot cache misses and hits', () => {
    const store = useBrowserObservabilityStore.getState();

    store.upsertPageState({
      cacheKey: 'target-a:nav-1:mini:dom-a',
      url: 'https://example.com',
      title: 'Example',
      warnings: [],
      elements: [],
      navigationId: 'nav-1',
      domVersion: 'dom-a',
      viewportSignature: 'mini',
      source: 'derived',
    });

    let state = useBrowserObservabilityStore.getState();
    expect(state.snapshotCache.missCount).toBe(1);
    expect(state.snapshotCache.hitCount).toBe(0);
    expect(state.snapshotCache.entries).toHaveLength(1);
    expect(state.snapshotCache.activeKey).toBe('target-a:nav-1:mini:dom-a');

    store.upsertPageState({
      cacheKey: 'target-a:nav-1:mini:dom-a',
      url: 'https://example.com',
      title: 'Example',
      warnings: [],
      elements: [],
      navigationId: 'nav-1',
      domVersion: 'dom-a',
      viewportSignature: 'mini',
      source: 'derived',
    });

    state = useBrowserObservabilityStore.getState();
    expect(state.snapshotCache.missCount).toBe(1);
    expect(state.snapshotCache.hitCount).toBe(1);
    expect(state.snapshotCache.entries).toHaveLength(1);
  });

  it('replaces snapshot cache state from backend observability payloads', () => {
    const store = useBrowserObservabilityStore.getState();

    store.syncSnapshotCache(
      {
        activeKey: 'target-a:nav-1:mini:dom-a',
        entryLimit: 8,
        entries: [
          {
            key: 'target-a:nav-1:mini:dom-a',
            url: 'https://example.com',
            snapshotId: 'page-state:target-a:nav-1:mini:dom-a',
            createdAt: 1,
            lastAccessedAt: 2,
            accessCount: 3,
            source: 'backend',
          },
        ],
        hitCount: 5,
        missCount: 2,
        evictionCount: 1,
        invalidationCount: 1,
      },
      'backend',
    );

    const state = useBrowserObservabilityStore.getState();
    expect(state.snapshotCache.activeKey).toBe('target-a:nav-1:mini:dom-a');
    expect(state.snapshotCache.entryLimit).toBe(8);
    expect(state.snapshotCache.hitCount).toBe(5);
    expect(state.snapshotCache.entries[0]?.source).toBe('backend');
  });

  it('records session connection transitions in the timeline', () => {
    const store = useBrowserObservabilityStore.getState();

    store.syncSession({
      connected: true,
      mode: 'attach',
      wsStatus: 'healthy',
      currentUrl: 'https://example.com',
      targetId: 'target-a',
      sessionId: 'session-a',
      source: 'backend',
    });

    const state = useBrowserObservabilityStore.getState();
    expect(state.session.connected).toBe(true);
    expect(state.session.mode).toBe('attach');
    expect(state.timeline[0]?.kind).toBe('connected');
  });
});