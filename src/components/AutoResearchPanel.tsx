/**
 * AutoResearchPanel — Right panel tab for experiment monitoring & control.
 *
 * Shows the current run plus persistent run history.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAutoResearchStore,
  getSelectedAutoResearchRun,
  getSortedAutoResearchRuns,
  type AutoResearchRunRecord,
} from '@/store/autoresearchStore';
import {
  stopExperimentLoop,
  pauseExperimentLoop,
  resumeExperimentLoop,
} from '@/services/autoresearch';

function RunStatusBadge({ status }: { status: AutoResearchRunRecord['status'] }) {
  const styles: Record<AutoResearchRunRecord['status'], string> = {
    draft: 'bg-gray-100 text-gray-700',
    running: 'bg-green-100 text-green-700',
    waiting_rate_limit: 'bg-yellow-100 text-yellow-700',
    stopped: 'bg-gray-100 text-gray-700',
    failed: 'bg-red-100 text-red-700',
    completed: 'bg-blue-100 text-blue-700',
    interrupted: 'bg-orange-100 text-orange-700',
  };

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${styles[status]}`}>
      {status.replace(/_/g, ' ')}
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
          <p className="text-gray-700 mt-0.5">{iteration.hypothesis}</p>
        </div>
      )}
      {iteration.change && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Change</span>
          <p className="text-gray-600 mt-0.5 font-mono text-[9px] whitespace-pre-wrap">{iteration.change}</p>
        </div>
      )}
      {iteration.reasoning && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Reasoning</span>
          <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">{iteration.reasoning}</p>
        </div>
      )}
      {iteration.error && (
        <p className="text-red-500 text-[9px]">Error: {iteration.error}</p>
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

  const liveOutputRef = useRef<HTMLDivElement>(null);
  const [liveExpanded, setLiveExpanded] = useState(true);

  const isSelectedRunActive = Boolean(selectedRun && activeRunId && selectedRun.id === activeRunId);
  const displayedLiveOutput = isSelectedRunActive
    ? liveOutput
    : selectedRun?.liveOutputExcerpt || '';
  const iterations = selectedRun?.iterations ?? [];
  const selectedIterationIndex = selectedExperiment >= 0 && selectedExperiment < iterations.length
    ? selectedExperiment
    : -1;

  const handlePause = useCallback(() => pauseExperimentLoop(), []);
  const handleResume = useCallback(() => resumeExperimentLoop(), []);
  const handleStop = useCallback(() => stopExperimentLoop(), []);

  useEffect(() => {
    if (liveOutputRef.current && liveExpanded) {
      liveOutputRef.current.scrollTop = liveOutputRef.current.scrollHeight;
    }
  }, [displayedLiveOutput, liveExpanded]);

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
                <span className="truncate">{run.config.configSnapshot.model || 'no model'}</span>
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
                {selectedRun.config.configSnapshot.configName} · {selectedRun.config.configSnapshot.provider} · {selectedRun.config.configSnapshot.model}
              </p>
              <p className="break-all">{selectedRun.config.workdir}</p>
              <p className="break-all">{selectedRun.config.experimentDir}</p>
            </div>

            {selectedRun.summary && (
              <div className="rounded-lg bg-yellow-50 border border-yellow-100 px-2 py-1.5 text-[9px] text-yellow-800">
                {selectedRun.summary}
              </div>
            )}

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

          {isSelectedRunActive && loopState === 'error' && errorMessage && (
            <div className="px-3 py-2 bg-red-50 border-b border-red-100 text-red-600 text-[10px]">
              {errorMessage}
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
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">Recent Events</p>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {selectedRun.events.slice(-6).reverse().map((event) => (
                  <div key={event.id} className="text-[9px] text-gray-500">
                    <span className="font-semibold text-gray-700">{event.phase}</span>
                    <span className="text-gray-300"> · </span>
                    <span>{event.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {displayedLiveOutput && (
            <div className="border-t border-gray-800 bg-gray-900">
              <button
                onClick={() => setLiveExpanded((value) => !value)}
                className="w-full flex items-center justify-between px-2 py-1 text-[9px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                <span className="font-bold uppercase tracking-widest">Live Output</span>
                <span>{liveExpanded ? '▾' : '▸'}</span>
              </button>
              {liveExpanded && (
                <div
                  ref={liveOutputRef}
                  className="max-h-32 overflow-y-auto text-green-400 text-[9px] font-mono px-2 pb-2"
                >
                  <pre className="whitespace-pre-wrap break-words">{displayedLiveOutput}</pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default AutoResearchPanel;
