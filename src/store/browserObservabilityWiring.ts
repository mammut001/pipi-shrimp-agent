import type { BrowserInspectionResult, LogEntry } from '@/types/browser';
import type { BrowserInteractiveElement, BrowserPageState } from '@/types/browserPageState';
import type {
  BrowserBackendEvent,
  BrowserDebugEventKind,
  BrowserObservabilitySnapshotPayload,
  BrowserPageElementPreview,
  BrowserPageWarning,
} from '@/types/browserObservability';
import { isBrowserPageStateV2Enabled } from '@/utils/browserFeatureFlags';
import { getBrowserObservabilitySnapshot } from '@/utils/browserObservabilityClient';
import { getBrowserPageState } from '@/utils/browserPageStateClient';
import { getBrowserElementLabel, getBrowserElementStatus } from '@/utils/browserPageStateModel';

import { useBrowserAgentStore } from './browserAgentStore';
import { useBrowserObservabilityStore } from './browserObservabilityStore';
import { useCdpStore } from './cdpStore';

let wiringCleanup: (() => void) | null = null;
let navigationRevision = 0;
let backendPageStateSync: Promise<void> | null = null;
let lastBackendPageStateKey: string | null = null;
let lastBackendPageStateError: string | null = null;
let backendObservabilitySync: Promise<void> | null = null;
let lastBackendObservabilityError: string | null = null;
let lastBackendEventSequence = 0;

const simpleHash = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const levelFromLog = (level: LogEntry['level']) => {
  switch (level) {
    case 'success':
      return 'success' as const;
    case 'warning':
      return 'warning' as const;
    case 'error':
      return 'error' as const;
    default:
      return 'info' as const;
  }
};

const titleFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || 'unknown-page';
  }
};

const buildWarnings = (
  inspection: BrowserInspectionResult | null,
  status: ReturnType<typeof useBrowserAgentStore.getState>['status'],
  error: string | null,
): BrowserPageWarning[] => {
  const warnings: BrowserPageWarning[] = [];

  if (inspection && !inspection.safeForAgent) {
    warnings.push({
      id: `warn-${simpleHash(`unsafe:${inspection.url}`)}`,
      message: inspection.blockReason ? `Blocked: ${inspection.blockReason}` : 'Page is not marked safe for automation.',
      severity: 'warning',
    });
  }

  if (status === 'blocked_auth' || status === 'blocked_captcha' || status === 'blocked_manual_step') {
    warnings.push({
      id: `warn-${simpleHash(`status:${status}`)}`,
      message: `Browser status: ${status}`,
      severity: 'warning',
    });
  }

  if (error) {
    warnings.push({
      id: `warn-${simpleHash(`error:${error}`)}`,
      message: error,
      severity: 'error',
    });
  }

  return warnings.slice(0, 6);
};

const warningSeverityFromText = (warning: string): BrowserPageWarning['severity'] => {
  const normalized = warning.toLowerCase();
  if (
    normalized.includes('error') ||
    normalized.includes('failed') ||
    normalized.includes('stale') ||
    normalized.includes('timeout')
  ) {
    return 'error';
  }
  return 'warning';
};

const buildElements = (inspection: BrowserInspectionResult | null): BrowserPageElementPreview[] => {
  if (inspection?.matchedSignals?.length) {
    return inspection.matchedSignals.slice(0, 8).map((signal, index) => ({
      id: `signal-${index}`,
      label: signal,
      role: signal.includes('#') || signal.includes('.') ? 'selector' : 'signal',
      selector: signal.includes('#') || signal.includes('.') ? signal : undefined,
      status: inspection.safeForAgent ? 'visible' : 'attention',
    }));
  }

  if (!inspection) {
    return [
      {
        id: 'placeholder-root',
        label: 'Awaiting inspection result',
        role: 'placeholder',
        status: 'pending',
      },
    ];
  }

  return [
    {
      id: 'summary-auth',
      label: `Auth state: ${inspection.authState}`,
      role: 'status',
      status: inspection.safeForAgent ? 'ready' : 'guarded',
    },
    {
      id: 'summary-page',
      label: inspection.title || titleFromUrl(inspection.url),
      role: 'title',
      selector: inspection.url,
      status: 'visible',
    },
  ];
};

const buildPageStateElementPreview = (element: BrowserInteractiveElement): BrowserPageElementPreview => {
  const selector = element.selector_hint || element.href || `index=${element.index} backend_node_id=${element.backend_node_id}`;
  return {
    id: `element-${element.backend_node_id}`,
    label: getBrowserElementLabel(element),
    role: element.role || element.tag_name || 'element',
    selector,
    status: getBrowserElementStatus(element),
  };
};

const buildBackendDomVersion = (pageState: BrowserPageState): string => {
  const seed = pageState.elements
    .slice(0, 32)
    .map((element) =>
      [
        element.backend_node_id,
        element.index,
        element.is_visible ? '1' : '0',
        element.is_clickable ? '1' : '0',
        element.is_editable ? '1' : '0',
      ].join(':'),
    )
    .join('|');

  return `dom-${simpleHash(`${pageState.navigation_id}:${pageState.warnings.join('|')}:${seed}`)}`;
};

const toBackendSnapshot = (pageState: BrowserPageState) => {
  const observability = useBrowserObservabilityStore.getState();
  const browserState = useBrowserAgentStore.getState();
  const cdpState = useCdpStore.getState();
  const targetId = cdpState.connectionState?.target_id ?? observability.session.targetId ?? 'cdp-target';
  const viewportSignature = `${browserState.presentationMode}:cdp:${pageState.frame_count}`;
  const domVersion = buildBackendDomVersion(pageState);
  const derivedWarnings = buildWarnings(browserState.inspection, browserState.status, browserState.error);
  const warningMap = new Map<string, BrowserPageWarning>();

  pageState.warnings.forEach((warning) => {
    warningMap.set(warning, {
      id: `warn-${simpleHash(`page-state:${warning}`)}`,
      message: warning,
      severity: warningSeverityFromText(warning),
    });
  });

  derivedWarnings.forEach((warning) => {
    warningMap.set(warning.message, warning);
  });

  const fallbackElements = buildElements(browserState.inspection);
  const elements = pageState.elements.length > 0
    ? pageState.elements.slice(0, 20).map(buildPageStateElementPreview)
    : fallbackElements;

  return {
    cacheKey: [targetId, pageState.navigation_id, viewportSignature, domVersion].join(':'),
    url: pageState.url,
    title: pageState.title,
    warnings: Array.from(warningMap.values()).slice(0, 8),
    elements,
    navigationId: pageState.navigation_id,
    domVersion,
    viewportSignature,
    source: 'backend' as const,
  };
};

const isConnectionGoneError = (error: unknown): boolean => {
  const normalized = String(error).toLowerCase();
  return normalized.includes('not connected') || normalized.includes('未连接');
};

const mapBackendEventKind = (kind: BrowserBackendEvent['kind']): BrowserDebugEventKind => {
  switch (kind) {
    case 'connected':
    case 'disconnected':
    case 'health_changed':
    case 'navigation':
    case 'page_state_updated':
    case 'idle_cleanup':
      return kind;
    case 'action_started':
    case 'action_completed':
    case 'action_failed':
      return 'action';
    default:
      return 'agent_log';
  }
};

const mapBackendActionStatus = (kind: BrowserBackendEvent['kind']) => {
  switch (kind) {
    case 'action_completed':
      return 'completed' as const;
    case 'action_failed':
      return 'failed' as const;
    default:
      return 'started' as const;
  }
};

const ingestBackendEvent = (event: BrowserBackendEvent) => {
  const observability = useBrowserObservabilityStore.getState();

  if (event.kind === 'page_state_updated') {
    return;
  }

  if (event.kind === 'action_started' || event.kind === 'action_completed' || event.kind === 'action_failed') {
    observability.recordAction({
      name: event.action_name || event.title,
      detail: event.detail ?? event.benchmark?.detail ?? undefined,
      status: mapBackendActionStatus(event.kind),
      createdAt: event.occurred_at_ms,
      source: 'backend',
    });
    return;
  }

  observability.recordEvent({
    kind: mapBackendEventKind(event.kind),
    title: event.title,
    detail: event.detail ?? event.benchmark?.detail ?? undefined,
    level: event.level,
    occurredAt: event.occurred_at_ms,
    source: 'backend',
  });
};

const toBackendSnapshotCacheState = (snapshotCache: BrowserObservabilitySnapshotPayload['snapshot_cache']) => ({
  activeKey: snapshotCache.active_key,
  entryLimit: snapshotCache.entry_limit,
  entries: snapshotCache.entries.map((entry) => ({
    key: entry.key,
    url: entry.url,
    snapshotId: entry.snapshot_id,
    createdAt: entry.created_at_ms,
    lastAccessedAt: entry.last_accessed_at_ms,
    accessCount: entry.access_count,
    invalidatedAt: entry.invalidated_at_ms ?? undefined,
    invalidationReason: entry.invalidation_reason ?? undefined,
    source: 'backend' as const,
  })),
  hitCount: snapshotCache.hit_count,
  missCount: snapshotCache.miss_count,
  evictionCount: snapshotCache.eviction_count,
  invalidationCount: snapshotCache.invalidation_count,
});

const ingestLogEntries = (entries: LogEntry[]) => {
  const observability = useBrowserObservabilityStore.getState();

  entries.forEach((entry) => {
    observability.recordEvent({
      kind: 'agent_log',
      title: entry.level.toUpperCase(),
      detail: entry.message,
      level: levelFromLog(entry.level),
      source: 'derived',
    });

    const nativeActionMatch = entry.message.match(/^\[NativeAgent\] Action: ([a-z_]+)\s*(.*)$/i);
    if (nativeActionMatch) {
      observability.recordAction({
        name: nativeActionMatch[1],
        detail: nativeActionMatch[2] || undefined,
        status: 'started',
        source: 'derived',
      });
      return;
    }

    if (entry.message.includes('开始执行任务')) {
      observability.recordAction({
        name: 'execute_task',
        detail: entry.message,
        status: 'started',
        source: 'derived',
      });
      return;
    }

    if (entry.message.includes('任务完成') || entry.message.startsWith('[NativeAgent] ✅')) {
      observability.recordAction({
        name: 'execute_task',
        detail: entry.message,
        status: 'completed',
        source: 'derived',
      });
      return;
    }

    if (entry.message.includes('执行失败') || entry.message.includes('任务失败')) {
      observability.recordAction({
        name: 'execute_task',
        detail: entry.message,
        status: 'failed',
        source: 'derived',
      });
    }
  });
};

const syncDerivedPageState = () => {
  const observability = useBrowserObservabilityStore.getState();
  const browserState = useBrowserAgentStore.getState();
  const cdpState = useCdpStore.getState();
  const inspection = browserState.inspection;
  const url = inspection?.url || browserState.currentUrl || cdpState.connectionState?.current_url || '';

  if (!url) {
    return;
  }

  const navigationId = `nav-${Math.max(1, navigationRevision)}-${simpleHash(url)}`;
  const targetId = cdpState.connectionState?.target_id ?? (browserState.isWindowOpen ? 'embedded-surface' : 'browser-panel');
  const viewportSignature = `${browserState.presentationMode}:panel`;
  const domSeed = inspection
    ? `${inspection.authState}:${inspection.safeForAgent}:${inspection.matchedSignals.join('|')}`
    : `${browserState.authState}:${browserState.status}:${url}`;
  const domVersion = `dom-${simpleHash(domSeed)}`;

  observability.upsertPageState({
    cacheKey: [targetId, navigationId, viewportSignature, domVersion].join(':'),
    url,
    title: inspection?.title || titleFromUrl(url),
    warnings: buildWarnings(inspection, browserState.status, browserState.error),
    elements: buildElements(inspection),
    navigationId,
    domVersion,
    viewportSignature,
    source: 'derived',
  });
};

const syncBackendPageState = async (reason: 'setup' | 'navigation' | 'browser-change' | 'poll' | 'status') => {
  if (!isBrowserPageStateV2Enabled()) {
    return;
  }

  const cdpState = useCdpStore.getState();
  if (cdpState.status !== 'connected' || !cdpState.connectionState?.connected) {
    lastBackendPageStateKey = null;
    return;
  }

  if (backendPageStateSync) {
    return backendPageStateSync;
  }

  backendPageStateSync = (async () => {
    try {
      const pageState = await getBrowserPageState();
      const snapshot = toBackendSnapshot(pageState);

      if (reason === 'poll' && snapshot.cacheKey === lastBackendPageStateKey) {
        lastBackendPageStateError = null;
        return;
      }

      lastBackendPageStateKey = snapshot.cacheKey;
      lastBackendPageStateError = null;
      useBrowserObservabilityStore.getState().upsertPageState(snapshot);
    } catch (error) {
      if (isConnectionGoneError(error)) {
        lastBackendPageStateKey = null;
        return;
      }

      const message = String(error);
      if (message !== lastBackendPageStateError) {
        lastBackendPageStateError = message;
        useBrowserObservabilityStore.getState().recordEvent({
          kind: 'health_changed',
          title: 'PageState sync failed',
          detail: message,
          level: 'warning',
          source: 'backend',
        });
      }
    } finally {
      backendPageStateSync = null;
    }
  })();

  return backendPageStateSync;
};

const syncBackendObservability = async (reason: 'setup' | 'navigation' | 'browser-change' | 'poll' | 'status') => {
  const cdpState = useCdpStore.getState();
  if (cdpState.status !== 'connected' || !cdpState.connectionState?.connected) {
    return;
  }

  if (backendObservabilitySync) {
    return backendObservabilitySync;
  }

  backendObservabilitySync = (async () => {
    try {
      const snapshot = await getBrowserObservabilitySnapshot();
      lastBackendObservabilityError = null;
      useBrowserObservabilityStore.getState().syncSnapshotCache(toBackendSnapshotCacheState(snapshot.snapshot_cache), 'backend');
      useBrowserObservabilityStore.getState().setBenchmarkReport(snapshot.benchmark_report, 'backend');

      const nextEvents = snapshot.recent_events
        .filter((event) => event.sequence > lastBackendEventSequence)
        .sort((left, right) => left.sequence - right.sequence);

      nextEvents.forEach((event) => {
        lastBackendEventSequence = Math.max(lastBackendEventSequence, event.sequence);
        ingestBackendEvent(event);
      });
    } catch (error) {
      if (isConnectionGoneError(error)) {
        return;
      }

      const message = String(error);
      if (message !== lastBackendObservabilityError) {
        lastBackendObservabilityError = message;
        useBrowserObservabilityStore.getState().recordEvent({
          kind: 'health_changed',
          title: 'Observability sync failed',
          detail: `${reason}: ${message}`,
          level: 'warning',
          source: 'backend',
        });
      }
    } finally {
      backendObservabilitySync = null;
    }
  })();

  return backendObservabilitySync;
};

const syncSessionFromStores = () => {
  const observability = useBrowserObservabilityStore.getState();
  const browserState = useBrowserAgentStore.getState();
  const cdpState = useCdpStore.getState();
  const currentSession = observability.session;
  const hasRealSignal = Boolean(
    cdpState.connectionState ||
      cdpState.errorMessage ||
      browserState.currentUrl ||
      browserState.logs.length ||
      browserState.inspection ||
      browserState.pendingTask,
  );

  if (!hasRealSignal && observability.isUsingMockData) {
    return;
  }

  observability.syncSession({
    connected: cdpState.connectionState?.connected ?? cdpState.status === 'connected',
    mode: cdpState.connectionState?.launch_mode ?? currentSession.mode,
    wsStatus: cdpState.connectionState?.health_status ?? (cdpState.status === 'connected' ? 'connected' : cdpState.status),
    websocketUrl: cdpState.connectionState?.websocket_url ?? currentSession.websocketUrl,
    currentUrl: cdpState.connectionState?.current_url ?? browserState.currentUrl ?? currentSession.currentUrl,
    lastError: cdpState.connectionState?.last_error ?? cdpState.errorMessage,
    targetId: cdpState.connectionState?.target_id ?? currentSession.targetId,
    sessionId: cdpState.connectionState?.session_id ?? currentSession.sessionId,
    currentTarget: cdpState.connectionState?.target_id ?? titleFromUrl(browserState.currentUrl || cdpState.connectionState?.current_url || ''),
    source: cdpState.connectionState ? 'backend' : 'derived',
  });
};

export const setupBrowserObservabilityWiring = (): (() => void) => {
  if (wiringCleanup) {
    return wiringCleanup;
  }

  const observability = useBrowserObservabilityStore.getState();
  observability.markWiringReady(true);
  observability.seedMockData();

  void useCdpStore.getState().syncConnectionState();
  syncSessionFromStores();
  if (useCdpStore.getState().status === 'connected') {
    void syncBackendObservability('setup');
    void syncBackendPageState('setup');
  }

  let previousBrowserState = useBrowserAgentStore.getState();
  let previousCdpState = useCdpStore.getState();

  if (previousBrowserState.currentUrl) {
    navigationRevision = 1;
  }

  const unsubscribeBrowser = useBrowserAgentStore.subscribe((nextState) => {
    if (nextState.logs.length > previousBrowserState.logs.length) {
      ingestLogEntries(nextState.logs.slice(previousBrowserState.logs.length));
    }

    if (nextState.currentUrl && nextState.currentUrl !== previousBrowserState.currentUrl) {
      navigationRevision += 1;
      if (previousBrowserState.currentUrl) {
        useBrowserObservabilityStore.getState().invalidateSnapshots('navigation', 'derived');
      }
      useBrowserObservabilityStore.getState().recordEvent({
        kind: 'navigation',
        title: 'Navigation committed',
        detail: nextState.currentUrl,
        level: 'info',
        source: 'derived',
      });
    }

    if (
      nextState.inspection !== previousBrowserState.inspection ||
      nextState.currentUrl !== previousBrowserState.currentUrl ||
      nextState.authState !== previousBrowserState.authState ||
      nextState.status !== previousBrowserState.status ||
      nextState.error !== previousBrowserState.error
    ) {
      if (useCdpStore.getState().status === 'connected' && isBrowserPageStateV2Enabled()) {
        void syncBackendObservability('browser-change');
        void syncBackendPageState('browser-change');
      } else {
        syncDerivedPageState();
      }
    }

    if (nextState.pendingTask?.id !== previousBrowserState.pendingTask?.id && nextState.pendingTask) {
      useBrowserObservabilityStore.getState().recordAction({
        name: 'task_bound',
        detail: nextState.pendingTask.executionPrompt,
        status: 'started',
        source: 'derived',
      });
    }

    if (nextState.status !== previousBrowserState.status) {
      if (nextState.status === 'running') {
        useBrowserObservabilityStore.getState().recordAction({
          name: 'execute_task',
          detail: nextState.pendingTask?.executionPrompt,
          status: 'started',
          source: 'derived',
        });
      }

      if (nextState.status === 'completed') {
        useBrowserObservabilityStore.getState().recordAction({
          name: 'execute_task',
          detail: nextState.lastTaskResult ?? nextState.pendingTask?.executionPrompt,
          status: 'completed',
          source: 'derived',
        });
      }

      if (nextState.status === 'error') {
        useBrowserObservabilityStore.getState().recordAction({
          name: 'execute_task',
          detail: nextState.error ?? nextState.pendingTask?.executionPrompt,
          status: 'failed',
          source: 'derived',
        });
      }
    }

    syncSessionFromStores();
    previousBrowserState = nextState;
  });

  const unsubscribeCdp = useCdpStore.subscribe((nextState) => {
    const previousUrl = previousCdpState.connectionState?.current_url;
    const nextUrl = nextState.connectionState?.current_url;
    const previousTargetId = previousCdpState.connectionState?.target_id;
    const nextTargetId = nextState.connectionState?.target_id;
    const healthChanged = nextState.connectionState?.health_status !== previousCdpState.connectionState?.health_status;
    const navigationChanged = Boolean(nextUrl && nextUrl !== previousUrl);
    const targetChanged = nextTargetId !== previousTargetId;

    if (
      nextState.status !== previousCdpState.status ||
      nextState.errorMessage !== previousCdpState.errorMessage ||
      nextState.connectionState !== previousCdpState.connectionState
    ) {
      syncSessionFromStores();
    }

    if (navigationChanged) {
      navigationRevision += 1;
      if (previousUrl) {
        useBrowserObservabilityStore.getState().invalidateSnapshots('navigation', 'backend');
      }
      useBrowserObservabilityStore.getState().recordEvent({
        kind: 'navigation',
        title: 'Navigation committed',
        detail: nextUrl ?? '',
        level: 'info',
        source: 'backend',
      });
    }

    if (nextState.status === 'error' && nextState.errorMessage && nextState.errorMessage !== previousCdpState.errorMessage) {
      useBrowserObservabilityStore.getState().recordEvent({
        kind: 'health_changed',
        title: 'CDP connection error',
        detail: nextState.errorMessage,
        level: 'error',
        source: 'backend',
      });
    }

    if (nextState.status === 'connected' && (navigationChanged || targetChanged || healthChanged)) {
      void syncBackendObservability(navigationChanged || targetChanged ? 'navigation' : 'status');
      void syncBackendPageState(navigationChanged || targetChanged ? 'navigation' : 'status');
    }

    if (nextState.status !== 'connected' && previousCdpState.status === 'connected') {
      lastBackendPageStateKey = null;
    }

    previousCdpState = nextState;
  });

  const intervalId = globalThis.setInterval(() => {
    if (useCdpStore.getState().status === 'connected') {
      void useCdpStore.getState().syncConnectionState();
      void syncBackendObservability('poll');
      void syncBackendPageState('poll');
    }
  }, 15_000);

  wiringCleanup = () => {
    globalThis.clearInterval(intervalId);
    unsubscribeBrowser();
    unsubscribeCdp();
    useBrowserObservabilityStore.getState().markWiringReady(false);
    wiringCleanup = null;
  };

  return wiringCleanup;
};