import { create } from 'zustand';

import type {
  BrowserActionTrace,
  BrowserCommandTrace,
  BrowserDebugEvent,
  BrowserDebugEventLevel,
  BrowserDebugEventKind,
  BrowserDebugSessionInfo,
  BrowserDebugSource,
  BrowserBenchmarkReport,
  BrowserPageStateSnapshot,
  BrowserSnapshotCacheEntry,
  BrowserSnapshotCacheState,
} from '@/types/browserObservability';
import { BROWSER_FEATURE_FLAG_KEYS, isBrowserDebugPanelEnabled } from '@/utils/browserFeatureFlags';

const DEBUG_PANEL_STORAGE_KEY = BROWSER_FEATURE_FLAG_KEYS.debugPanel;
const MAX_TIMELINE_EVENTS = 80;
const MAX_RECENT_COMMANDS = 24;
const MAX_RECENT_ACTIONS = 24;
const MAX_CACHE_ENTRIES = 6;

type SessionPatch = Partial<Omit<BrowserDebugSessionInfo, 'mode' | 'source' | 'currentTarget'>> & {
  mode?: string | null;
  source?: BrowserDebugSource;
  currentTarget?: string | null;
};

type EventInput = Omit<BrowserDebugEvent, 'id' | 'occurredAt' | 'source'> & {
  occurredAt?: number;
  source?: BrowserDebugSource;
};

type CommandStartInput = Pick<BrowserCommandTrace, 'method' | 'summary'> & {
  source?: BrowserDebugSource;
};

type CommandFinishInput = {
  status: 'success' | 'error';
  durationMs?: number;
  error?: string;
  source?: BrowserDebugSource;
};

type ActionInput = Omit<BrowserActionTrace, 'id' | 'createdAt' | 'source'> & {
  createdAt?: number;
  source?: BrowserDebugSource;
};

type PageStateInput = Omit<BrowserPageStateSnapshot, 'id' | 'createdAt' | 'source'> & {
  id?: string;
  createdAt?: number;
  source?: BrowserDebugSource;
};

interface BrowserObservabilityState {
  debugPanelEnabled: boolean;
  wiringReady: boolean;
  isUsingMockData: boolean;
  session: BrowserDebugSessionInfo;
  timeline: BrowserDebugEvent[];
  recentCommands: BrowserCommandTrace[];
  recentActions: BrowserActionTrace[];
  latestPageState: BrowserPageStateSnapshot | null;
  snapshotCache: BrowserSnapshotCacheState;
  benchmarkReport: BrowserBenchmarkReport | null;
  setDebugPanelEnabled: (enabled: boolean) => void;
  markWiringReady: (ready: boolean) => void;
  seedMockData: () => void;
  recordEvent: (input: EventInput) => void;
  startCommand: (input: CommandStartInput) => string;
  finishCommand: (id: string, input: CommandFinishInput) => void;
  recordAction: (input: ActionInput) => void;
  setBenchmarkReport: (report: BrowserBenchmarkReport, source?: BrowserDebugSource) => void;
  syncSnapshotCache: (snapshotCache: BrowserSnapshotCacheState, source?: BrowserDebugSource) => void;
  syncSession: (patch: SessionPatch) => void;
  upsertPageState: (input: PageStateInput) => void;
  invalidateSnapshots: (reason: string, source?: BrowserDebugSource) => void;
  clearTimeline: () => void;
}

const createId = (prefix: string): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return `${prefix}-${randomId}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeMode = (mode?: string | null): BrowserDebugSessionInfo['mode'] => {
  if (mode === 'attach' || mode === 'launch') {
    return mode;
  }
  return 'unknown';
};

const readDebugFlag = (): boolean => {
  return isBrowserDebugPanelEnabled();
};

const writeDebugFlag = (enabled: boolean) => {
  try {
    globalThis.localStorage?.setItem(DEBUG_PANEL_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore localStorage availability issues.
  }
};

const createEmptySession = (source: BrowserDebugSource = 'derived'): BrowserDebugSessionInfo => ({
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
  source,
});

const createEmptySnapshotCache = (): BrowserSnapshotCacheState => ({
  activeKey: null,
  entryLimit: MAX_CACHE_ENTRIES,
  entries: [],
  hitCount: 0,
  missCount: 0,
  evictionCount: 0,
  invalidationCount: 0,
});

const createMockBenchmarkReport = (now: number): BrowserBenchmarkReport => ({
  generated_at_ms: now - 4_000,
  total_samples: 3,
  metrics: [
    {
      key: 'connect.attach',
      label: 'connect (attach)',
      sample_count: 1,
      success_count: 1,
      failure_count: 0,
      average_duration_ms: 420,
      max_duration_ms: 420,
      budget_ms: null,
      over_budget_count: 0,
      attach_samples: 1,
      launch_samples: 0,
    },
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
    {
      key: 'action.click',
      label: 'action: click',
      sample_count: 1,
      success_count: 1,
      failure_count: 0,
      average_duration_ms: 160,
      max_duration_ms: 160,
      budget_ms: null,
      over_budget_count: 0,
      attach_samples: 1,
      launch_samples: 0,
    },
  ],
  recent_samples: [
    {
      id: createId('browser-benchmark'),
      key: 'action.click',
      label: 'action: click',
      kind: 'action',
      launch_mode: 'attach',
      duration_ms: 160,
      success: true,
      recorded_at_ms: now - 6_000,
      detail: 'button[data-action="sync"]',
      error: null,
      budget_ms: null,
      memory_before_bytes: null,
      memory_after_bytes: null,
    },
  ],
});

const trimToSize = <T,>(entries: T[], limit: number): T[] => entries.slice(0, limit);

const appendTimelineEvent = (
  timeline: BrowserDebugEvent[],
  kind: BrowserDebugEventKind,
  title: string,
  level: BrowserDebugEventLevel,
  source: BrowserDebugSource,
  detail?: string,
  occurredAt = Date.now(),
): BrowserDebugEvent[] => {
  const event: BrowserDebugEvent = {
    id: createId('browser-event'),
    kind,
    title,
    detail,
    level,
    occurredAt,
    source,
  };

  return trimToSize([event, ...timeline], MAX_TIMELINE_EVENTS);
};

const deriveTarget = (currentUrl?: string | null, targetId?: string | null): string => {
  if (targetId) {
    return targetId;
  }

  if (!currentUrl) {
    return 'No target';
  }

  try {
    return new URL(currentUrl).hostname.replace(/^www\./, '');
  } catch {
    return currentUrl;
  }
};

const materializeState = (state: BrowserObservabilityState, source: BrowserDebugSource) => {
  if (source === 'mock' || !state.isUsingMockData) {
    return {
      isUsingMockData: state.isUsingMockData,
      session: state.session,
      timeline: state.timeline,
      recentCommands: state.recentCommands,
      recentActions: state.recentActions,
      latestPageState: state.latestPageState,
      snapshotCache: state.snapshotCache,
      benchmarkReport: state.benchmarkReport,
    };
  }

  return {
    isUsingMockData: false,
    session: state.session.source === 'mock' ? createEmptySession(source) : state.session,
    timeline: state.timeline.filter((entry) => entry.source !== 'mock'),
    recentCommands: state.recentCommands.filter((entry) => entry.source !== 'mock'),
    recentActions: state.recentActions.filter((entry) => entry.source !== 'mock'),
    latestPageState: state.latestPageState?.source === 'mock' ? null : state.latestPageState,
    snapshotCache: createEmptySnapshotCache(),
    benchmarkReport: state.benchmarkReport,
  };
};

export const useBrowserObservabilityStore = create<BrowserObservabilityState>((set) => ({
  debugPanelEnabled: readDebugFlag(),
  wiringReady: false,
  isUsingMockData: false,
  session: createEmptySession(),
  timeline: [],
  recentCommands: [],
  recentActions: [],
  latestPageState: null,
  snapshotCache: createEmptySnapshotCache(),
  benchmarkReport: null,

  setDebugPanelEnabled: (enabled) => {
    writeDebugFlag(enabled);
    set({ debugPanelEnabled: enabled });
  },

  markWiringReady: (ready) => {
    set({ wiringReady: ready });
  },

  seedMockData: () => {
    set((state) => {
      if (!state.debugPanelEnabled) {
        return {};
      }

      if (state.timeline.length > 0 || state.recentCommands.length > 0 || state.recentActions.length > 0 || state.latestPageState) {
        return {};
      }

      const now = Date.now();
      const snapshot: BrowserPageStateSnapshot = {
        id: createId('browser-snapshot'),
        cacheKey: 'mock-target:nav-1:mini:dom-a',
        url: 'https://docs.example.test/dashboard',
        title: 'Workspace Dashboard',
        warnings: [
          {
            id: createId('browser-warning'),
            message: 'Mock snapshot seeded until backend event bus is connected.',
            severity: 'warning',
          },
        ],
        elements: [
          { id: 'mock-hero', label: 'Team Overview', role: 'heading', selector: 'main h1' },
          { id: 'mock-search', label: 'Search projects', role: 'textbox', selector: 'input[type="search"]' },
          { id: 'mock-sync', label: 'Sync Now', role: 'button', selector: 'button[data-action="sync"]' },
          { id: 'mock-table', label: 'Latest Runs', role: 'table', selector: 'table[data-test="runs"]' },
        ],
        createdAt: now - 12_000,
        navigationId: 'nav-1',
        domVersion: 'dom-a',
        viewportSignature: 'mini:panel',
        source: 'mock',
      };

      const timeline: BrowserDebugEvent[] = [
        {
          id: createId('browser-event'),
          kind: 'snapshot_cache_miss',
          title: 'Seeded snapshot cache',
          detail: snapshot.cacheKey,
          level: 'info',
          occurredAt: now - 12_000,
          source: 'mock',
        },
        {
          id: createId('browser-event'),
          kind: 'command',
          title: 'Mock connect_browser',
          detail: 'attach-first baseline for debug panel scaffolding',
          level: 'success',
          occurredAt: now - 18_000,
          source: 'mock',
        },
        {
          id: createId('browser-event'),
          kind: 'connected',
          title: 'Mock browser session ready',
          detail: 'Observability UI running in mock mode',
          level: 'success',
          occurredAt: now - 20_000,
          source: 'mock',
        },
      ];

      const recentCommands: BrowserCommandTrace[] = [
        {
          id: createId('browser-command'),
          method: 'connect_browser',
          summary: 'Attach to existing Chrome target',
          status: 'success',
          startedAt: now - 20_500,
          finishedAt: now - 20_000,
          durationMs: 500,
          source: 'mock',
        },
        {
          id: createId('browser-command'),
          method: 'get_page_state',
          summary: 'Generate compact page state snapshot',
          status: 'success',
          startedAt: now - 12_600,
          finishedAt: now - 12_000,
          durationMs: 600,
          source: 'mock',
        },
      ];

      const recentActions: BrowserActionTrace[] = [
        {
          id: createId('browser-action'),
          name: 'wait_for_selector',
          detail: '.workspace-ready',
          status: 'completed',
          createdAt: now - 15_000,
          source: 'mock',
        },
        {
          id: createId('browser-action'),
          name: 'click_element',
          detail: 'button[data-action="sync"]',
          status: 'completed',
          createdAt: now - 13_000,
          source: 'mock',
        },
      ];

      const snapshotCache: BrowserSnapshotCacheState = {
        activeKey: snapshot.cacheKey,
        entryLimit: MAX_CACHE_ENTRIES,
        entries: [
          {
            key: snapshot.cacheKey,
            url: snapshot.url,
            snapshotId: snapshot.id,
            createdAt: snapshot.createdAt,
            lastAccessedAt: now - 11_500,
            accessCount: 2,
            source: 'mock',
          },
          {
            key: 'mock-target:nav-0:mini:dom-z',
            url: 'https://docs.example.test/home',
            snapshotId: createId('browser-snapshot'),
            createdAt: now - 32_000,
            lastAccessedAt: now - 30_000,
            accessCount: 1,
            invalidatedAt: now - 18_500,
            invalidationReason: 'navigation',
            source: 'mock',
          },
        ],
        hitCount: 1,
        missCount: 1,
        evictionCount: 0,
        invalidationCount: 1,
      };
      const benchmarkReport = createMockBenchmarkReport(now);

      return {
        isUsingMockData: true,
        session: {
          connected: true,
          mode: 'attach',
          wsStatus: 'healthy',
          currentTarget: 'docs.example.test',
          lastHealthPingAt: now - 4_000,
          sessionId: 'mock-session-1',
          targetId: 'mock-target',
          websocketUrl: 'ws://127.0.0.1:9222/devtools/browser/mock',
          currentUrl: snapshot.url,
          lastError: null,
          source: 'mock',
        },
        timeline,
        recentCommands,
        recentActions,
        latestPageState: snapshot,
        snapshotCache,
        benchmarkReport,
      };
    });
  },

  recordEvent: (input) => {
    const source = input.source ?? 'derived';
    set((state) => {
      const base = materializeState(state, source);
      return {
        isUsingMockData: base.isUsingMockData,
        session: base.session,
        recentCommands: base.recentCommands,
        recentActions: base.recentActions,
        latestPageState: base.latestPageState,
        snapshotCache: base.snapshotCache,
        benchmarkReport: base.benchmarkReport,
        timeline: appendTimelineEvent(
          base.timeline,
          input.kind,
          input.title,
          input.level,
          source,
          input.detail,
          input.occurredAt,
        ),
      };
    });
  },

  startCommand: (input) => {
    const source = input.source ?? 'frontend';
    const commandId = createId('browser-command');

    set((state) => {
      const base = materializeState(state, source);
      const command: BrowserCommandTrace = {
        id: commandId,
        method: input.method,
        summary: input.summary,
        status: 'pending',
        startedAt: Date.now(),
        source,
      };

      return {
        isUsingMockData: base.isUsingMockData,
        session: base.session,
        latestPageState: base.latestPageState,
        snapshotCache: base.snapshotCache,
        benchmarkReport: base.benchmarkReport,
        recentActions: base.recentActions,
        recentCommands: trimToSize([command, ...base.recentCommands], MAX_RECENT_COMMANDS),
        timeline: appendTimelineEvent(
          base.timeline,
          'command',
          input.method,
          'info',
          source,
          input.summary,
        ),
      };
    });

    return commandId;
  },

  finishCommand: (id, input) => {
    const source = input.source ?? 'frontend';
    set((state) => {
      const base = materializeState(state, source);
      const index = base.recentCommands.findIndex((command) => command.id === id);
      if (index === -1) {
        return {};
      }

      const existing = base.recentCommands[index];
      const finishedAt = Date.now();
      const updatedCommand: BrowserCommandTrace = {
        ...existing,
        status: input.status,
        finishedAt,
        durationMs: input.durationMs ?? finishedAt - existing.startedAt,
        error: input.error,
        source,
      };

      const recentCommands = [...base.recentCommands];
      recentCommands[index] = updatedCommand;

      return {
        isUsingMockData: base.isUsingMockData,
        session: base.session,
        recentActions: base.recentActions,
        latestPageState: base.latestPageState,
        snapshotCache: base.snapshotCache,
        benchmarkReport: base.benchmarkReport,
        recentCommands,
        timeline: appendTimelineEvent(
          base.timeline,
          'command',
          updatedCommand.method,
          updatedCommand.status === 'success' ? 'success' : 'error',
          source,
          updatedCommand.error ?? updatedCommand.summary,
          finishedAt,
        ),
      };
    });
  },

  recordAction: (input) => {
    const source = input.source ?? 'derived';
    set((state) => {
      const base = materializeState(state, source);
      const createdAt = input.createdAt ?? Date.now();
      const action: BrowserActionTrace = {
        id: createId('browser-action'),
        name: input.name,
        detail: input.detail,
        status: input.status,
        createdAt,
        source,
      };

      return {
        isUsingMockData: base.isUsingMockData,
        session: base.session,
        latestPageState: base.latestPageState,
        snapshotCache: base.snapshotCache,
        benchmarkReport: base.benchmarkReport,
        recentCommands: base.recentCommands,
        recentActions: trimToSize([action, ...base.recentActions], MAX_RECENT_ACTIONS),
        timeline: appendTimelineEvent(
          base.timeline,
          'action',
          action.name,
          action.status === 'failed' ? 'error' : action.status === 'completed' ? 'success' : 'info',
          source,
          action.detail,
          createdAt,
        ),
      };
    });
  },

  setBenchmarkReport: (report, source = 'backend') => {
    set((state) => {
      const base = materializeState(state, source);
      return {
        isUsingMockData: base.isUsingMockData,
        session: base.session,
        timeline: base.timeline,
        recentCommands: base.recentCommands,
        recentActions: base.recentActions,
        latestPageState: base.latestPageState,
        snapshotCache: base.snapshotCache,
        benchmarkReport: report,
      };
    });
  },

  syncSnapshotCache: (snapshotCache, source = 'backend') => {
    set((state) => {
      const base = materializeState(state, source);
      return {
        isUsingMockData: base.isUsingMockData,
        session: base.session,
        timeline: base.timeline,
        recentCommands: base.recentCommands,
        recentActions: base.recentActions,
        latestPageState: base.latestPageState,
        snapshotCache: {
          activeKey: snapshotCache.activeKey ?? null,
          entryLimit: snapshotCache.entryLimit ?? MAX_CACHE_ENTRIES,
          entries: snapshotCache.entries,
          hitCount: snapshotCache.hitCount,
          missCount: snapshotCache.missCount,
          evictionCount: snapshotCache.evictionCount,
          invalidationCount: snapshotCache.invalidationCount,
        },
        benchmarkReport: base.benchmarkReport,
      };
    });
  },

  syncSession: (patch) => {
    const source = patch.source ?? 'derived';
    set((state) => {
      const base = materializeState(state, source);
      const now = Date.now();
      const nextSession: BrowserDebugSessionInfo = {
        ...base.session,
        connected: patch.connected ?? base.session.connected,
        mode: normalizeMode(patch.mode ?? base.session.mode),
        wsStatus: patch.wsStatus ?? base.session.wsStatus,
        currentTarget: patch.currentTarget ?? deriveTarget(patch.currentUrl ?? base.session.currentUrl, patch.targetId ?? base.session.targetId),
        lastHealthPingAt: patch.lastHealthPingAt ?? now,
        sessionId: patch.sessionId ?? base.session.sessionId,
        targetId: patch.targetId ?? base.session.targetId,
        websocketUrl: patch.websocketUrl ?? base.session.websocketUrl,
        currentUrl: patch.currentUrl ?? base.session.currentUrl,
        lastError: patch.lastError ?? null,
        source,
      };

      let timeline = base.timeline;
      if (base.session.connected !== nextSession.connected) {
        timeline = appendTimelineEvent(
          timeline,
          nextSession.connected ? 'connected' : 'disconnected',
          nextSession.connected ? 'Browser connected' : 'Browser disconnected',
          nextSession.connected ? 'success' : 'warning',
          source,
          nextSession.currentTarget,
          now,
        );
      } else if (base.session.wsStatus !== nextSession.wsStatus) {
        timeline = appendTimelineEvent(
          timeline,
          'health_changed',
          `Health: ${nextSession.wsStatus}`,
          nextSession.wsStatus === 'failed' ? 'error' : 'info',
          source,
          nextSession.lastError ?? nextSession.currentTarget,
          now,
        );
      }

      return {
        isUsingMockData: base.isUsingMockData,
        session: nextSession,
        timeline,
        recentCommands: base.recentCommands,
        recentActions: base.recentActions,
        latestPageState: base.latestPageState,
        snapshotCache: base.snapshotCache,
        benchmarkReport: base.benchmarkReport,
      };
    });
  },

  upsertPageState: (input) => {
    const source = input.source ?? 'derived';
    set((state) => {
      const base = materializeState(state, source);
      const createdAt = input.createdAt ?? Date.now();
      const snapshot: BrowserPageStateSnapshot = {
        ...input,
        id: input.id ?? createId('browser-snapshot'),
        createdAt,
        source,
      };

      let snapshotCache = base.snapshotCache;
      let timeline = base.timeline;

      if (source === 'backend') {
        timeline = appendTimelineEvent(
          timeline,
          'page_state_updated',
          snapshot.title || 'PageState updated',
          snapshot.warnings.some((warning) => warning.severity === 'error') ? 'warning' : 'success',
          source,
          snapshot.url,
          createdAt,
        );

        return {
          isUsingMockData: base.isUsingMockData,
          session: base.session,
          timeline,
          recentCommands: base.recentCommands,
          recentActions: base.recentActions,
          latestPageState: snapshot,
          snapshotCache,
          benchmarkReport: base.benchmarkReport,
        };
      }

      const existingIndex = snapshotCache.entries.findIndex(
        (entry) => entry.key === snapshot.cacheKey && entry.invalidatedAt == null,
      );

      if (existingIndex >= 0) {
        const entries = [...snapshotCache.entries];
        const existing = entries[existingIndex];
        const updatedEntry: BrowserSnapshotCacheEntry = {
          ...existing,
          snapshotId: snapshot.id,
          lastAccessedAt: createdAt,
          accessCount: existing.accessCount + 1,
          source,
        };
        entries.splice(existingIndex, 1);
        snapshotCache = {
          ...snapshotCache,
          activeKey: snapshot.cacheKey,
          entries: trimToSize([updatedEntry, ...entries], MAX_CACHE_ENTRIES),
          hitCount: snapshotCache.hitCount + 1,
        };
        timeline = appendTimelineEvent(
          timeline,
          'snapshot_cache_hit',
          'Snapshot cache hit',
          'success',
          source,
          snapshot.cacheKey,
          createdAt,
        );
      } else {
        const nextEntry: BrowserSnapshotCacheEntry = {
          key: snapshot.cacheKey,
          url: snapshot.url,
          snapshotId: snapshot.id,
          createdAt,
          lastAccessedAt: createdAt,
          accessCount: 1,
          source,
        };
        const entries = [nextEntry, ...snapshotCache.entries];
        let evictionCount = snapshotCache.evictionCount;
        if (entries.length > MAX_CACHE_ENTRIES) {
          entries.pop();
          evictionCount += 1;
          timeline = appendTimelineEvent(
            timeline,
            'snapshot_cache_evict',
            'Snapshot cache evicted',
            'warning',
            source,
            snapshot.url,
            createdAt,
          );
        }
        snapshotCache = {
          ...snapshotCache,
          activeKey: snapshot.cacheKey,
          entries,
          missCount: snapshotCache.missCount + 1,
          evictionCount,
        };
        timeline = appendTimelineEvent(
          timeline,
          'snapshot_cache_miss',
          'Snapshot cache miss',
          'info',
          source,
          snapshot.cacheKey,
          createdAt,
        );
      }

      timeline = appendTimelineEvent(
        timeline,
        'page_state_updated',
        snapshot.title || 'PageState updated',
        snapshot.warnings.some((warning) => warning.severity === 'error') ? 'warning' : 'success',
        source,
        snapshot.url,
        createdAt,
      );

      return {
        isUsingMockData: base.isUsingMockData,
        session: base.session,
        timeline,
        recentCommands: base.recentCommands,
        recentActions: base.recentActions,
        latestPageState: snapshot,
        snapshotCache,
        benchmarkReport: base.benchmarkReport,
      };
    });
  },

  invalidateSnapshots: (reason, source = 'derived') => {
    set((state) => {
      const base = materializeState(state, source);
      const activeCount = base.snapshotCache.entries.filter((entry) => entry.invalidatedAt == null).length;
      if (activeCount === 0) {
        return {};
      }

      const invalidatedAt = Date.now();
      return {
        isUsingMockData: base.isUsingMockData,
        session: base.session,
        recentCommands: base.recentCommands,
        recentActions: base.recentActions,
        latestPageState: base.latestPageState,
        snapshotCache: {
          ...base.snapshotCache,
          activeKey: null,
          entries: base.snapshotCache.entries.map((entry) =>
            entry.invalidatedAt == null
              ? {
                  ...entry,
                  invalidatedAt,
                  invalidationReason: reason,
                  source,
                }
              : entry,
          ),
          invalidationCount: base.snapshotCache.invalidationCount + 1,
        },
        benchmarkReport: base.benchmarkReport,
        timeline: appendTimelineEvent(
          base.timeline,
          'snapshot_cache_invalidate',
          'Snapshot cache invalidated',
          'warning',
          source,
          reason,
          invalidatedAt,
        ),
      };
    });
  },

  clearTimeline: () => {
    set({ timeline: [] });
  },
}));