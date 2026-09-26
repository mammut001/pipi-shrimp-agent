import type { BrowserFailureSnapshot } from '@/types/browser';
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
  BrowserSnapshotCacheState,
  NativeAgentRunStatsPayload,
} from '@/types/browserObservability';
import { BROWSER_FEATURE_FLAG_KEYS, isBrowserDebugPanelEnabled } from '@/utils/browserFeatureFlags';

export const DEBUG_PANEL_STORAGE_KEY = BROWSER_FEATURE_FLAG_KEYS.debugPanel;
export const MAX_TIMELINE_EVENTS = 80;
export const MAX_RECENT_COMMANDS = 24;
export const MAX_RECENT_ACTIONS = 24;
export const MAX_CACHE_ENTRIES = 6;

export type SessionPatch = Partial<Omit<BrowserDebugSessionInfo, 'mode' | 'source' | 'currentTarget'>> & {
  mode?: string | null;
  source?: BrowserDebugSource;
  currentTarget?: string | null;
};

export type EventInput = Omit<BrowserDebugEvent, 'id' | 'occurredAt' | 'source'> & {
  occurredAt?: number;
  source?: BrowserDebugSource;
};

export type CommandStartInput = Pick<BrowserCommandTrace, 'method' | 'summary'> & {
  source?: BrowserDebugSource;
};

export type CommandFinishInput = {
  status: 'success' | 'error';
  durationMs?: number;
  error?: string;
  source?: BrowserDebugSource;
};

export type ActionInput = Omit<BrowserActionTrace, 'id' | 'createdAt' | 'source'> & {
  createdAt?: number;
  source?: BrowserDebugSource;
};

export type PageStateInput = Omit<BrowserPageStateSnapshot, 'id' | 'createdAt' | 'source'> & {
  id?: string;
  createdAt?: number;
  source?: BrowserDebugSource;
};

export interface BrowserObservabilityState {
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
  nativeRunStats: NativeAgentRunStatsPayload | null;
  failureSnapshots: BrowserFailureSnapshot[];
  activeFailureSnapshot: BrowserFailureSnapshot | null;
  failurePreviewSuppressed: boolean;
  dismissedFailureIds: string[];
  setDebugPanelEnabled: (enabled: boolean) => void;
  markWiringReady: (ready: boolean) => void;
  seedMockData: () => void;
  recordEvent: (input: EventInput) => void;
  startCommand: (input: CommandStartInput) => string;
  finishCommand: (id: string, input: CommandFinishInput) => void;
  recordAction: (input: ActionInput) => void;
  setBenchmarkReport: (report: BrowserBenchmarkReport, source?: BrowserDebugSource) => void;
  setNativeRunStats: (stats: NativeAgentRunStatsPayload | null) => void;
  syncSnapshotCache: (snapshotCache: BrowserSnapshotCacheState, source?: BrowserDebugSource) => void;
  syncSession: (patch: SessionPatch) => void;
  upsertPageState: (input: PageStateInput) => void;
  invalidateSnapshots: (reason: string, source?: BrowserDebugSource) => void;
  syncFailureSnapshots: (snapshots: BrowserFailureSnapshot[]) => void;
  dismissFailureSnapshot: (taskId?: string) => void;
  suppressFailurePreview: (suppressed: boolean) => void;
  clearTimeline: () => void;
}

export const createId = (prefix: string): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return `${prefix}-${randomId}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const normalizeMode = (mode?: string | null): BrowserDebugSessionInfo['mode'] => {
  if (mode === 'attach' || mode === 'launch') {
    return mode;
  }
  return 'unknown';
};

export const readDebugFlag = (): boolean => {
  return isBrowserDebugPanelEnabled();
};

export const writeDebugFlag = (enabled: boolean) => {
  try {
    globalThis.localStorage?.setItem(DEBUG_PANEL_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore localStorage availability issues.
  }
};

export const createEmptySession = (source: BrowserDebugSource = 'derived'): BrowserDebugSessionInfo => ({
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

export const createEmptySnapshotCache = (): BrowserSnapshotCacheState => ({
  activeKey: null,
  entryLimit: MAX_CACHE_ENTRIES,
  entries: [],
  hitCount: 0,
  missCount: 0,
  evictionCount: 0,
  invalidationCount: 0,
});

export const createMockBenchmarkReport = (now: number): BrowserBenchmarkReport => ({
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

export const trimToSize = <T,>(entries: T[], limit: number): T[] => entries.slice(0, limit);

export const appendTimelineEvent = (
  timeline: BrowserDebugEvent[],
  kind: BrowserDebugEventKind,
  title: string,
  level: BrowserDebugEventLevel,
  source: BrowserDebugSource,
  detail?: string,
  occurredAt = Date.now(),
  metadata?: Pick<BrowserDebugEvent, 'cacheKey' | 'cacheUrl' | 'cacheReason'>,
): BrowserDebugEvent[] => {
  const event: BrowserDebugEvent = {
    id: createId('browser-event'),
    kind,
    title,
    detail,
    cacheKey: metadata?.cacheKey,
    cacheUrl: metadata?.cacheUrl,
    cacheReason: metadata?.cacheReason,
    level,
    occurredAt,
    source,
  };

  return trimToSize([event, ...timeline], MAX_TIMELINE_EVENTS);
};

export const deriveTarget = (currentUrl?: string | null, targetId?: string | null): string => {
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

export const materializeState = (state: BrowserObservabilityState, source: BrowserDebugSource) => {
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
      nativeRunStats: state.nativeRunStats,
      failureSnapshots: state.failureSnapshots,
      activeFailureSnapshot: state.activeFailureSnapshot,
      dismissedFailureIds: state.dismissedFailureIds,
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
    nativeRunStats: state.nativeRunStats,
    failureSnapshots: state.failureSnapshots,
    activeFailureSnapshot: state.activeFailureSnapshot,
    dismissedFailureIds: state.dismissedFailureIds,
  };
};
