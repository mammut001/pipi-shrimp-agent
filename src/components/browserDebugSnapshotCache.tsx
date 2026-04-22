import type { ReactNode } from 'react';

import type {
  BrowserDebugEvent,
  BrowserDebugEventKind,
  BrowserDebugEventLevel,
  BrowserPageStateSnapshot,
  BrowserSnapshotCacheState,
} from '@/types/browserObservability';

export const SNAPSHOT_CACHE_EVENT_KINDS = new Set<BrowserDebugEventKind>([
  'snapshot_cache_store',
  'snapshot_cache_hit',
  'snapshot_cache_miss',
  'snapshot_cache_evict',
  'snapshot_cache_invalidate',
]);

export type SnapshotCacheFlowGroup = {
  key: string;
  url: string | null;
  navigationId: string | null;
  isActive: boolean;
  isPresent: boolean;
  isInvalidated: boolean;
  createdAt: number | null;
  lastAccessedAt: number | null;
  accessCount: number | null;
  invalidatedAt: number | null;
  invalidationReason: string | null;
  latestAt: number;
  latestKind: BrowserDebugEventKind;
  latestReasonLabel: string | null;
  steps: Array<{
    id: string;
    label: string;
    level: BrowserDebugEventLevel;
  }>;
};

type SnapshotCacheComparable = Pick<SnapshotCacheFlowGroup, 'key' | 'navigationId'>;

export type SnapshotCacheRelationDescriptor = {
  badge: string;
  badgeClass: string;
  textClass: string;
  description: string;
};

export type SnapshotCacheTimelineEventMeta = {
  kindLabel: string;
  cacheKey: string | null;
  compactCacheKey: string | null;
  cacheUrl: string | null;
  entrySummary: string | null;
  reasonBadge: string | null;
  relation: SnapshotCacheRelationDescriptor | null;
};

type SnapshotCacheFlowStatus = {
  label: string;
  badgeClass: string;
  cardClass: string;
  accentBadge?: string;
  accentClass?: string;
};

export function isSnapshotCacheEvent(event: BrowserDebugEvent): boolean {
  return SNAPSHOT_CACHE_EVENT_KINDS.has(event.kind);
}

export function formatSnapshotCacheEventKind(kind: BrowserDebugEventKind): string {
  switch (kind) {
    case 'snapshot_cache_store':
      return 'store';
    case 'snapshot_cache_hit':
      return 'hit';
    case 'snapshot_cache_miss':
      return 'miss';
    case 'snapshot_cache_evict':
      return 'evict';
    case 'snapshot_cache_invalidate':
      return 'invalidate';
    default:
      return kind;
  }
}

export function formatSnapshotCacheFlowLabel(event: BrowserDebugEvent): string {
  if (event.kind !== 'snapshot_cache_invalidate') {
    return formatSnapshotCacheEventKind(event.kind);
  }

  const humanReason = extractSnapshotCacheReasonLabel(event);
  if (humanReason) {
    return `invalidate: ${humanReason}`;
  }

  return 'invalidate';
}

export function extractSnapshotCacheReasonLabel(event: BrowserDebugEvent): string | null {
  const humanReason = event.detail?.split('|')[0]?.trim();
  if (humanReason) {
    return humanReason;
  }

  if (!event.cacheReason) {
    return null;
  }

  const normalized = event.cacheReason.replace(/^cdp_/, '').replace(/_/g, ' ').trim();
  return normalized || null;
}

function normalizeSnapshotCacheReasonKey(reason: string | null): string | null {
  if (!reason) {
    return null;
  }

  return reason
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^cdp-/, '')
    .replace(/^-+|-+$/g, '');
}

export function snapshotCacheReasonBadge(reasonLabel: string | null, reasonCode?: string | null): string | null {
  const normalized = normalizeSnapshotCacheReasonKey(reasonCode ?? reasonLabel);
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case 'frame-nav':
      return 'frame-nav';
    case 'dom-update':
      return 'dom-update';
    case 'same-doc':
      return 'same-doc';
    case 'doc-open':
      return 'doc-open';
    case 'frame-detach':
      return 'frame-detach';
    case 'manual':
      return 'manual';
    case 'other':
      return 'other';
    case 'frame-navigated':
      return 'frame-nav';
    case 'dom-document-updated':
      return 'dom-update';
    case 'navigated-within-document':
      return 'same-doc';
    case 'document-opened':
      return 'doc-open';
    case 'frame-detached':
      return 'frame-detach';
    case 'manual-invalidation':
      return 'manual';
    default:
      return 'other';
  }
}

function navigationSequence(navigationId: string | null): number | null {
  if (!navigationId) {
    return null;
  }

  const match = navigationId.match(/(\d+)(?!.*\d)/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSnapshotCacheKey(key: string): {
  targetId: string;
  navigationId: string;
  viewportSignature: string;
  domVersion: string;
} | null {
  const segments = key.split(':');
  if (segments.length < 4) {
    return null;
  }

  return {
    targetId: segments[0],
    navigationId: segments[1],
    viewportSignature: segments.slice(2, -1).join(':'),
    domVersion: segments[segments.length - 1] ?? '',
  };
}

export function resolveSnapshotCacheEventKey(
  event: BrowserDebugEvent,
  entryKeysByUrl: Map<string, string[]>,
  activeKey: string | null | undefined,
  activeUrl: string | null,
): string | null {
  if (event.cacheKey) {
    return event.cacheKey;
  }

  if (event.detail && event.detail.includes(' | ')) {
    const [candidateKey] = event.detail.split(' | ');
    if (candidateKey.includes(':')) {
      return candidateKey.trim();
    }
  }

  const eventUrl = event.cacheUrl ?? null;
  if (eventUrl) {
    const matchingKeys = entryKeysByUrl.get(eventUrl) ?? [];
    if (matchingKeys.length === 1) {
      return matchingKeys[0];
    }

    if (activeKey && activeUrl === eventUrl) {
      return activeKey;
    }
  }

  return null;
}

export function eventLevelBadgeClass(level: BrowserDebugEventLevel): string {
  if (level === 'error') {
    return 'bg-red-500/20 text-red-300';
  }
  if (level === 'warning') {
    return 'bg-amber-500/20 text-amber-300';
  }
  if (level === 'success') {
    return 'bg-emerald-500/20 text-emerald-300';
  }
  return 'bg-cyan-500/20 text-cyan-300';
}

export function snapshotCacheFlowStepClass(
  level: BrowserDebugEventLevel,
  options?: { isTerminal?: boolean; kind?: BrowserDebugEventKind },
): string {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.12em]';
  if (options?.isTerminal && options.kind === 'snapshot_cache_evict') {
    return `${base} border border-rose-500/40 bg-rose-950/70 text-rose-100`;
  }
  if (options?.isTerminal && options.kind === 'snapshot_cache_invalidate') {
    return `${base} border border-amber-500/40 bg-amber-950/70 text-amber-100`;
  }
  if (options?.isTerminal) {
    return `${base} border border-cyan-500/30 bg-cyan-950/50 text-cyan-100`;
  }
  return `${base} ${eventLevelBadgeClass(level)}`;
}

export function snapshotCachePageStateRelation(
  group: SnapshotCacheComparable,
  latestPageState: BrowserPageStateSnapshot | null,
): SnapshotCacheRelationDescriptor {
  if (!latestPageState) {
    return {
      badge: 'no-page-state',
      badgeClass: 'border border-slate-700 bg-slate-800/80 text-slate-300',
      textClass: 'text-slate-400',
      description: 'No current PageState available.',
    };
  }

  if (latestPageState.cacheKey === group.key) {
    return {
      badge: 'current-entry',
      badgeClass: 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
      textClass: 'text-cyan-200',
      description: 'Current PageState is derived from this cache entry.',
    };
  }

  if (latestPageState.navigationId === group.navigationId) {
    return {
      badge: 'same-nav',
      badgeClass: 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
      textClass: 'text-emerald-200',
      description: `Current PageState shares ${latestPageState.navigationId} but uses a different cache entry.`,
    };
  }

  const latestSequence = navigationSequence(latestPageState.navigationId);
  const groupSequence = navigationSequence(group.navigationId);
  if (latestSequence != null && groupSequence != null) {
    if (latestSequence > groupSequence) {
      return {
        badge: 'newer-nav',
        badgeClass: 'border border-amber-500/30 bg-amber-500/10 text-amber-200',
        textClass: 'text-amber-200',
        description: `Current PageState advanced to ${latestPageState.navigationId}.`,
      };
    }

    if (latestSequence < groupSequence) {
      return {
        badge: 'older-nav',
        badgeClass: 'border border-rose-500/30 bg-rose-500/10 text-rose-200',
        textClass: 'text-rose-200',
        description: `Current PageState is behind ${group.navigationId}.`,
      };
    }
  }

  return {
    badge: 'different-entry',
    badgeClass: 'border border-slate-700 bg-slate-800/80 text-slate-300',
    textClass: 'text-slate-300',
    description: `Current PageState uses ${latestPageState.navigationId}.`,
  };
}

export function snapshotCacheEventKey(event: BrowserDebugEvent): string | null {
  if (event.cacheKey) {
    return event.cacheKey;
  }

  if (!event.detail || !event.detail.includes(' | ')) {
    return null;
  }

  const [candidateKey] = event.detail.split(' | ');
  return candidateKey.includes(':') ? candidateKey.trim() : null;
}

export function snapshotCacheEntrySummary(cacheKey: string | null, kindLabel: string): string | null {
  if (!cacheKey) {
    return null;
  }

  const parsedKey = parseSnapshotCacheKey(cacheKey);
  if (!parsedKey) {
    return null;
  }

  return `entry ${parsedKey.navigationId} · ${kindLabel} · ${parsedKey.domVersion}`;
}

export function compactSnapshotCacheKey(cacheKey: string | null): string | null {
  if (!cacheKey) {
    return null;
  }

  const parsedKey = parseSnapshotCacheKey(cacheKey);
  if (!parsedKey) {
    return cacheKey;
  }

  return [parsedKey.targetId, parsedKey.navigationId, parsedKey.viewportSignature, parsedKey.domVersion]
    .filter(Boolean)
    .join(' · ');
}

export function snapshotCacheTimelineEventMeta(
  event: BrowserDebugEvent,
  latestPageState: BrowserPageStateSnapshot | null,
): SnapshotCacheTimelineEventMeta | null {
  if (!isSnapshotCacheEvent(event)) {
    return null;
  }

  const cacheKey = snapshotCacheEventKey(event);
  const parsedKey = cacheKey ? parseSnapshotCacheKey(cacheKey) : null;

  return {
    kindLabel: formatSnapshotCacheEventKind(event.kind),
    cacheKey,
    compactCacheKey: compactSnapshotCacheKey(cacheKey),
    cacheUrl: event.cacheUrl ?? null,
    entrySummary: snapshotCacheEntrySummary(cacheKey, formatSnapshotCacheEventKind(event.kind)),
    reasonBadge:
      event.kind === 'snapshot_cache_invalidate'
        ? snapshotCacheReasonBadge(extractSnapshotCacheReasonLabel(event), event.cacheReason)
        : null,
    relation: cacheKey
      ? snapshotCachePageStateRelation(
          {
            key: cacheKey,
            navigationId: parsedKey?.navigationId ?? null,
          },
          latestPageState,
        )
      : null,
  };
}

export function snapshotCacheFlowStatus(group: SnapshotCacheFlowGroup): SnapshotCacheFlowStatus {
  if (group.latestKind === 'snapshot_cache_evict' || !group.isPresent) {
    return {
      label: 'Evicted',
      badgeClass: 'bg-rose-500/20 text-rose-300',
      cardClass: 'border-rose-500/20 bg-rose-950/10',
      accentBadge: 'terminal',
      accentClass: 'border border-rose-500/30 bg-rose-500/10 text-rose-200',
    };
  }

  if (group.latestKind === 'snapshot_cache_invalidate' || group.isInvalidated) {
    return {
      label: 'Invalidated',
      badgeClass: 'bg-amber-500/20 text-amber-300',
      cardClass: 'border-amber-500/20 bg-amber-950/10',
      accentBadge: snapshotCacheReasonBadge(group.latestReasonLabel, group.invalidationReason) ?? undefined,
      accentClass: 'border border-amber-500/30 bg-amber-500/10 text-amber-200',
    };
  }

  if (group.isActive) {
    return {
      label: 'Active',
      badgeClass: 'bg-cyan-500/20 text-cyan-300',
      cardClass: 'border-cyan-500/20 bg-cyan-950/10',
      accentBadge: 'current',
      accentClass: 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
    };
  }

  return {
    label: 'Cached',
    badgeClass: 'bg-emerald-500/20 text-emerald-300',
    cardClass: 'border-emerald-500/20 bg-emerald-950/10',
  };
}

export function buildSnapshotCacheFlowGroups(
  snapshotCache: BrowserSnapshotCacheState,
  timeline: BrowserDebugEvent[],
): SnapshotCacheFlowGroup[] {
  const entryByKey = new Map(snapshotCache.entries.map((entry) => [entry.key, entry]));
  const entryKeysByUrl = new Map<string, string[]>();

  snapshotCache.entries.forEach((entry) => {
    const existing = entryKeysByUrl.get(entry.url) ?? [];
    existing.push(entry.key);
    entryKeysByUrl.set(entry.url, existing);
  });

  const activeEntry = snapshotCache.activeKey ? entryByKey.get(snapshotCache.activeKey) : undefined;
  const groups = new Map<string, SnapshotCacheFlowGroup>();
  const resolvedEvents = timeline
    .filter(isSnapshotCacheEvent)
    .map((event) => ({
      event,
      resolvedKey: resolveSnapshotCacheEventKey(
        event,
        entryKeysByUrl,
        snapshotCache.activeKey,
        activeEntry?.url ?? null,
      ),
    }))
    .filter((item): item is { event: BrowserDebugEvent; resolvedKey: string } => item.resolvedKey != null);

  resolvedEvents.forEach(({ event, resolvedKey }) => {
    const matchingEntry = entryByKey.get(resolvedKey);
    const parsedKey = parseSnapshotCacheKey(resolvedKey);
    const existing = groups.get(resolvedKey);
    const latestAt = existing ? Math.max(existing.latestAt, event.occurredAt) : event.occurredAt;
    const latestKind = !existing || event.occurredAt >= existing.latestAt ? event.kind : existing.latestKind;
    const latestReasonLabel = !existing || event.occurredAt >= existing.latestAt
      ? extractSnapshotCacheReasonLabel(event)
      : existing.latestReasonLabel;

    groups.set(resolvedKey, {
      key: resolvedKey,
      url: matchingEntry?.url ?? event.cacheUrl ?? existing?.url ?? null,
      navigationId: parsedKey?.navigationId ?? existing?.navigationId ?? null,
      isActive: snapshotCache.activeKey === resolvedKey,
      isPresent: matchingEntry != null,
      isInvalidated: matchingEntry?.invalidatedAt != null,
      createdAt: matchingEntry?.createdAt ?? existing?.createdAt ?? null,
      lastAccessedAt: matchingEntry?.lastAccessedAt ?? existing?.lastAccessedAt ?? null,
      accessCount: matchingEntry?.accessCount ?? existing?.accessCount ?? null,
      invalidatedAt: matchingEntry?.invalidatedAt ?? existing?.invalidatedAt ?? null,
      invalidationReason: matchingEntry?.invalidationReason ?? event.cacheReason ?? existing?.invalidationReason ?? null,
      latestAt,
      latestKind,
      latestReasonLabel,
      steps: existing?.steps ?? [],
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      steps: resolvedEvents
        .filter((item) => item.resolvedKey === group.key)
        .map((item) => item.event)
        .sort((left, right) => left.occurredAt - right.occurredAt)
        .slice(-5)
        .map((event) => ({
          id: event.id,
          label: formatSnapshotCacheFlowLabel(event),
          level: event.level,
        })),
    }))
    .sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }
      return right.latestAt - left.latestAt;
    })
    .slice(0, 4);
}

export function SnapshotBadge({
  className,
  children,
  strong = false,
}: {
  className: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] ${
        strong ? 'font-bold' : 'font-medium'
      } ${className}`}
    >
      {children}
    </span>
  );
}

export function SnapshotCacheKeyLabel({
  cacheKey,
  suffix,
  className,
}: {
  cacheKey: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={className} title={cacheKey}>
      {compactSnapshotCacheKey(cacheKey) ?? cacheKey}
      {suffix ?? ''}
    </span>
  );
}

export function SnapshotCacheReasonBadgePill({
  reasonLabel,
  reasonCode,
  fallback = 'other',
}: {
  reasonLabel: string | null;
  reasonCode?: string | null;
  fallback?: string;
}) {
  const normalizedReason = snapshotCacheReasonBadge(reasonLabel, reasonCode) ?? fallback;

  return (
    <SnapshotBadge className="border border-amber-500/30 bg-amber-500/10 text-amber-200">
      {normalizedReason}
    </SnapshotBadge>
  );
}

export function SnapshotCacheRelationLine({ relation }: { relation: SnapshotCacheRelationDescriptor }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <SnapshotBadge className={relation.badgeClass}>{relation.badge}</SnapshotBadge>
      <p className={`text-[10px] ${relation.textClass}`}>{relation.description}</p>
    </div>
  );
}