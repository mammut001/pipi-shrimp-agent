/**
 * AutoResearchPanel — Right panel tab for experiment monitoring & control.
 *
 * Shows the current run plus persistent run history.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@/i18n';
import {
  useAutoResearchStore,
  getSelectedAutoResearchRunContext,
  getSortedAutoResearchRuns,
} from '@/store/autoresearchStore';
import { AutoResearchRunDetailDocument } from './autoresearch/AutoResearchRunDetailDocument';
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
import {
  buildAutoResearchModelDisplayFromSnapshot,
} from '@/services/autoresearch/modelDisplay';
import { toAgentConfigSnapshot } from '@/services/autoresearch/errors';
import { buildAutoResearchRecoverySummary } from '@/services/autoresearch/recoverySummary';
import { handleAutoResearchRecoveryAction } from '@/services/autoresearch/recoveryActions';
import { downloadTextFile, stripAnsiText, writeClipboardText } from '@/utils/clipboard';

import {
  type LiveOutputFeedback,
  CopyIcon,
  DownloadIcon,
  ClearIcon,
  HeaderActionButton,
  RowCopyButton,
  formatEventPhaseLabel,
  RunStatusBadge,
  IterationStatusBadge,
  IterationDetail,
} from './autoResearchPanelUi';

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
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="p-3 bg-indigo-50 rounded-2xl mb-3">
          <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </div>
        <p className="text-[11px] font-bold text-gray-600 mb-1">AutoResearch</p>
        <p className="text-[10px] text-gray-400 mb-4 max-w-[200px]">
          Autonomous ML experiment loop on your remote VPS
        </p>
        <button
          onClick={handleShowSetup}
          className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold hover:bg-indigo-700 transition-colors"
        >
          Setup & Start
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-gray-200/60 bg-white/70 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Run History</p>
          <button
            onClick={handleShowSetup}
            className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[9px] font-bold hover:bg-indigo-100 transition-colors"
          >
            New Run
          </button>
        </div>
        {panelWarning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[9px] text-amber-800">
            {panelWarning}
          </div>
        )}
        <div className="max-h-24 overflow-y-auto space-y-1">
          {sortedRuns.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => {
                selectRun(run.id);
                setSelectedExperiment(-1);
              }}
              className={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
                selectedRunId === run.id ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <RunStatusBadge status={run.status} />
                <span className="flex-1 truncate text-[10px] font-semibold text-gray-700">{run.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[9px] text-gray-500">
                <span className="truncate">{run.config.metric}</span>
                <span>·</span>
                <span>{run.currentIteration}/{run.config.iterations}</span>
                <span>·</span>
                <span className="truncate">{buildAutoResearchModelDisplayFromSnapshot(toAgentConfigSnapshot(run.config.configSnapshot)).compactLabel}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedRun && (
        <>
          <div className="px-3 py-2.5 border-b border-gray-200/60 bg-white/70 space-y-2">
            <div className="flex items-center gap-2 text-[10px]">
              <RunStatusBadge status={selectedRun.status} />
              <span className="font-bold text-gray-700 truncate">{selectedRun.title}</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-500">{selectedRun.currentIteration}/{selectedRun.config.iterations}</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-500">
                {selectedRun.bestMetricValue !== null && selectedRun.bestMetricValue !== undefined
                  ? `${selectedRun.config.metric}=${selectedRun.bestMetricValue}`
                  : 'No best yet'}
              </span>
            </div>
            <div className="rounded-lg bg-gray-50 px-2 py-1.5 text-[9px] text-gray-500 space-y-0.5">
              <p className="font-medium text-gray-700">
                {buildAutoResearchModelDisplayFromSnapshot(toAgentConfigSnapshot(selectedRun.config.configSnapshot)).compactLabel}
              </p>
              <p className="break-all">{selectedRun.config.workdir}</p>
              <p className="break-all">{selectedRun.config.experimentDir}</p>
            </div>

            {recoverySummary && (
              <div className={`rounded-lg border px-2 py-1.5 text-[9px] ${recoverySummary.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : recoverySummary.tone === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-blue-200 bg-blue-50 text-blue-800'}`}
              >
                <p className="font-semibold uppercase tracking-wider text-[8px]">{recoverySummary.title}</p>
                <p className="mt-0.5">{redactSensitiveText(recoverySummary.message)}</p>
                {recoverySummary.hint && <p className="mt-1 opacity-90">{redactSensitiveText(recoverySummary.hint)}</p>}
                {recoverySummary.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {recoverySummary.actions.slice(0, 3).map((action) => (
                      <button
                        key={`panel-recovery-${action.type}-${action.label || 'label'}`}
                        type="button"
                        disabled={action.supported === false}
                        title={action.reason || action.label || action.type}
                        onClick={() => handleRecoveryAction(action)}
                        className="rounded-full border border-current/20 bg-white/70 px-2 py-0.5 text-[8px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {action.label || action.type}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedRun.summary && !recoverySummary && (
              <div className="rounded-lg bg-yellow-50 border border-yellow-100 px-2 py-1.5 text-[9px] text-yellow-800">
                {redactSensitiveText(selectedRun.summary)}
              </div>
            )}

            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="w-full py-1.5 rounded-lg border border-indigo-100 bg-indigo-50 text-[9px] font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              Open Detail
            </button>

            {canResumeInterruptedRun && (
              <button
                type="button"
                onClick={handleResumeInterruptedRun}
                disabled={isResumingInterruptedRun}
                className="w-full py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-[9px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResumingInterruptedRun ? 'Resuming…' : 'Resume Run'}
              </button>
            )}

            {isSelectedRunActive && (
              <div className="flex gap-1.5">
                {loopState === 'running' && (
                  <>
                    <button onClick={handlePause} className="flex-1 py-1 bg-yellow-50 text-yellow-700 rounded-lg text-[9px] font-bold hover:bg-yellow-100 transition-colors">
                      ⏸ {t('autoresearch.pause')}
                    </button>
                    <button onClick={handleStop} className="flex-1 py-1 bg-red-50 text-red-600 rounded-lg text-[9px] font-bold hover:bg-red-100 transition-colors">
                      ⏹ {t('autoresearch.stop')}
                    </button>
                  </>
                )}
                {loopState === 'paused' && (
                  <>
                    <button onClick={handleResume} className="flex-1 py-1 bg-green-50 text-green-700 rounded-lg text-[9px] font-bold hover:bg-green-100 transition-colors">
                      ▶ {t('autoresearch.resume')}
                    </button>
                    <button onClick={handleStop} className="flex-1 py-1 bg-red-50 text-red-600 rounded-lg text-[9px] font-bold hover:bg-red-100 transition-colors">
                      ⏹ {t('autoresearch.stop')}
                    </button>
                  </>
                )}
                {(loopState === 'stopped' || loopState === 'error') && (
                  <button
                    onClick={() => {
                      resetSession();
                      setShowSetupModal(true);
                    }}
                    className="flex-1 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-bold hover:bg-indigo-100 transition-colors"
                  >
                    ↻ New Session
                  </button>
                )}
              </div>
            )}
          </div>

          {isSelectedRunActive && loopState === 'error' && runReason && !recoverySummary && (
            <div className="px-3 py-2 bg-red-50 border-b border-red-100 text-red-600 text-[10px]">
              {redactSensitiveText(runReason)}
            </div>
          )}

          <div className="flex-1 overflow-y-auto scrollbar-hide hover:scrollbar-default">
            {iterations.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-300 text-[10px] font-bold uppercase tracking-widest">
                No iterations recorded yet
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {iterations.map((iteration, idx) => (
                  <div key={iteration.id}>
                    <button
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                        selectedIterationIndex === idx ? 'bg-indigo-50/50' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedExperiment(selectedIterationIndex === idx ? -1 : idx)}
                    >
                      <span className="text-[9px] text-gray-300 w-5 text-right font-mono">#{iteration.index}</span>
                      <IterationStatusBadge status={iteration.status} />
                      <span className="flex-1 text-[10px] text-gray-600 truncate">{iteration.hypothesis || 'Pending iteration'}</span>
                      <span className="text-[9px] text-gray-400 font-mono">
                        {typeof iteration.metricValue === 'number' ? iteration.metricValue : '—'}
                      </span>
                    </button>
                    {selectedIterationIndex === idx && <IterationDetail run={selectedRun} index={idx} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedRun.events.length > 0 && (
            <div className="border-t border-gray-200 bg-white px-2 py-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Recent Events</p>
                <HeaderActionButton
                  label={t('autoresearch.recentEvents.copyAll')}
                  icon={<CopyIcon className="h-3 w-3" />}
                  onClick={handleCopyAllEvents}
                  dataCopyTarget="recent-events-all"
                  className="text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                />
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {recentEvents.map((event) => (
                  <div key={event.id} className="group flex items-start justify-between gap-2 text-[9px] text-gray-500">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-gray-700">{formatEventPhaseLabel(event.phase)}</span>
                      <span className="text-gray-300"> · </span>
                      <span>{redactSensitiveText(event.message)}</span>
                    </div>
                    <RowCopyButton
                      onClick={() => {
                        copyRedactedText(formatAutoResearchEventLine(event));
                      }}
                      label={t('autoresearch.recentEvents.copyOne')}
                      dataCopyTarget="recent-event-line"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {normalizedLiveOutput && (
            <div className="border-t border-gray-800 bg-gray-900">
              <div className="flex items-center justify-between gap-2 px-2 py-1">
                <button
                  onClick={() => setLiveExpanded((value) => !value)}
                  className="flex min-w-0 items-center gap-2 text-[9px] text-gray-500 transition-colors hover:text-gray-300"
                  aria-label="Toggle live output"
                >
                  <span className="font-bold uppercase tracking-widest">Live Output</span>
                  <span>{liveExpanded ? '▾' : '▸'}</span>
                </button>
                <div className="relative flex items-center gap-1">
                  {liveOutputFeedback && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="absolute bottom-full right-0 mb-1 whitespace-nowrap rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-[9px] font-medium text-gray-100 shadow-lg"
                      data-live-output-feedback={liveOutputFeedback}
                    >
                      {liveOutputFeedback === 'copied'
                        ? t('autoresearch.liveOutput.copied')
                        : t('autoresearch.liveOutput.cleared')}
                    </span>
                  )}
                  <HeaderActionButton
                    label={t('autoresearch.liveOutput.copy')}
                    icon={<CopyIcon />}
                    onClick={handleCopyLiveOutput}
                    dataCopyTarget="live-output-copy"
                    className="text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                  />
                  <HeaderActionButton
                    label={t('autoresearch.liveOutput.download')}
                    icon={<DownloadIcon />}
                    onClick={handleDownloadLiveOutput}
                    dataCopyTarget="live-output-download"
                    className="text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                  />
                  <HeaderActionButton
                    label={t('autoresearch.liveOutput.clear')}
                    icon={<ClearIcon />}
                    onClick={handleClearLiveOutput}
                    dataCopyTarget="live-output-clear"
                    className="text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                  />
                </div>
              </div>
              {liveExpanded && (
                <div
                  ref={liveOutputRef}
                  className="max-h-32 overflow-y-auto text-green-400 text-[9px] font-mono px-2 pb-2"
                >
                  <pre className="whitespace-pre-wrap break-words" data-live-output-content>{displayedLiveOutput}</pre>
                </div>
              )}
            </div>
          )}

          {detailOpen && selectedRun && typeof document !== 'undefined' && createPortal(
            <div
              className="fixed inset-0 z-[1000] overflow-y-auto bg-[#1c1917]/58 backdrop-blur-[6px]"
              onClick={() => setDetailOpen(false)}
            >
              <div className="min-h-full sm:p-4">
                <div onClick={(event) => event.stopPropagation()}>
                  <AutoResearchRunDetailDocument
                    run={selectedRun}
                    liveOutput={displayedLiveOutput}
                    onBack={() => setDetailOpen(false)}
                    onOpen={handleOpenSelectedRunArtifact}
                    onClose={() => setDetailOpen(false)}
                    headerActions={canResumeInterruptedRun ? (
                      <button
                        type="button"
                        onClick={handleResumeInterruptedRun}
                        disabled={isResumingInterruptedRun}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isResumingInterruptedRun ? 'Resuming…' : 'Resume Run'}
                      </button>
                    ) : undefined}
                    className="min-h-screen sm:min-h-[calc(100vh-2rem)] sm:rounded-[28px] sm:border sm:border-[#e9e7e2]"
                  />
                </div>
              </div>
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}

export default AutoResearchPanel;
