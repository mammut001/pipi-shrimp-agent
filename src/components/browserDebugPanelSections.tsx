/**
 * Section panels for BrowserDebugPanel.
 * Behavior-preserving extract (split-soon / <500 follow-up).
 */

import { Fragment, type CSSProperties } from 'react';

import {
  eventLevelBadgeClass,
  formatSnapshotCacheEventKind,
  snapshotCacheFlowStatus,
  snapshotCacheFlowStepClass,
  snapshotCachePageStateRelation,
  snapshotCacheReasonBadge,
  SnapshotCacheKeyLabel,
  SnapshotCacheReasonBadgePill,
  snapshotCacheTimelineEventMeta,
  SnapshotBadge,
  SnapshotCacheRelationLine,
  type SnapshotCacheFlowGroup,
} from '@/components/browserDebugSnapshotCache';
import {
  DebugCard,
  StatCell,
  formatDuration,
  formatRelativeTime,
  formatTimeout,
} from '@/components/browserDebugPanelUi';
import { t } from '@/i18n';
import type { BrowserConnectionStatePayload } from '@/store/browser/browserConnection';
import type {
  BrowserActionTrace,
  BrowserBenchmarkMetricSummary,
  BrowserBenchmarkReport,
  BrowserBenchmarkSample,
  BrowserCommandTrace,
  BrowserDebugEvent,
  BrowserDebugSessionInfo,
  BrowserPageStateSnapshot,
  BrowserSnapshotCacheState,
} from '@/types/browserObservability';

export function BrowserDebugPanelHeader({
  isUsingMockData,
  onRefresh,
}: {
  isUsingMockData: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-3 py-2 backdrop-blur">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Browser Debug</p>
        <p className="text-[11px] text-slate-400">
          {isUsingMockData ? 'Mock-backed rollout scaffold' : 'Live observability from UI/store wiring'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${
          isUsingMockData ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
        }`}>
          {isUsingMockData ? 'Mock' : 'Live'}
        </span>
        <button
          onClick={onRefresh}
          className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors hover:border-cyan-400 hover:text-cyan-200"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

export function SessionDebugCard({ session }: { session: BrowserDebugSessionInfo }) {
  return (
    <DebugCard title="Session">
      <div className="grid grid-cols-2 gap-2">
        <StatCell label="Mode" value={session.mode} />
        <StatCell label="WS Status" value={session.wsStatus} />
        <StatCell label="Current Target" value={session.currentTarget} />
        <StatCell label="Last Ping" value={formatRelativeTime(session.lastHealthPingAt)} />
        <StatCell label="Session ID" value={session.sessionId ?? 'n/a'} />
        <StatCell label="Target ID" value={session.targetId ?? 'n/a'} />
      </div>
      <div className="mt-3 space-y-2 text-[11px] text-slate-300">
        <div>
          <span className="text-slate-500">URL</span>
          <p className="mt-1 break-all text-slate-100">{session.currentUrl ?? 'n/a'}</p>
        </div>
        <div>
          <span className="text-slate-500">WebSocket</span>
          <p className="mt-1 break-all text-slate-100">{session.websocketUrl ?? 'n/a'}</p>
        </div>
        {session.lastError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-200">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-red-300">Last Error</p>
            <p className="mt-1 break-words text-[11px]">{session.lastError}</p>
          </div>
        )}
      </div>
    </DebugCard>
  );
}

export function CdpRawStateDebugCard({
  connectionState,
  lastSyncedAt,
}: {
  connectionState: BrowserConnectionStatePayload | null;
  lastSyncedAt: number | null;
}) {
  return (
    <DebugCard title="CDP Raw State">
      <div className="grid grid-cols-2 gap-2">
        <StatCell label="Launch Mode" value={connectionState?.launch_mode ?? 'n/a'} />
        <StatCell label="Health" value={connectionState?.health_status ?? 'n/a'} />
        <StatCell label="Failures" value={connectionState?.health_failures ?? 0} />
        <StatCell label="Last Sync" value={formatRelativeTime(lastSyncedAt)} />
        <StatCell label="Last Activity" value={formatRelativeTime(connectionState?.last_activity_at_ms ?? null)} />
        <StatCell label="Idle Timeout" value={formatTimeout(connectionState?.idle_timeout_ms ?? null)} />
      </div>
      <div className="mt-3 space-y-2 text-[11px] text-slate-300">
        <div>
          <span className="text-slate-500">Current URL</span>
          <p className="mt-1 break-all text-slate-100">{connectionState?.current_url ?? 'n/a'}</p>
        </div>
        <div>
          <span className="text-slate-500">Last Transition</span>
          <p className="mt-1 text-slate-100">{formatRelativeTime(connectionState?.health_last_transition_at_ms ?? null)}</p>
        </div>
      </div>
    </DebugCard>
  );
}

export function EventTimelineDebugCard({
  visibleTimeline,
  latestPageState,
  onClear,
}: {
  visibleTimeline: BrowserDebugEvent[];
  latestPageState: BrowserPageStateSnapshot | null;
  onClear: () => void;
}) {
  return (
    <DebugCard title="Event Timeline">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-400">Newest events first</p>
        <button
          onClick={onClear}
          className="text-[10px] font-medium text-slate-400 transition-colors hover:text-slate-200"
        >
          Clear
        </button>
      </div>
      {visibleTimeline.length === 0 ? (
        <p className="text-[11px] text-slate-500">No events yet.</p>
      ) : (
        <div className="space-y-2">
          {visibleTimeline.map((event) => {
            const snapshotMeta = snapshotCacheTimelineEventMeta(event, latestPageState);

            return (
              <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium text-slate-100">{event.title}</p>
                    {snapshotMeta ? (
                      <>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <SnapshotBadge className={eventLevelBadgeClass(event.level)} strong>
                            {snapshotMeta.kindLabel}
                          </SnapshotBadge>
                          {snapshotMeta.relation && (
                            <SnapshotBadge className={snapshotMeta.relation.badgeClass}>
                              {snapshotMeta.relation.badge}
                            </SnapshotBadge>
                          )}
                          {snapshotMeta.reasonBadge && (
                            <SnapshotCacheReasonBadgePill
                              reasonLabel={snapshotMeta.reasonBadge}
                              reasonCode={snapshotMeta.reasonBadge}
                            />
                          )}
                        </div>
                        {snapshotMeta.entrySummary && (
                          <p className="mt-1 text-[10px] text-slate-300">{snapshotMeta.entrySummary}</p>
                        )}
                        {snapshotMeta.compactCacheKey && (
                          <p className="mt-1 break-words text-[10px] text-slate-400">
                            cache key{' '}
                            <SnapshotCacheKeyLabel
                              cacheKey={snapshotMeta.cacheKey ?? snapshotMeta.compactCacheKey}
                              className="text-[10px] text-slate-400"
                            />
                          </p>
                         )}
                        {snapshotMeta.cacheUrl && (
                          <p className="mt-1 break-all text-[10px] text-slate-500">cache url {snapshotMeta.cacheUrl}</p>
                        )}
                        {snapshotMeta.relation && (
                          <SnapshotCacheRelationLine relation={snapshotMeta.relation} />
                        )}
                      </>
                    ) : (
                      event.detail && <p className="mt-1 break-words text-[10px] text-slate-400">{event.detail}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] ${eventLevelBadgeClass(event.level)}`}>
                      {snapshotMeta?.kindLabel ?? event.kind}
                    </span>
                    <p className="mt-1 text-[9px] text-slate-500">{formatRelativeTime(event.occurredAt)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DebugCard>
  );
}

export function RecentCommandsDebugCard({
  visibleCommands,
}: {
  visibleCommands: BrowserCommandTrace[];
}) {
  return (
    <DebugCard title="Recent Commands">
      {visibleCommands.length === 0 ? (
        <p className="text-[11px] text-slate-500">No command traces yet.</p>
      ) : (
        <div className="space-y-2">
          {visibleCommands.map((command) => (
            <div key={command.id} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-slate-100">{command.method}</p>
                  {command.summary && <p className="mt-1 text-[10px] text-slate-400">{command.summary}</p>}
                  {command.error && <p className="mt-1 text-[10px] text-red-300">{command.error}</p>}
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-medium text-slate-100">{formatDuration(command.durationMs)}</p>
                  <p className={`mt-1 text-[9px] uppercase tracking-[0.16em] ${
                    command.status === 'error'
                      ? 'text-red-300'
                      : command.status === 'success'
                        ? 'text-emerald-300'
                        : 'text-cyan-300'
                  }`}>
                    {command.status}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DebugCard>
  );
}

export function BenchmarksDebugCard({
  benchmarkReport,
  visibleBenchmarkMetrics,
  visibleBenchmarkSamples,
  isSavingBenchmarkReport,
  isExportingBenchmarks,
  benchmarkSaveStatus,
  benchmarkExportStatus,
  currentWorkDir,
  onSave,
  onExport,
}: {
  benchmarkReport: BrowserBenchmarkReport | null;
  visibleBenchmarkMetrics: BrowserBenchmarkMetricSummary[];
  visibleBenchmarkSamples: BrowserBenchmarkSample[];
  isSavingBenchmarkReport: boolean;
  isExportingBenchmarks: boolean;
  benchmarkSaveStatus: 'idle' | 'saved' | 'error';
  benchmarkExportStatus: 'idle' | 'copied' | 'error';
  currentWorkDir: string | null;
  onSave: () => void;
  onExport: () => void;
}) {
  return (
    <DebugCard title="Benchmarks">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-400">Backend benchmark aggregation and markdown export.</p>
        <div className="flex items-center gap-2">
          <button
            onClick={onSave}
            disabled={isSavingBenchmarkReport || !currentWorkDir}
            className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            title={currentWorkDir ? 'Save benchmark markdown into docs and artifacts' : 'Bind a session workDir to persist benchmark reports'}
          >
            {isSavingBenchmarkReport ? 'Saving...' : benchmarkSaveStatus === 'saved' ? 'Saved' : 'Save Report'}
          </button>
          <button
            onClick={onExport}
            disabled={isExportingBenchmarks}
            className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isExportingBenchmarks ? 'Copying...' : benchmarkExportStatus === 'copied' ? 'Copied' : 'Copy Markdown'}
          </button>
        </div>
      </div>

      {benchmarkSaveStatus === 'saved' && (
        <p className="mb-3 text-[10px] text-emerald-300">Saved to the session docs and opened in the artifact preview flow.</p>
      )}

      {benchmarkSaveStatus === 'error' && (
        <p className="mb-3 text-[10px] text-amber-300">Save failed. The current session needs a valid workDir before benchmark reports can be persisted.</p>
      )}

      {benchmarkExportStatus === 'error' && (
        <p className="mb-3 text-[10px] text-amber-300">Copy failed. Benchmark markdown is still available through the backend export command.</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <StatCell label="Samples" value={benchmarkReport?.total_samples ?? 0} />
        <StatCell label="Generated" value={formatRelativeTime(benchmarkReport?.generated_at_ms ?? null)} />
      </div>
      {visibleBenchmarkMetrics.length === 0 ? (
        <p className="mt-3 text-[11px] text-slate-500">No benchmark samples yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {visibleBenchmarkMetrics.map((metric) => (
            <div key={metric.key} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-slate-100">{metric.label}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    samples {metric.sample_count} · success {metric.success_count} · failure {metric.failure_count}
                  </p>
                </div>
                <div className="text-right text-[10px] text-slate-400">
                  <p>avg {formatDuration(metric.average_duration_ms ?? undefined)}</p>
                  <p className="mt-1">max {formatDuration(metric.max_duration_ms ?? undefined)}</p>
                  {metric.budget_ms != null && (
                    <p className={`mt-1 ${metric.over_budget_count > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      budget {metric.budget_ms}ms
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {visibleBenchmarkSamples.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Recent Samples</p>
          {visibleBenchmarkSamples.map((sample) => (
            <div key={sample.id} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-slate-100">{sample.label}</p>
                  {(sample.detail || sample.error) && (
                    <p className="mt-1 break-words text-[10px] text-slate-400">{sample.error ?? sample.detail}</p>
                  )}
                </div>
                <div className="text-right text-[10px] text-slate-400">
                  <p>{formatDuration(sample.duration_ms)}</p>
                  <p className="mt-1">{sample.launch_mode ?? 'n/a'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DebugCard>
  );
}

export type PageStateHighlight = {
  element: NonNullable<BrowserPageStateSnapshot['elements']>[number];
  style: CSSProperties;
};

export function LatestPageStateDebugCard({
  latestPageState,
  visibleElements,
  latestPageStateScreenshotUrl,
  latestPageStateHasScreenshot,
  latestPageStateScreenshotAspectRatio,
  latestPageStateHighlights,
}: {
  latestPageState: BrowserPageStateSnapshot | null;
  visibleElements: NonNullable<BrowserPageStateSnapshot['elements']>;
  latestPageStateScreenshotUrl: string | null;
  latestPageStateHasScreenshot: boolean;
  latestPageStateScreenshotAspectRatio: string | undefined;
  latestPageStateHighlights: PageStateHighlight[];
}) {
  return (
    <DebugCard title="Latest Page State">
      {latestPageState ? (
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-medium text-slate-100">{latestPageState.title}</p>
            <p className="mt-1 break-all text-[10px] text-slate-400">{latestPageState.url}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StatCell label="Navigation ID" value={latestPageState.navigationId} />
            <StatCell label="DOM Version" value={latestPageState.domVersion} />
          </div>

          {latestPageState.viewport && (
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Screenshot Preview</p>
                <p className="text-[10px] text-slate-500">
                  Viewport {Math.round(latestPageState.viewport.width)}x{Math.round(latestPageState.viewport.height)}
                </p>
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70">
                {latestPageStateScreenshotUrl ? (
                  <div
                    className="relative mx-auto w-full max-w-full bg-slate-950/80"
                    style={latestPageStateScreenshotAspectRatio ? { aspectRatio: latestPageStateScreenshotAspectRatio } : undefined}
                  >
                    <img
                      src={latestPageStateScreenshotUrl}
                      alt={`PageState screenshot for ${latestPageState.title}`}
                      className="absolute inset-0 block h-full w-full object-contain"
                      draggable={false}
                    />
                    <div className="pointer-events-none absolute inset-0">
                      {latestPageStateHighlights.map(({ element, style }) => (
                        <div
                          key={`highlight-${element.id}`}
                          className="absolute rounded border border-cyan-300/80 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]"
                          style={style}
                        >
                          <span className="absolute -left-px -top-5 rounded bg-cyan-300 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">
                            #{element.index ?? '?'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-32 items-center justify-center px-4 py-8 text-center text-[11px] text-slate-400">
                    {latestPageStateHasScreenshot ? t('screenshot.invalid') : t('screenshot.unavailable')}
                  </div>
                )}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Highlighted {latestPageStateHighlights.length} interactive elements with captured bounds.
              </p>
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Warnings</p>
            {latestPageState.warnings.length === 0 ? (
              <p className="mt-2 text-[11px] text-slate-500">No warnings.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {latestPageState.warnings.map((warning) => (
                  <div
                    key={warning.id}
                    className={`rounded-lg border px-3 py-2 text-[10px] ${
                      warning.severity === 'error'
                        ? 'border-red-500/20 bg-red-500/10 text-red-200'
                        : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                    }`}
                  >
                    {warning.message}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Top Elements</p>
            <div className="mt-2 space-y-2">
              {visibleElements.map((element) => (
                <div key={element.id} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium text-slate-100">{element.label}</p>
                      {element.selector && <p className="mt-1 text-[10px] text-slate-400">{element.selector}</p>}
                      {(element.index != null || element.backendNodeId != null) && (
                        <p className="mt-1 text-[10px] text-slate-500">
                          #{element.index ?? 'n/a'} · backend_node_id {element.backendNodeId ?? 'n/a'}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-[10px] text-slate-400">
                      <p>{element.role}</p>
                      {element.status && <p className="mt-1 text-slate-500">{element.status}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">No page state snapshot yet.</p>
      )}
    </DebugCard>
  );
}

export function SnapshotCacheDebugCard({
  snapshotCache,
  snapshotCacheFlowGroups,
  visibleCacheEntries,
  latestPageState,
}: {
  snapshotCache: BrowserSnapshotCacheState;
  snapshotCacheFlowGroups: SnapshotCacheFlowGroup[];
  visibleCacheEntries: BrowserSnapshotCacheState['entries'];
  latestPageState: BrowserPageStateSnapshot | null;
}) {
  return (
    <DebugCard title="Snapshot Cache">
      <div className="grid grid-cols-2 gap-2">
        <StatCell
          label="Active Key"
          value={snapshotCache.activeKey ? (
            <SnapshotCacheKeyLabel cacheKey={snapshotCache.activeKey} />
          ) : 'n/a'}
        />
        <StatCell
          label="Entries"
          value={`${snapshotCache.entries.length}${snapshotCache.entryLimit ? ` / ${snapshotCache.entryLimit}` : ''}`}
        />
        <StatCell label="Hits" value={snapshotCache.hitCount} />
        <StatCell label="Misses" value={snapshotCache.missCount} />
        <StatCell label="Evictions" value={snapshotCache.evictionCount} />
        <StatCell label="Invalidations" value={snapshotCache.invalidationCount} />
      </div>
      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Recent Lifecycle</p>
          <p className="text-[10px] text-slate-500">Grouped by cache key</p>
        </div>
        {snapshotCacheFlowGroups.length === 0 ? (
          <p className="text-[11px] text-slate-500">No cache lifecycle events yet.</p>
        ) : (
          <div className="space-y-2">
            {snapshotCacheFlowGroups.map((group) => {
              const status = snapshotCacheFlowStatus(group);
              const accessCountLabel = group.accessCount != null ? `${group.accessCount}x` : 'n/a';
              const lastAccessedLabel = group.lastAccessedAt
                ? formatRelativeTime(group.lastAccessedAt)
                : group.isPresent
                  ? 'Never'
                  : 'not cached';
              const capturedLabel = group.createdAt
                ? formatRelativeTime(group.createdAt)
                : group.isPresent
                  ? 'n/a'
                  : 'not cached';
              const latestPageStateLabel = latestPageState
                ? `${latestPageState.title} · ${latestPageState.navigationId}`
                : 'n/a';
              const pageStateRelation = snapshotCachePageStateRelation(group, latestPageState);
              const invalidationBadge = snapshotCacheReasonBadge(
                group.latestReasonLabel,
                group.invalidationReason,
              );

              return (
                <div key={`snapshot-cache-flow-${group.key}`} className={`rounded-lg border px-3 py-2 ${status.cardClass}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] ${status.badgeClass}`}>
                          {status.label}
                        </span>
                        {status.accentBadge && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] ${status.accentClass ?? 'text-slate-300'}`}>
                            {status.accentBadge}
                          </span>
                        )}
                      </div>
                      <div className="mt-1">
                        <SnapshotCacheKeyLabel
                          cacheKey={group.key}
                          className="break-words text-[11px] font-medium text-slate-100"
                        />
                      </div>
                      {group.url && <p className="mt-1 break-all text-[10px] text-slate-400">{group.url}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Latest {formatSnapshotCacheEventKind(group.latestKind)}</p>
                      <p className="mt-1 shrink-0 text-[9px] text-slate-500">{formatRelativeTime(group.latestAt)}</p>
                    </div>
                  </div>

                  <div className="mt-2 rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Entry Nav</p>
                        <p className="mt-1 text-[10px] font-medium text-slate-100">{group.navigationId ?? 'n/a'}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Latest PageState</p>
                        <p className="mt-1 break-words text-[10px] font-medium text-slate-100">{latestPageStateLabel}</p>
                      </div>
                    </div>
                    <SnapshotCacheRelationLine relation={pageStateRelation} />
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Access Count</p>
                      <p className="mt-1 text-[10px] font-medium text-slate-100">{accessCountLabel}</p>
                    </div>
                    <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Last Access</p>
                      <p className="mt-1 text-[10px] font-medium text-slate-100">{lastAccessedLabel}</p>
                    </div>
                    <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Captured</p>
                      <p className="mt-1 text-[10px] font-medium text-slate-100">{capturedLabel}</p>
                    </div>
                  </div>

                  {group.invalidatedAt && group.latestKind !== 'snapshot_cache_evict' && (
                    <p className="mt-2 text-[10px] text-amber-300">
                      Invalidated {formatRelativeTime(group.invalidatedAt)}
                      {invalidationBadge ? ` · ${invalidationBadge}` : ''}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {group.steps.map((step, index) => (
                      <Fragment key={step.id}>
                        {index > 0 && <span className="text-[9px] text-slate-600">-&gt;</span>}
                        <span className={snapshotCacheFlowStepClass(step.level, {
                          isTerminal: index === group.steps.length - 1,
                          kind: index === group.steps.length - 1 ? group.latestKind : undefined,
                        })}>
                          {step.label}
                        </span>
                      </Fragment>
                    ))}
                  </div>

                  {status.label === 'Evicted' && (
                    <p className="mt-2 text-[10px] text-rose-300">Entry no longer present in cache.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Entries</p>
        {visibleCacheEntries.length === 0 ? (
          <p className="text-[11px] text-slate-500">Cache is empty.</p>
        ) : (
          visibleCacheEntries.map((entry) => (
            <div key={entry.key} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SnapshotCacheKeyLabel
                    cacheKey={entry.key}
                    suffix={snapshotCache.activeKey === entry.key ? ' (active)' : undefined}
                    className="break-words text-[11px] font-medium text-slate-100"
                  />
                  <p className="mt-1 break-all text-[10px] text-slate-400">{entry.url}</p>
                </div>
                <div className="text-right text-[10px] text-slate-400">
                  <p>{entry.accessCount}x</p>
                  <p className="mt-1">{formatRelativeTime(entry.lastAccessedAt)}</p>
                </div>
              </div>
              {entry.invalidatedAt && (
                <div className="mt-2 flex items-center gap-2 text-[10px] text-amber-300">
                  <span>invalidated</span>
                  <SnapshotCacheReasonBadgePill
                    reasonLabel={entry.invalidationReason ?? null}
                    reasonCode={entry.invalidationReason}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </DebugCard>
  );
}

export function RecentActionsDebugCard({
  visibleActions,
}: {
  visibleActions: BrowserActionTrace[];
}) {
  return (
    <DebugCard title="Recent Actions">
      {visibleActions.length === 0 ? (
        <p className="text-[11px] text-slate-500">No action records yet.</p>
      ) : (
        <div className="space-y-2">
          {visibleActions.map((action) => (
            <div key={action.id} className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium text-slate-100">{action.name}</p>
                  {action.detail && <p className="mt-1 break-words text-[10px] text-slate-400">{action.detail}</p>}
                </div>
                <div className="text-right">
                  <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${
                    action.status === 'failed'
                      ? 'text-red-300'
                      : action.status === 'completed'
                        ? 'text-emerald-300'
                        : 'text-cyan-300'
                  }`}>
                    {action.status}
                  </p>
                  <p className="mt-1 text-[9px] text-slate-500">{formatRelativeTime(action.createdAt)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DebugCard>
  );
}

