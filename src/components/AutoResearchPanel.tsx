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
  getSelectedAutoResearchRun,
  getSortedAutoResearchRuns,
  type AutoResearchRunRecord,
} from '@/store/autoresearchStore';
import { AutoResearchRunDetailDocument } from './autoresearch/AutoResearchRunDetailDocument';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
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
} from '@/services/autoresearch';
import {
  buildAutoResearchModelDisplayFromSnapshot,
} from '@/services/autoresearch/modelDisplay';
import { downloadTextFile, stripAnsiText, writeClipboardText } from '@/utils/clipboard';

type LiveOutputFeedback = 'copied' | 'cleared' | null;

function CopyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 012-2h7a2 2 0 012 2v7a2 2 0 01-2 2h-2m-7 3h7a2 2 0 002-2V10a2 2 0 00-2-2H8a2 2 0 00-2 2v7a2 2 0 002 2z" />
    </svg>
  );
}

function DownloadIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v11m0 0l4-4m-4 4l-4-4M4 17v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
    </svg>
  );
}

function ClearIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function HeaderActionButton({
  label,
  title,
  icon,
  onClick,
  className = '',
  dataCopyTarget,
}: {
  label: string;
  title?: string;
  icon: React.ReactNode;
  onClick: () => void;
  className?: string;
  dataCopyTarget?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title || label}
      data-copy-target={dataCopyTarget}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400/70 ${className}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function RowCopyButton({ onClick, label, dataCopyTarget }: { onClick: () => void; label: string; dataCopyTarget?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-copy-target={dataCopyTarget}
      className="rounded-md p-1 text-gray-400 opacity-0 transition-[opacity,color,background-color] hover:bg-gray-200 hover:text-gray-700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/70 group-hover:opacity-100"
    >
      <CopyIcon className="h-3 w-3" />
    </button>
  );
}

function formatRunStatusLabel(status: AutoResearchRunRecord['status']): string {
  return status === 'reflection_failed'
    ? t('autoresearch.statusReflectionFailed')
    : status.replace(/_/g, ' ');
}

function formatEventPhaseLabel(phase: AutoResearchRunRecord['events'][number]['phase']): string {
  return phase === 'reflection_parse_failed'
    ? t('autoresearch.reflectionParseFailed')
    : phase.replace(/_/g, ' ');
}

function RunStatusBadge({ status }: { status: AutoResearchRunRecord['status'] }) {
  const styles: Record<AutoResearchRunRecord['status'], string> = {
    draft: 'bg-gray-100 text-gray-700',
    running: 'bg-green-100 text-green-700',
    waiting_rate_limit: 'bg-yellow-100 text-yellow-700',
    reflection_failed: 'bg-red-100 text-red-700',
    stopped: 'bg-gray-100 text-gray-700',
    failed: 'bg-red-100 text-red-700',
    completed: 'bg-blue-100 text-blue-700',
    interrupted: 'bg-orange-100 text-orange-700',
  };

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${styles[status]}`}>
      {formatRunStatusLabel(status)}
    </span>
  );
}

function IterationStatusBadge({ status }: { status: 'pending' | 'running' | 'failed' | 'completed' | 'skipped' }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    completed: 'bg-green-100 text-green-700',
    skipped: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function IterationDetail({ run, index }: { run: AutoResearchRunRecord; index: number }) {
  const iteration = run.iterations[index];
  if (!iteration) {
    return null;
  }

  return (
    <div className="px-3 pb-3 pt-1 space-y-2 text-[10px] bg-gray-50/80 border-t border-gray-100">
      <div className="flex items-center gap-2">
        <IterationStatusBadge status={iteration.status} />
        {typeof iteration.metricValue === 'number' && (
          <span className="text-gray-500 font-mono">{run.config.metric}={iteration.metricValue}</span>
        )}
      </div>
      {iteration.hypothesis && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Hypothesis</span>
          <p className="text-gray-700 mt-0.5">{redactSensitiveText(iteration.hypothesis)}</p>
        </div>
      )}
      {iteration.change && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Change</span>
          <p className="text-gray-600 mt-0.5 font-mono text-[9px] whitespace-pre-wrap">{redactSensitiveText(iteration.change)}</p>
        </div>
      )}
      {iteration.reasoning && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Reasoning</span>
          <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">{redactSensitiveText(iteration.reasoning)}</p>
        </div>
      )}
      {iteration.error && (
        <p className="text-red-500 text-[9px]">Error: {redactSensitiveText(iteration.error)}</p>
      )}
      {iteration.artifactPaths && iteration.artifactPaths.length > 0 && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Artifacts</span>
          <div className="mt-1 space-y-0.5">
            {iteration.artifactPaths.slice(0, 6).map((artifactPath) => (
              <p key={artifactPath} className="text-[9px] text-gray-500 break-all font-mono">{artifactPath}</p>
            ))}
          </div>
        </div>
      )}
      <p className="text-gray-300 text-[9px]">
        {[iteration.startedAt, iteration.endedAt].filter(Boolean).join(' → ')}
      </p>
    </div>
  );
}

export function AutoResearchPanel() {
  const {
    loopState,
    errorMessage,
    liveOutput,
    selectedExperiment,
    selectedRunId,
    id: activeRunId,
    setSelectedExperiment,
    selectRun,
    setShowSetupModal,
    resetSession,
  } = useAutoResearchStore();
  const selectedRun = useAutoResearchStore(getSelectedAutoResearchRun);
  const sortedRuns = useAutoResearchStore(getSortedAutoResearchRuns);
  const runReason = selectedRun?.reason || errorMessage;

  const liveOutputRef = useRef<HTMLDivElement>(null);
  const [liveExpanded, setLiveExpanded] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [clearedLiveChars, setClearedLiveChars] = useState(0);
  const [liveOutputFeedback, setLiveOutputFeedback] = useState<LiveOutputFeedback>(null);

  const isSelectedRunActive = Boolean(selectedRun && activeRunId && selectedRun.id === activeRunId);
  const rawLiveOutput = isSelectedRunActive
    ? liveOutput
    : selectedRun?.liveOutputExcerpt || '';
  const normalizedLiveOutput = useMemo(() => stripAnsiText(rawLiveOutput), [rawLiveOutput]);
  const visibleLiveOutput = normalizedLiveOutput.slice(Math.min(clearedLiveChars, normalizedLiveOutput.length));
  const displayedLiveOutput = redactSensitiveText(visibleLiveOutput);
  const iterations = selectedRun?.iterations ?? [];
  const selectedIterationIndex = selectedExperiment >= 0 && selectedExperiment < iterations.length
    ? selectedExperiment
    : -1;
  const recentEvents = selectedRun?.events.slice(-6).reverse() ?? [];
  const allEventLines = useMemo(
    () => formatAutoResearchEventDump(selectedRun?.events ?? []),
    [selectedRun?.events],
  );

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

  const handlePause = useCallback(() => pauseExperimentLoop(), []);
  const handleResume = useCallback(() => resumeExperimentLoop(), []);
  const handleStop = useCallback(() => stopExperimentLoop(), []);
  const handleOpenSelectedRunArtifact = useCallback(() => {
    const targetPath = selectedRun?.config.livingDocPath
      || selectedRun?.config.sessionFilePath
      || selectedRun?.config.experimentDir;
    if (targetPath) {
      void openFileExternal(targetPath);
    }
  }, [selectedRun]);

  const handleCopyLiveOutput = useCallback(() => {
    if (!visibleLiveOutput) {
      return;
    }
    void writeClipboardText(visibleLiveOutput)
      .then(() => showLiveOutputFeedback('copied'))
      .catch(() => undefined);
  }, [showLiveOutputFeedback, visibleLiveOutput]);

  const handleDownloadLiveOutput = useCallback(() => {
    if (!visibleLiveOutput || !selectedRun) {
      return;
    }
    downloadTextFile(buildAutoResearchLiveOutputFilename(selectedRun), visibleLiveOutput);
  }, [selectedRun, visibleLiveOutput]);

  const handleClearLiveOutput = useCallback(() => {
    setClearedLiveChars(normalizedLiveOutput.length);
    showLiveOutputFeedback('cleared');
  }, [normalizedLiveOutput.length, showLiveOutputFeedback]);

  const handleCopyAllEvents = useCallback(() => {
    if (!allEventLines) {
      return;
    }
    void writeClipboardText(allEventLines).catch(() => undefined);
  }, [allEventLines]);

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
          onClick={() => setShowSetupModal(true)}
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
            onClick={() => setShowSetupModal(true)}
            className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[9px] font-bold hover:bg-indigo-100 transition-colors"
          >
            New Run
          </button>
        </div>
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
                <span className="truncate">{buildAutoResearchModelDisplayFromSnapshot(run.config.configSnapshot).compactLabel}</span>
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
                {buildAutoResearchModelDisplayFromSnapshot(selectedRun.config.configSnapshot).compactLabel}
              </p>
              <p className="break-all">{selectedRun.config.workdir}</p>
              <p className="break-all">{selectedRun.config.experimentDir}</p>
            </div>

            {selectedRun.summary && selectedRun.status !== 'reflection_failed' && (
              <div className="rounded-lg bg-yellow-50 border border-yellow-100 px-2 py-1.5 text-[9px] text-yellow-800">
                {redactSensitiveText(selectedRun.summary)}
              </div>
            )}

            {selectedRun.status === 'reflection_failed' && runReason && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[9px] text-red-700">
                <p className="font-semibold uppercase tracking-wider text-[8px] text-red-500">{t('autoresearch.reflectionReason')}</p>
                <p className="mt-0.5">{redactSensitiveText(runReason)}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="w-full py-1.5 rounded-lg border border-indigo-100 bg-indigo-50 text-[9px] font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              Open Detail
            </button>

            {isSelectedRunActive && (
              <div className="flex gap-1.5">
                {loopState === 'running' && (
                  <>
                    <button onClick={handlePause} className="flex-1 py-1 bg-yellow-50 text-yellow-700 rounded-lg text-[9px] font-bold hover:bg-yellow-100 transition-colors">
                      ⏸ Pause
                    </button>
                    <button onClick={handleStop} className="flex-1 py-1 bg-red-50 text-red-600 rounded-lg text-[9px] font-bold hover:bg-red-100 transition-colors">
                      ⏹ Stop
                    </button>
                  </>
                )}
                {loopState === 'paused' && (
                  <>
                    <button onClick={handleResume} className="flex-1 py-1 bg-green-50 text-green-700 rounded-lg text-[9px] font-bold hover:bg-green-100 transition-colors">
                      ▶ Resume
                    </button>
                    <button onClick={handleStop} className="flex-1 py-1 bg-red-50 text-red-600 rounded-lg text-[9px] font-bold hover:bg-red-100 transition-colors">
                      ⏹ Stop
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

          {isSelectedRunActive && loopState === 'error' && runReason && (
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
                        void writeClipboardText(formatAutoResearchEventLine(event)).catch(() => undefined);
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
                    className="min-h-screen sm:min-h-[calc(100vh-2rem)] sm:rounded-[28px] sm:border sm:border-[#e7ded1]"
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
