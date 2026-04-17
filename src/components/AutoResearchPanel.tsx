/**
 * AutoResearchPanel — Right panel tab for experiment monitoring & control.
 *
 * Rendered inside AgentPanel when the 'autoresearch' tab is active.
 * Compact layout: status bar → experiment timeline → live output.
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import { useAutoResearchStore, type ExperimentEntry } from '@/store/autoresearchStore';
import {
  stopExperimentLoop,
  pauseExperimentLoop,
  resumeExperimentLoop,
} from '@/services/autoresearch';

// ============== Status Badge ==============

function StatusBadge({ status }: { status: ExperimentEntry['status'] }) {
  const styles = {
    IMPROVED: 'bg-green-100 text-green-700',
    NOT_IMPROVED: 'bg-yellow-100 text-yellow-700',
    FAILED: 'bg-red-100 text-red-700',
  };
  const icons = { IMPROVED: '✅', NOT_IMPROVED: '➖', FAILED: '❌' };

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${styles[status]}`}>
      {icons[status]} {status.replace('_', ' ')}
    </span>
  );
}

// ============== Experiment Detail (inline expand) ==============

function ExperimentDetail({ entry }: { entry: ExperimentEntry }) {
  return (
    <div className="px-3 pb-3 pt-1 space-y-2 text-[10px] bg-gray-50/80 border-t border-gray-100 animate-in slide-in-from-top-1 duration-150">
      <div>
        <span className="text-gray-400 font-bold uppercase tracking-wider">Hypothesis</span>
        <p className="text-gray-700 mt-0.5">{entry.hypothesis}</p>
      </div>
      {entry.change && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Change</span>
          <p className="text-gray-600 mt-0.5 font-mono text-[9px]">{entry.change}</p>
        </div>
      )}
      {entry.reasoning && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Reasoning</span>
          <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">{entry.reasoning}</p>
        </div>
      )}
      {entry.failReason && (
        <p className="text-red-500 text-[9px]">Fail: {entry.failReason}</p>
      )}
      <p className="text-gray-300 text-[9px]">
        {entry.timestamp} · {(entry.durationMs / 1000).toFixed(1)}s
      </p>
    </div>
  );
}

// ============== Main Panel ==============

export function AutoResearchPanel() {
  const {
    loopState, currentIteration, maxIterations, bestMetric,
    metricName, consecutiveFailures,
    experiments, liveOutput, selectedExperiment,
    setSelectedExperiment, setShowSetupModal, errorMessage,
  } = useAutoResearchStore();

  const liveOutputRef = useRef<HTMLDivElement>(null);
  const [liveExpanded, setLiveExpanded] = useState(true);

  const handlePause = useCallback(() => pauseExperimentLoop(), []);
  const handleResume = useCallback(() => resumeExperimentLoop(), []);
  const handleStop = useCallback(() => stopExperimentLoop(), []);

  const toggleDetail = (idx: number) => {
    setSelectedExperiment(selectedExperiment === idx ? -1 : idx);
  };

  // Auto-scroll live output to bottom
  useEffect(() => {
    if (liveOutputRef.current && liveExpanded) {
      liveOutputRef.current.scrollTop = liveOutputRef.current.scrollHeight;
    }
  }, [liveOutput, liveExpanded]);

  // ---- Idle state (no session) ----
  if (loopState === 'idle' && experiments.length === 0) {
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

  // ---- Active / completed session ----
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Status Bar */}
      <div className="px-3 py-2.5 border-b border-gray-200/60 bg-white/70 space-y-2">
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            loopState === 'running' ? 'bg-green-500 animate-pulse' :
            loopState === 'paused' ? 'bg-yellow-500' :
            loopState === 'error' ? 'bg-red-500' : 'bg-gray-400'
          }`} />
          <span className="font-bold text-gray-700 uppercase tracking-tight">{loopState}</span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500">{currentIteration}/{maxIterations}</span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500">
            {bestMetric !== null ? `${metricName}=${bestMetric}` : 'No best yet'}
          </span>
          {consecutiveFailures > 0 && (
            <span className="text-red-400 ml-auto">⚠ {consecutiveFailures}×fail</span>
          )}
        </div>

        {/* Progress bar */}
        {maxIterations > 0 && (
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min((currentIteration / maxIterations) * 100, 100)}%` }}
            />
          </div>
        )}

        {/* Control buttons */}
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
          {(loopState === 'idle' || loopState === 'stopped' || loopState === 'error') && experiments.length > 0 && (
            <button
              onClick={() => { useAutoResearchStore.getState().resetSession(); setShowSetupModal(true); }}
              className="flex-1 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-bold hover:bg-indigo-100 transition-colors"
            >
              ↻ New Session
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {loopState === 'error' && errorMessage && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-100 text-red-600 text-[10px]">
          {errorMessage}
        </div>
      )}

      {/* Experiment Timeline */}
      <div className="flex-1 overflow-y-auto scrollbar-hide hover:scrollbar-default">
        {experiments.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-300 text-[10px] font-bold uppercase tracking-widest">
            Waiting for first experiment...
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {experiments.map((exp, idx) => (
              <div key={exp.iteration}>
                <button
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    selectedExperiment === idx ? 'bg-indigo-50/50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => toggleDetail(idx)}
                >
                  <span className="text-[9px] text-gray-300 w-5 text-right font-mono">#{exp.iteration}</span>
                  <StatusBadge status={exp.status} />
                  <span className="flex-1 text-[10px] text-gray-600 truncate">{exp.hypothesis}</span>
                  <span className="text-[9px] text-gray-400 font-mono">
                    {exp.metricValue !== null ? exp.metricValue : '—'}
                  </span>
                </button>
                {selectedExperiment === idx && <ExperimentDetail entry={exp} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live output */}
      {liveOutput && (
        <div className="border-t border-gray-800 bg-gray-900">
          <button
            onClick={() => setLiveExpanded(v => !v)}
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
              <pre className="whitespace-pre-wrap break-words">{liveOutput}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AutoResearchPanel;
