import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from '@jest/globals';

import {
  buildSnapshotCacheFlowGroups,
  compactSnapshotCacheKey,
  SnapshotCacheKeyLabel,
  snapshotCachePageStateRelation,
  SnapshotCacheReasonBadgePill,
  snapshotCacheTimelineEventMeta,
} from '@/components/browserDebugSnapshotCache';
import type { BrowserDebugEvent, BrowserPageStateSnapshot, BrowserSnapshotCacheState } from '@/types/browserObservability';

function pageState(overrides: Partial<BrowserPageStateSnapshot> = {}): BrowserPageStateSnapshot {
  return {
    id: 'snapshot-current',
    cacheKey: 'target-1:nav-43:mini:dom-2',
    url: 'https://example.com/next',
    title: 'Next Page',
    warnings: [],
    elements: [],
    createdAt: 1_000,
    navigationId: 'nav-43',
    domVersion: 'dom-2',
    viewportSignature: 'mini',
    source: 'backend',
    ...overrides,
  };
}

function snapshotCache(overrides: Partial<BrowserSnapshotCacheState> = {}): BrowserSnapshotCacheState {
  return {
    activeKey: 'target-1:nav-43:mini:dom-2',
    entries: [
      {
        key: 'target-1:nav-43:mini:dom-2',
        url: 'https://example.com/next',
        snapshotId: 'snapshot-current',
        createdAt: 1_000,
        lastAccessedAt: 1_300,
        accessCount: 3,
        source: 'backend',
      },
      {
        key: 'target-1:nav-42:mini:dom-1',
        url: 'https://example.com/dashboard',
        snapshotId: 'snapshot-previous',
        createdAt: 700,
        lastAccessedAt: 1_100,
        accessCount: 2,
        invalidatedAt: 1_400,
        invalidationReason: 'cdp_frame_navigated',
        source: 'backend',
      },
      {
        key: 'target-1:nav-43:mini:dom-legacy',
        url: 'https://example.com/next',
        snapshotId: 'snapshot-legacy',
        createdAt: 650,
        lastAccessedAt: 1_050,
        accessCount: 1,
        source: 'backend',
      },
    ],
    hitCount: 2,
    missCount: 2,
    evictionCount: 1,
    invalidationCount: 1,
    ...overrides,
  };
}

function event(overrides: Partial<BrowserDebugEvent> & Pick<BrowserDebugEvent, 'id' | 'kind' | 'title' | 'level' | 'occurredAt'>): BrowserDebugEvent {
  return {
    detail: undefined,
    source: 'backend',
    ...overrides,
  };
}

describe('browserDebugSnapshotCache', () => {
  it('builds per-key lifecycle flows from snapshot cache state and timeline events', () => {
    const state = snapshotCache();
    const timeline = [
      event({
        id: 'event-1',
        kind: 'snapshot_cache_miss',
        title: 'Snapshot cache miss',
        level: 'info',
        occurredAt: 1_200,
        cacheKey: 'target-1:nav-43:mini:dom-2',
        cacheUrl: 'https://example.com/next',
      }),
      event({
        id: 'event-2',
        kind: 'snapshot_cache_store',
        title: 'Snapshot cache stored',
        level: 'success',
        occurredAt: 1_250,
        cacheKey: 'target-1:nav-43:mini:dom-2',
        cacheUrl: 'https://example.com/next',
      }),
      event({
        id: 'event-3',
        kind: 'snapshot_cache_hit',
        title: 'Snapshot cache hit',
        level: 'success',
        occurredAt: 1_300,
        cacheKey: 'target-1:nav-43:mini:dom-2',
        cacheUrl: 'https://example.com/next',
      }),
      event({
        id: 'event-4',
        kind: 'snapshot_cache_hit',
        title: 'Snapshot cache hit',
        level: 'success',
        occurredAt: 1_100,
        cacheKey: 'target-1:nav-42:mini:dom-1',
        cacheUrl: 'https://example.com/dashboard',
      }),
      event({
        id: 'event-5',
        kind: 'snapshot_cache_invalidate',
        title: 'Snapshot cache invalidated',
        detail: 'frameNavigated | https://example.com/dashboard',
        level: 'warning',
        occurredAt: 1_400,
        cacheKey: 'target-1:nav-42:mini:dom-1',
        cacheUrl: 'https://example.com/dashboard',
        cacheReason: 'cdp_frame_navigated',
      }),
      event({
        id: 'event-6',
        kind: 'snapshot_cache_store',
        title: 'Snapshot cache stored',
        level: 'success',
        occurredAt: 1_050,
        cacheKey: 'target-1:nav-43:mini:dom-legacy',
        cacheUrl: 'https://example.com/next',
      }),
      event({
        id: 'event-7',
        kind: 'snapshot_cache_evict',
        title: 'Snapshot cache evicted',
        detail: 'target-1:nav-41:mini:dom-old | https://example.com/previous',
        level: 'warning',
        occurredAt: 1_500,
        cacheUrl: 'https://example.com/previous',
      }),
    ];

    const groups = buildSnapshotCacheFlowGroups(state, timeline);

    expect(groups).toHaveLength(4);
    expect(groups[0]).toMatchObject({
      key: 'target-1:nav-43:mini:dom-2',
      isActive: true,
      latestKind: 'snapshot_cache_hit',
      isPresent: true,
      isInvalidated: false,
    });
    expect(groups[0].steps.map((step) => step.label)).toEqual(['miss', 'store', 'hit']);

    const invalidatedGroup = groups.find((group) => group.key === 'target-1:nav-42:mini:dom-1');
    expect(invalidatedGroup).toMatchObject({
      isInvalidated: true,
      latestKind: 'snapshot_cache_invalidate',
      latestReasonLabel: 'frameNavigated',
      invalidationReason: 'cdp_frame_navigated',
      navigationId: 'nav-42',
    });
    expect(invalidatedGroup?.steps.map((step) => step.label)).toEqual(['hit', 'invalidate: frameNavigated']);

    const evictedGroup = groups.find((group) => group.key === 'target-1:nav-41:mini:dom-old');
    expect(evictedGroup).toMatchObject({
      isPresent: false,
      latestKind: 'snapshot_cache_evict',
      navigationId: 'nav-41',
      url: 'https://example.com/previous',
    });
  });

  it('classifies page-state relations with stable taxonomy badges', () => {
    const latest = pageState();

    expect(snapshotCachePageStateRelation({ key: latest.cacheKey, navigationId: latest.navigationId }, latest)).toMatchObject({
      badge: 'current-entry',
      description: 'Current PageState is derived from this cache entry.',
    });

    expect(snapshotCachePageStateRelation({ key: 'target-1:nav-43:mini:dom-legacy', navigationId: 'nav-43' }, latest)).toMatchObject({
      badge: 'same-nav',
      description: 'Current PageState shares nav-43 but uses a different cache entry.',
    });

    expect(snapshotCachePageStateRelation({ key: 'target-1:nav-42:mini:dom-1', navigationId: 'nav-42' }, latest)).toMatchObject({
      badge: 'newer-nav',
      description: 'Current PageState advanced to nav-43.',
    });

    expect(snapshotCachePageStateRelation({ key: 'target-1:nav-44:mini:dom-3', navigationId: 'nav-44' }, latest)).toMatchObject({
      badge: 'older-nav',
      description: 'Current PageState is behind nav-44.',
    });

    expect(snapshotCachePageStateRelation({ key: 'target-2:unknown:wide:dom-x', navigationId: 'nav-x' }, latest)).toMatchObject({
      badge: 'different-entry',
      description: 'Current PageState uses nav-43.',
    });

    expect(snapshotCachePageStateRelation({ key: 'target-1:nav-42:mini:dom-1', navigationId: 'nav-42' }, null)).toMatchObject({
      badge: 'no-page-state',
      description: 'No current PageState available.',
    });
  });

  it('compacts cache keys for timeline display while preserving full-key fallbacks', () => {
    expect(compactSnapshotCacheKey('target-1:nav-42:mini:dom-1')).toBe('target-1 · nav-42 · mini · dom-1');
    expect(compactSnapshotCacheKey('opaque-cache-key')).toBe('opaque-cache-key');
    expect(compactSnapshotCacheKey(null)).toBeNull();
  });

  it('derives compact timeline metadata with normalized reason badges and relation taxonomy', () => {
    const latest = pageState();
    const invalidateMeta = snapshotCacheTimelineEventMeta(
      event({
        id: 'event-8',
        kind: 'snapshot_cache_invalidate',
        title: 'Snapshot cache invalidated',
        detail: 'domDocumentUpdated | https://example.com/dashboard',
        level: 'warning',
        occurredAt: 1_600,
        cacheKey: 'target-1:nav-42:mini:dom-1',
        cacheUrl: 'https://example.com/dashboard',
        cacheReason: 'cdp_dom_document_updated',
      }),
      latest,
    );

    expect(invalidateMeta).toMatchObject({
      kindLabel: 'invalidate',
      cacheKey: 'target-1:nav-42:mini:dom-1',
      compactCacheKey: 'target-1 · nav-42 · mini · dom-1',
      cacheUrl: 'https://example.com/dashboard',
      entrySummary: 'entry nav-42 · invalidate · dom-1',
      reasonBadge: 'dom-update',
      relation: {
        badge: 'newer-nav',
        description: 'Current PageState advanced to nav-43.',
      },
    });

    const evictMeta = snapshotCacheTimelineEventMeta(
      event({
        id: 'event-9',
        kind: 'snapshot_cache_evict',
        title: 'Snapshot cache evicted',
        detail: 'target-1:nav-41:mini:dom-old | https://example.com/previous',
        level: 'warning',
        occurredAt: 1_700,
        cacheUrl: 'https://example.com/previous',
      }),
      latest,
    );

    expect(evictMeta).toMatchObject({
      kindLabel: 'evict',
      cacheKey: 'target-1:nav-41:mini:dom-old',
      compactCacheKey: 'target-1 · nav-41 · mini · dom-old',
      entrySummary: 'entry nav-41 · evict · dom-old',
      reasonBadge: null,
      relation: {
        badge: 'newer-nav',
      },
    });

    expect(
      snapshotCacheTimelineEventMeta(
        event({
          id: 'event-10',
          kind: 'navigation',
          title: 'Navigation',
          level: 'info',
          occurredAt: 1_800,
        }),
        latest,
      ),
    ).toBeNull();
  });

  it('renders compact key labels and normalized reason pills as standalone snapshot-cache primitives', () => {
    const keyMarkup = renderToStaticMarkup(
      createElement(SnapshotCacheKeyLabel, {
        cacheKey: 'target-1:nav-43:mini:dom-2',
        suffix: ' (active)',
        className: 'key-text',
      }),
    );

    expect(keyMarkup).toContain('target-1 · nav-43 · mini · dom-2 (active)');
    expect(keyMarkup).toContain('title="target-1:nav-43:mini:dom-2"');
    expect(keyMarkup).toContain('class="key-text"');

    const reasonMarkup = renderToStaticMarkup(
      createElement(SnapshotCacheReasonBadgePill, {
        reasonLabel: 'frameNavigated',
        reasonCode: 'cdp_frame_navigated',
      }),
    );

    expect(reasonMarkup).toContain('frame-nav');
    expect(reasonMarkup).not.toContain('cdp_frame_navigated');

    const fallbackReasonMarkup = renderToStaticMarkup(
      createElement(SnapshotCacheReasonBadgePill, {
        reasonLabel: null,
        reasonCode: null,
      }),
    );

    expect(fallbackReasonMarkup).toContain('other');
  });
});