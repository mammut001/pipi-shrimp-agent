import { create } from 'zustand';

import type {
  BrowserActionTrace,
  BrowserCommandTrace,
  BrowserDebugEvent,
  BrowserDebugSessionInfo,
  BrowserPageStateSnapshot,
  BrowserSnapshotCacheEntry,
  BrowserSnapshotCacheState,
} from '@/types/browserObservability';
import {
  MAX_RECENT_COMMANDS,
  MAX_RECENT_ACTIONS,
  MAX_CACHE_ENTRIES,
  createId,
  normalizeMode,
  readDebugFlag,
  writeDebugFlag,
  createEmptySession,
  createEmptySnapshotCache,
  createMockBenchmarkReport,
  trimToSize,
  appendTimelineEvent,
  deriveTarget,
  materializeState,
} from './browserObservabilityHelpers';
import type { BrowserObservabilityState } from './browserObservabilityHelpers';

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
  nativeRunStats: null,
  failureSnapshots: [],
  activeFailureSnapshot: null,
  failurePreviewSuppressed: false,
  dismissedFailureIds: [],

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
        nativeRunStats: base.nativeRunStats,
        timeline: appendTimelineEvent(
          base.timeline,
          input.kind,
          input.title,
          input.level,
          source,
          input.detail,
          input.occurredAt,
          {
            cacheKey: input.cacheKey,
            cacheUrl: input.cacheUrl,
            cacheReason: input.cacheReason,
          },
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
        nativeRunStats: base.nativeRunStats,
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
        nativeRunStats: base.nativeRunStats,
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
        nativeRunStats: base.nativeRunStats,
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
        nativeRunStats: base.nativeRunStats,
      };
    });
  },

  setNativeRunStats: (stats) => {
    set({ nativeRunStats: stats });
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
        nativeRunStats: base.nativeRunStats,
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
        nativeRunStats: base.nativeRunStats,
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
          nativeRunStats: base.nativeRunStats,
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
        nativeRunStats: base.nativeRunStats,
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
        nativeRunStats: base.nativeRunStats,
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

  syncFailureSnapshots: (snapshots) => {
    set((state) => {
      const dismissedFailureIds = state.dismissedFailureIds.filter((taskId) =>
        snapshots.some((snapshot) => snapshot.taskId === taskId),
      );
      const activeFailureSnapshot = state.failurePreviewSuppressed
        ? null
        : snapshots.find((snapshot) => !dismissedFailureIds.includes(snapshot.taskId)) ?? null;

      return {
        failureSnapshots: snapshots,
        activeFailureSnapshot,
        dismissedFailureIds,
      };
    });
  },

  dismissFailureSnapshot: (taskId) => {
    set((state) => {
      const targetTaskId = taskId ?? state.activeFailureSnapshot?.taskId;
      if (!targetTaskId) {
        return {};
      }

      return {
        activeFailureSnapshot:
          state.activeFailureSnapshot?.taskId === targetTaskId ? null : state.activeFailureSnapshot,
        dismissedFailureIds: state.dismissedFailureIds.includes(targetTaskId)
          ? state.dismissedFailureIds
          : [...state.dismissedFailureIds, targetTaskId],
      };
    });
  },

  suppressFailurePreview: (suppressed) => {
    set((state) => ({
      failurePreviewSuppressed: suppressed,
      activeFailureSnapshot: suppressed
        ? null
        : state.failureSnapshots.find(
          (snapshot) => !state.dismissedFailureIds.includes(snapshot.taskId),
        ) ?? null,
    }));
  },

  clearTimeline: () => {
    set({ timeline: [] });
  },
}));