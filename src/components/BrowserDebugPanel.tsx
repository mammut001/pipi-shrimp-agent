import { useMemo, useState, type CSSProperties } from 'react';

import { buildSnapshotCacheFlowGroups } from '@/components/browserDebugSnapshotCache';
import { viewportHighlightStyle } from '@/components/browserDebugPanelUi';
import {
  BenchmarksDebugCard,
  BrowserDebugPanelHeader,
  CdpRawStateDebugCard,
  EventTimelineDebugCard,
  LatestPageStateDebugCard,
  RecentActionsDebugCard,
  RecentCommandsDebugCard,
  SessionDebugCard,
  SnapshotCacheDebugCard,
} from '@/components/browserDebugPanelSections';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { useChatStore } from '@/store/chatStore';
import { useCdpStore } from '@/store/cdpStore';
import { saveBrowserBenchmarkArtifact } from '@/services/browserBenchmarkArtifacts';
import { normalizeBrowserScreenshotSrc } from '@/utils/screenshot';
import { exportBrowserBenchmarkReport } from '@/utils/browserObservabilityClient';

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
    () => normalizeBrowserScreenshotSrc(latestPageState?.screenshot),
    [latestPageState?.screenshot],
  );
  const latestPageStateHasScreenshot = Boolean(latestPageState?.screenshot?.value?.trim());
  const latestPageStateScreenshotAspectRatio = latestPageState?.viewport && latestPageState.viewport.width > 0 && latestPageState.viewport.height > 0
    ? `${latestPageState.viewport.width} / ${latestPageState.viewport.height}`
    : undefined;
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
      <BrowserDebugPanelHeader
        isUsingMockData={isUsingMockData}
        onRefresh={() => void syncConnectionState()}
      />

      <div className="space-y-3 p-3">
        <SessionDebugCard session={session} />
        <CdpRawStateDebugCard connectionState={connectionState} lastSyncedAt={lastSyncedAt} />
        <EventTimelineDebugCard
          visibleTimeline={visibleTimeline}
          latestPageState={latestPageState}
          onClear={clearTimeline}
        />
        <RecentCommandsDebugCard visibleCommands={visibleCommands} />
        <BenchmarksDebugCard
          benchmarkReport={benchmarkReport}
          visibleBenchmarkMetrics={visibleBenchmarkMetrics}
          visibleBenchmarkSamples={visibleBenchmarkSamples}
          isSavingBenchmarkReport={isSavingBenchmarkReport}
          isExportingBenchmarks={isExportingBenchmarks}
          benchmarkSaveStatus={benchmarkSaveStatus}
          benchmarkExportStatus={benchmarkExportStatus}
          currentWorkDir={currentWorkDir}
          onSave={() => void handleSaveBenchmarkReport()}
          onExport={() => void handleExportBenchmarks()}
        />
        <LatestPageStateDebugCard
          latestPageState={latestPageState}
          visibleElements={visibleElements}
          latestPageStateScreenshotUrl={latestPageStateScreenshotUrl}
          latestPageStateHasScreenshot={latestPageStateHasScreenshot}
          latestPageStateScreenshotAspectRatio={latestPageStateScreenshotAspectRatio}
          latestPageStateHighlights={latestPageStateHighlights}
        />
        <SnapshotCacheDebugCard
          snapshotCache={snapshotCache}
          snapshotCacheFlowGroups={snapshotCacheFlowGroups}
          visibleCacheEntries={visibleCacheEntries}
          latestPageState={latestPageState}
        />
        <RecentActionsDebugCard visibleActions={visibleActions} />
      </div>
    </div>
  );
}

export default BrowserDebugPanel;
