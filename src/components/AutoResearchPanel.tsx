/**
 * AutoResearchPanel — Right panel tab for experiment monitoring & control.
 *
 * Shows the current run plus persistent run history.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useAutoResearchStore,
  getSelectedAutoResearchRunContext,
  getSortedAutoResearchRuns,
} from '@/store/autoresearchStore';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import {
  buildAutoResearchRunLockMessage,
  useAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
import { openFileExternal } from '@/services/docService';
import {
  buildAutoResearchLiveOutputFilename,
  formatAutoResearchEventDump,
  formatAutoResearchEventLine,
} from '@/services/autoresearch/eventPresentation';
import {
  stopExperimentLoop,
  pauseExperimentLoop,
  resumeExperimentLoop,
  resumeInterruptedAutoResearchRun,
} from '@/services/autoresearch';
import { buildAutoResearchRecoverySummary } from '@/services/autoresearch/recoverySummary';
import { handleAutoResearchRecoveryAction } from '@/services/autoresearch/recoveryActions';
import { downloadTextFile, stripAnsiText, writeClipboardText } from '@/utils/clipboard';

import type { LiveOutputFeedback } from './autoResearchPanelUi';
import {
  AutoResearchPanelEmptyState,
  AutoResearchRunHistorySection,
  AutoResearchSelectedRunSummary,
  AutoResearchIterationList,
  AutoResearchRecentEventsSection,
  AutoResearchLiveOutputSection,
  AutoResearchRunDetailModal,
} from './autoResearchPanelSections';

export function AutoResearchPanel() {
  const {
    selectedRunId,
    setSelectedExperiment,
    selectRun,
    setShowSetupModal,
    resetSession,
  } = useAutoResearchStore();
  const selectedRunContext = useAutoResearchStore(getSelectedAutoResearchRunContext);
  const selectedRun = selectedRunContext.run;
  const sortedRuns = useAutoResearchStore(getSortedAutoResearchRuns);
  const lifecycleLock = useAutoResearchLifecycleLock();
  const loopState = selectedRunContext.loopState;
  const runReason = selectedRunContext.reason;

  const liveOutputRef = useRef<HTMLDivElement>(null);
  const [liveExpanded, setLiveExpanded] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [clearedLiveChars, setClearedLiveChars] = useState(0);
  const [liveOutputFeedback, setLiveOutputFeedback] = useState<LiveOutputFeedback>(null);
  const [panelWarning, setPanelWarning] = useState<string | null>(null);
  const [isResumingInterruptedRun, setIsResumingInterruptedRun] = useState(false);

  const isSelectedRunActive = selectedRunContext.isActive;
  const rawLiveOutput = selectedRunContext.liveOutput;
  const normalizedLiveOutput = useMemo(() => stripAnsiText(rawLiveOutput), [rawLiveOutput]);
  const visibleLiveOutput = normalizedLiveOutput.slice(Math.min(clearedLiveChars, normalizedLiveOutput.length));
  const displayedLiveOutput = redactSensitiveText(visibleLiveOutput);
  const iterations = selectedRun?.iterations ?? [];
  const selectedIterationIndex = selectedRunContext.selectedIterationIndex;
  const recentEvents = selectedRun?.events.slice(-6).reverse() ?? [];
  const recoverySummary = useMemo(
    () => (selectedRun ? buildAutoResearchRecoverySummary(selectedRun) : null),
    [selectedRun],
  );
  const allEventLines = useMemo(
    () => formatAutoResearchEventDump(selectedRun?.events ?? []),
    [selectedRun?.events],
  );
  const canResumeInterruptedRun = Boolean(
    selectedRun
    && !isSelectedRunActive
    && (selectedRun.status === 'interrupted' || selectedRun.status === 'paused' || selectedRun.resumeToken?.status === 'paused')
    && selectedRun.resumeToken?.resumable,
  );

  const handleShowSetup = useCallback(() => {
    if (lifecycleLock.locked) {
      setPanelWarning(buildAutoResearchRunLockMessage('start a new run', lifecycleLock));
      return;
    }

    setPanelWarning(null);
    setShowSetupModal(true);
  }, [lifecycleLock, setShowSetupModal]);

  const showLiveOutputFeedback = useCallback((next: Exclude<LiveOutputFeedback, null>) => {
    setLiveOutputFeedback(next);
  }, []);

  useEffect(() => {
    if (!liveOutputFeedback) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setLiveOutputFeedback(null);
    }, 1500);
    return () => window.clearTimeout(timeoutId);
  }, [liveOutputFeedback]);

  useEffect(() => {
    setClearedLiveChars(0);
    setLiveOutputFeedback(null);
  }, [selectedRun?.id]);

  useEffect(() => {
    if (!lifecycleLock.locked) {
      setPanelWarning(null);
    }
  }, [lifecycleLock.locked]);

  const handlePause = useCallback(() => pauseExperimentLoop(), []);
  const handleResume = useCallback(() => resumeExperimentLoop(selectedRun?.id), [selectedRun?.id]);
  const handleStop = useCallback(() => stopExperimentLoop(selectedRun?.id), [selectedRun?.id]);
  const handleRecoveryAction = useCallback((action: Parameters<typeof handleAutoResearchRecoveryAction>[0]) => {
    if (!selectedRun) {
      return;
    }
    const result = handleAutoResearchRecoveryAction(action, selectedRun.id, {
      resumeExperimentLoop,
      stopExperimentLoop,
    });
    if (result.kind === 'inspect') {
      setDetailOpen(true);
    } else if (result.kind === 'unsupported' && result.reason) {
      setPanelWarning(redactSensitiveText(result.reason));
    }
  }, [selectedRun]);
  const handleResumeInterruptedRun = useCallback(() => {
    if (!selectedRun || !canResumeInterruptedRun || isResumingInterruptedRun) {
      return;
    }

    setIsResumingInterruptedRun(true);
    setPanelWarning(null);
    void resumeInterruptedAutoResearchRun(selectedRun.id)
      .then(() => {
        setDetailOpen(false);
      })
      .catch((error) => {
        setPanelWarning(redactSensitiveText(error instanceof Error ? error.message : String(error)));
      })
      .finally(() => {
        setIsResumingInterruptedRun(false);
      });
  }, [canResumeInterruptedRun, isResumingInterruptedRun, selectedRun]);
  const handleOpenSelectedRunArtifact = useCallback(() => {
    const targetPath = selectedRun?.config.livingDocPath
      || selectedRun?.config.sessionFilePath
      || selectedRun?.config.experimentDir;
    if (targetPath) {
      void openFileExternal(targetPath);
    }
  }, [selectedRun]);

  // Always copy/download through redaction so callers cannot ship raw secrets.
  const copyRedactedText = useCallback((text: string) => {
    void writeClipboardText(redactSensitiveText(text)).catch(() => undefined);
  }, []);

  const handleCopyLiveOutput = useCallback(() => {
    if (!displayedLiveOutput) {
      return;
    }
    void writeClipboardText(displayedLiveOutput)
      .then(() => showLiveOutputFeedback('copied'))
      .catch(() => undefined);
  }, [displayedLiveOutput, showLiveOutputFeedback]);

  const handleDownloadLiveOutput = useCallback(() => {
    if (!displayedLiveOutput || !selectedRun) {
      return;
    }
    downloadTextFile(buildAutoResearchLiveOutputFilename(selectedRun), displayedLiveOutput);
  }, [displayedLiveOutput, selectedRun]);

  const handleClearLiveOutput = useCallback(() => {
    setClearedLiveChars(normalizedLiveOutput.length);
    showLiveOutputFeedback('cleared');
  }, [normalizedLiveOutput.length, showLiveOutputFeedback]);

  const handleCopyAllEvents = useCallback(() => {
    if (!allEventLines) {
      return;
    }
    copyRedactedText(allEventLines);
  }, [allEventLines, copyRedactedText]);

  const handleSelectRun = useCallback((runId: string) => {
    selectRun(runId);
    setSelectedExperiment(-1);
  }, [selectRun, setSelectedExperiment]);

  const handleNewSession = useCallback(() => {
    resetSession();
    setShowSetupModal(true);
  }, [resetSession, setShowSetupModal]);

  const handleToggleIteration = useCallback((idx: number) => {
    setSelectedExperiment(selectedIterationIndex === idx ? -1 : idx);
  }, [selectedIterationIndex, setSelectedExperiment]);

  useEffect(() => {
    if (liveOutputRef.current && liveExpanded) {
      liveOutputRef.current.scrollTop = liveOutputRef.current.scrollHeight;
    }
  }, [displayedLiveOutput, liveExpanded]);

  useEffect(() => {
    if (!detailOpen || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [detailOpen]);

  if (!selectedRun && sortedRuns.length === 0) {
    return <AutoResearchPanelEmptyState onShowSetup={handleShowSetup} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <AutoResearchRunHistorySection
        sortedRuns={sortedRuns}
        selectedRunId={selectedRunId}
        panelWarning={panelWarning}
        onShowSetup={handleShowSetup}
        onSelectRun={handleSelectRun}
      />

      {selectedRun && (
        <>
          <AutoResearchSelectedRunSummary
            run={selectedRun}
            recoverySummary={recoverySummary}
            isSelectedRunActive={isSelectedRunActive}
            loopState={loopState}
            runReason={runReason}
            canResumeInterruptedRun={canResumeInterruptedRun}
            isResumingInterruptedRun={isResumingInterruptedRun}
            onOpenDetail={() => setDetailOpen(true)}
            onRecoveryAction={handleRecoveryAction}
            onResumeInterruptedRun={handleResumeInterruptedRun}
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
            onNewSession={handleNewSession}
          />

          <AutoResearchIterationList
            run={selectedRun}
            iterations={iterations}
            selectedIterationIndex={selectedIterationIndex}
            onToggleIteration={handleToggleIteration}
          />

          {selectedRun.events.length > 0 && (
            <AutoResearchRecentEventsSection
              recentEvents={recentEvents}
              onCopyAllEvents={handleCopyAllEvents}
              onCopyEventLine={(event) => {
                copyRedactedText(formatAutoResearchEventLine(event));
              }}
            />
          )}

          {normalizedLiveOutput && (
            <AutoResearchLiveOutputSection
              liveExpanded={liveExpanded}
              onToggleExpanded={() => setLiveExpanded((value) => !value)}
              liveOutputFeedback={liveOutputFeedback}
              displayedLiveOutput={displayedLiveOutput}
              liveOutputRef={liveOutputRef}
              onCopy={handleCopyLiveOutput}
              onDownload={handleDownloadLiveOutput}
              onClear={handleClearLiveOutput}
            />
          )}

          {detailOpen && selectedRun && typeof document !== 'undefined' && createPortal(
            <AutoResearchRunDetailModal
              run={selectedRun}
              displayedLiveOutput={displayedLiveOutput}
              canResumeInterruptedRun={canResumeInterruptedRun}
              isResumingInterruptedRun={isResumingInterruptedRun}
              onResumeInterruptedRun={handleResumeInterruptedRun}
              onClose={() => setDetailOpen(false)}
              onOpenArtifact={handleOpenSelectedRunArtifact}
            />,
            document.body,
          )}
        </>
      )}
    </div>
  );
}

export default AutoResearchPanel;
