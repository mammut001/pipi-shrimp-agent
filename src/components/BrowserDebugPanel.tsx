import { Fragment, useMemo, useState, type CSSProperties } from 'react';

import {
  buildSnapshotCacheFlowGroups,
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
} from '@/components/browserDebugSnapshotCache';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { useChatStore } from '@/store/chatStore';
import { useCdpStore } from '@/store/cdpStore';
import type { BrowserElementBounds, BrowserPageViewport, BrowserScreenshotRef } from '@/types/browserPageState';
import { saveBrowserBenchmarkArtifact } from '@/services/browserBenchmarkArtifacts';
import { exportBrowserBenchmarkReport } from '@/utils/browserObservabilityClient';

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) {
    return 'Never';
  }

  const diffMs = Date.now() - timestamp;
  if (diffMs < 1_000) {
    return 'Just now';
  }
  if (diffMs < 60_000) {
    return `${Math.floor(diffMs / 1_000)}s ago`;
  }
  if (diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)}m ago`;
  }
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(durationMs?: number): string {
  if (durationMs == null) {
    return 'pending';
  }
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1_000).toFixed(2)}s`;
}

function formatTimeout(timeoutMs?: number | null): string {
  if (timeoutMs == null) {
    return 'n/a';
  }
  if (timeoutMs < 1_000) {
    return `${timeoutMs}ms`;
  }
  return `${Math.round(timeoutMs / 1_000)}s`;
}

function browserScreenshotUrl(screenshot?: BrowserScreenshotRef | null): string | null {
  if (!screenshot?.value) {
    return null;
  }

  if (screenshot.kind === 'base64_png') {
    return `data:image/png;base64,${screenshot.value}`;
  }

  if (screenshot.kind === 'data_url') {
    return screenshot.value;
  }

  return null;
}

function viewportHighlightStyle(
  bounds: BrowserElementBounds | null | undefined,
  viewport: BrowserPageViewport | null | undefined,
): CSSProperties | null {
  if (!bounds || !viewport || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  const left = ((bounds.x - viewport.page_x) / viewport.width) * 100;
  const top = ((bounds.y - viewport.page_y) / viewport.height) * 100;
  const width = (bounds.width / viewport.width) * 100;
  const height = (bounds.height / viewport.height) * 100;

  const clippedLeft = Math.max(0, Math.min(100, left));
  const clippedTop = Math.max(0, Math.min(100, top));
  const clippedWidth = Math.max(0, Math.min(100 - clippedLeft, width));
  const clippedHeight = Math.max(0, Math.min(100 - clippedTop, height));

  if (clippedWidth <= 0 || clippedHeight <= 0) {
    return null;
  }

  return {
    left: `${clippedLeft}%`,
    top: `${clippedTop}%`,
    width: `${clippedWidth}%`,
    height: `${clippedHeight}%`,
  };
}

function DebugCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80">
      <div className="border-b border-slate-800 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</p>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 break-all text-[11px] font-medium text-slate-100">{value}</p>
    </div>
  );
}

export function BrowserDebugPanel() {
  const [isExportingBenchmarks, setIsExportingBenchmarks] = useState(false);
  const [benchmarkExportStatus, setBenchmarkExportStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [isSavingBenchmarkReport, setIsSavingBenchmarkReport] = useState(false);
  const [benchmarkSaveStatus, setBenchmarkSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const {
    isUsingMockData,
    session,
    timeline,
    recentCommands,
    recentActions,
    latestPageState,
    snapshotCache,
    benchmarkReport,
    clearTimeline,
  } = useBrowserObservabilityStore();
  const syncConnectionState = useCdpStore((state) => state.syncConnectionState);
  const connectionState = useCdpStore((state) => state.connectionState);
  const lastSyncedAt = useCdpStore((state) => state.lastSyncedAt);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const currentSession = useChatStore((state) => state.currentSession());

  const visibleTimeline = useMemo(() => timeline.slice(0, 10), [timeline]);
  const visibleCommands = useMemo(() => recentCommands.slice(0, 6), [recentCommands]);
  const visibleActions = useMemo(() => recentActions.slice(0, 6), [recentActions]);
  const visibleElements = useMemo(() => latestPageState?.elements.slice(0, 8) ?? [], [latestPageState]);
  const visibleCacheEntries = useMemo(() => snapshotCache.entries.slice(0, 5), [snapshotCache.entries]);
  const snapshotCacheFlowGroups = useMemo(
    () => buildSnapshotCacheFlowGroups(snapshotCache, timeline),
    [snapshotCache, timeline],
  );
  const visibleBenchmarkMetrics = useMemo(() => benchmarkReport?.metrics.slice(0, 6) ?? [], [benchmarkReport]);
  const visibleBenchmarkSamples = useMemo(() => benchmarkReport?.recent_samples.slice(0, 4) ?? [], [benchmarkReport]);
  const latestPageStateScreenshotUrl = useMemo(
    () => browserScreenshotUrl(latestPageState?.screenshot),
    [latestPageState?.screenshot],
  );
  const latestPageStateHighlights = useMemo(() => {
    if (!latestPageState?.viewport) {
      return [];
    }

    return visibleElements
      .map((element) => ({
        element,
        style: viewportHighlightStyle(element.bounds, latestPageState.viewport),
      }))
      .filter(
        (entry): entry is { element: (typeof visibleElements)[number]; style: CSSProperties } => entry.style != null,
      )
      .slice(0, 6);
  }, [latestPageState?.viewport, visibleElements]);
  const currentWorkDir = currentSession?.workDir ?? null;

  const handleExportBenchmarks = async () => {
    setIsExportingBenchmarks(true);
    setBenchmarkExportStatus('idle');

    try {
      const markdown = await exportBrowserBenchmarkReport();
      await globalThis.navigator?.clipboard?.writeText(markdown);
      setBenchmarkExportStatus('copied');
    } catch {
      setBenchmarkExportStatus('error');
    } finally {
      setIsExportingBenchmarks(false);
    }
  };

  const handleSaveBenchmarkReport = async () => {
    setIsSavingBenchmarkReport(true);
    setBenchmarkSaveStatus('idle');

    try {
      const markdown = await exportBrowserBenchmarkReport();
      await saveBrowserBenchmarkArtifact({
        sessionId: currentSessionId,
        workDir: currentWorkDir,
        markdown,
      });
      setBenchmarkSaveStatus('saved');
    } catch {
      setBenchmarkSaveStatus('error');
    } finally {
      setIsSavingBenchmarkReport(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-slate-100">
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
            onClick={() => void syncConnectionState()}
            className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors hover:border-cyan-400 hover:text-cyan-200"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-3 p-3">
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

        <DebugCard title="Event Timeline">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] text-slate-400">Newest events first</p>
            <button
              onClick={clearTimeline}
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

        <DebugCard title="Benchmarks">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-400">Backend benchmark aggregation and markdown export.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleSaveBenchmarkReport()}
                disabled={isSavingBenchmarkReport || !currentWorkDir}
                className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-medium text-slate-200 transition-colors hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                title={currentWorkDir ? 'Save benchmark markdown into docs and artifacts' : 'Bind a session workDir to persist benchmark reports'}
              >
                {isSavingBenchmarkReport ? 'Saving...' : benchmarkSaveStatus === 'saved' ? 'Saved' : 'Save Report'}
              </button>
              <button
                onClick={() => void handleExportBenchmarks()}
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

              {latestPageStateScreenshotUrl && latestPageState.viewport && (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Screenshot Preview</p>
                    <p className="text-[10px] text-slate-500">
                      Viewport {Math.round(latestPageState.viewport.width)}x{Math.round(latestPageState.viewport.height)}
                    </p>
                  </div>
                  <div className="mt-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70">
                    <div className="relative">
                      <img
                        src={latestPageStateScreenshotUrl}
                        alt={`PageState screenshot for ${latestPageState.title}`}
                        className="block w-full"
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
      </div>
    </div>
  );
}

export default BrowserDebugPanel;