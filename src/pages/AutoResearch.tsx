/**
 * AutoResearch Page — Experiment monitoring & control dashboard.
 *
 * Layout: MainLayout with experiment timeline in center and detail panel on right.
 */

import { useState, useCallback } from 'react';
import { MainLayout } from '@/layout';
import { useAutoResearchStore, type ExperimentEntry, type SshConfig } from '@/store/autoresearchStore';
import {
  startExperimentLoop,
  stopExperimentLoop,
  pauseExperimentLoop,
  resumeExperimentLoop,
} from '@/services/autoresearch';
import { getDefaultAutoResearchSessionFilePath } from '@/services/autoresearch/paths';

// ============== Experiment Detail Panel ==============

function ExperimentDetailPanel() {
  const experiments = useAutoResearchStore(s => s.experiments);
  const selectedIdx = useAutoResearchStore(s => s.selectedExperiment);
  const entry = selectedIdx >= 0 ? experiments[selectedIdx] : null;

  if (!entry) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        点击左侧实验条目查看详情
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 text-sm overflow-y-auto h-full">
      <h3 className="text-lg font-semibold text-gray-800">
        Experiment #{entry.iteration}
      </h3>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">Hypothesis</label>
        <p className="text-gray-800 mt-1">{entry.hypothesis}</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">Change</label>
        <p className="text-gray-700 mt-1 font-mono text-xs">{entry.change}</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">Result</label>
        <p className="mt-1">
          <StatusBadge status={entry.status} />
          <span className="ml-2 text-gray-700">
            {entry.metricValue !== null ? entry.metricValue : 'N/A'}
          </span>
          {entry.failReason && (
            <span className="ml-2 text-red-500 text-xs">({entry.failReason})</span>
          )}
        </p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">Reasoning</label>
        <p className="text-gray-600 mt-1 whitespace-pre-wrap">{entry.reasoning || '—'}</p>
      </div>
      <div className="text-xs text-gray-400">
        {entry.timestamp} · {(entry.durationMs / 1000).toFixed(1)}s
      </div>
    </div>
  );
}

// ============== Status Badge ==============

function StatusBadge({ status }: { status: ExperimentEntry['status'] }) {
  const styles = {
    IMPROVED: 'bg-green-100 text-green-700',
    NOT_IMPROVED: 'bg-yellow-100 text-yellow-700',
    FAILED: 'bg-red-100 text-red-700',
  };
  const icons = { IMPROVED: '✅', NOT_IMPROVED: '➖', FAILED: '❌' };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {icons[status]} {status}
    </span>
  );
}

// ============== Main View ==============

function AutoResearchView() {
  const {
    loopState, currentIteration, maxIterations, bestMetric,
    metricName, consecutiveFailures,
    experiments, liveOutput, sshConfig,
    setSelectedExperiment, initSession, setSshConfig,
  } = useAutoResearchStore();

  const [showSetup, setShowSetup] = useState(!sshConfig);
  const [setupForm, setSetupForm] = useState<SshConfig>({
    mode: 'ssh',
    host: '', user: 'root', keyPath: '', port: 22, remoteWorkDir: '~/autoresearch',
    authMode: 'agent', password: '',
  });
  const [maxIter, setMaxIter] = useState(50);
  const [metric, setMetric] = useState('val_bpb');
  const [direction, setDirection] = useState<'lower' | 'higher'>('lower');

  const handleStart = useCallback(async () => {
    if (!sshConfig) {
      if (setupForm.mode === 'ssh') {
        if (!setupForm.host || !setupForm.user) return;
        if (setupForm.authMode === 'password' && !setupForm.password) return;
        if (setupForm.authMode === 'key' && !setupForm.keyPath) return;
      } else if (!setupForm.remoteWorkDir) {
        return;
      }
    }

    const cfg = sshConfig || setupForm;
    if (!sshConfig) {
      setSshConfig(cfg);
    }

    let sessionFilePath = '';
    try {
      sessionFilePath = await getDefaultAutoResearchSessionFilePath();
    } catch (error) {
      useAutoResearchStore.getState().setError(`Failed to resolve AutoResearch session file path: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const sessionId = `autoresearch-${Date.now()}`;
    initSession({
      id: sessionId,
      maxIterations: maxIter,
      metricName: metric,
      metricDirection: direction,
      sshConfig: cfg,
      sessionFilePath,
    });

    setShowSetup(false);

    // The sendMessage adapter needs to be wired to the actual QueryEngine.
    // For now, provide a placeholder that will be connected in the next phase.
    const sendMessage = async (systemPrompt: string, userMessage: string): Promise<string> => {
      // TODO: Wire to QueryEngine.runChatTurn via chatStore
      // This requires creating a dedicated session and piping the agent output back.
      console.log('[AutoResearch] sendMessage called', { systemPrompt: systemPrompt.slice(0, 100), userMessage });
      return 'EXPERIMENT_RESULT: metric_value=null status=FAILED fail_reason="sendMessage adapter not yet wired" hypothesis="placeholder"';
    };

    startExperimentLoop(sendMessage);
  }, [sshConfig, setupForm, maxIter, metric, direction, initSession, setSshConfig]);

  const handlePause = useCallback(() => pauseExperimentLoop(), []);
  const handleResume = useCallback(() => resumeExperimentLoop(), []);
  const handleStop = useCallback(() => stopExperimentLoop(), []);

  // ---- Setup form ----
  if (showSetup && loopState === 'idle') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-gray-800">AutoResearch Setup</h2>
          <p className="text-sm text-gray-500">
            Run the loop on this Mac (Local) or on a remote machine via SSH. Password auth requires <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">sshpass</code>.
          </p>

          <div className="space-y-3">
            {/* Mode toggle */}
            <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSetupForm(f => ({ ...f, mode: 'ssh' }))}
                className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${setupForm.mode === 'ssh' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >SSH</button>
              <button
                type="button"
                onClick={() => setSetupForm(f => ({ ...f, mode: 'local' }))}
                className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${setupForm.mode === 'local' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >Local</button>
            </div>

            {setupForm.mode === 'ssh' && (
              <>
                <input
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="Host (e.g. 192.168.1.10 or connect.westd.seetacloud.com)"
                  value={setupForm.host}
                  onChange={e => setSetupForm(f => ({ ...f, host: e.target.value }))}
                />
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                    placeholder="User (default: root)"
                    value={setupForm.user}
                    onChange={e => setSetupForm(f => ({ ...f, user: e.target.value }))}
                  />
                  <input
                    className="w-20 px-3 py-2 border rounded-lg text-sm"
                    placeholder="Port"
                    type="number"
                    value={setupForm.port}
                    onChange={e => setSetupForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                  />
                </div>
                <select
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                  value={setupForm.authMode}
                  onChange={e => setSetupForm(f => ({ ...f, authMode: e.target.value as SshConfig['authMode'] }))}
                >
                  <option value="agent">Auth: Agent (~/.ssh/config or authorized_keys)</option>
                  <option value="password">Auth: Password (sshpass)</option>
                  <option value="key">Auth: Private key</option>
                </select>
                {setupForm.authMode === 'password' && (
                  <input
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="Password (kept in memory only)"
                    type="password"
                    autoComplete="off"
                    value={setupForm.password}
                    onChange={e => setSetupForm(f => ({ ...f, password: e.target.value }))}
                  />
                )}
                {setupForm.authMode === 'key' && (
                  <input
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="SSH key path (e.g. ~/.ssh/id_rsa)"
                    value={setupForm.keyPath}
                    onChange={e => setSetupForm(f => ({ ...f, keyPath: e.target.value }))}
                  />
                )}
              </>
            )}
            <input
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder={setupForm.mode === 'local' ? 'Local work dir (absolute path)' : 'Remote work dir (default: ~/autoresearch)'}
              value={setupForm.remoteWorkDir}
              onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: e.target.value }))}
            />

            <hr className="border-gray-200" />

            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
                placeholder="Metric name (e.g. val_bpb)"
                value={metric}
                onChange={e => setMetric(e.target.value)}
              />
              <select
                className="px-3 py-2 border rounded-lg text-sm"
                value={direction}
                onChange={e => setDirection(e.target.value as 'lower' | 'higher')}
              >
                <option value="lower">Lower is better</option>
                <option value="higher">Higher is better</option>
              </select>
            </div>
            <input
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="Max iterations (default: 50)"
              type="number"
              value={maxIter}
              onChange={e => setMaxIter(parseInt(e.target.value) || 50)}
            />
          </div>

          <button
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            disabled={
              setupForm.mode === 'ssh'
                ? (!setupForm.host || !setupForm.user
                    || (setupForm.authMode === 'password' && !setupForm.password)
                    || (setupForm.authMode === 'key' && !setupForm.keyPath))
                : !setupForm.remoteWorkDir
            }
            onClick={handleStart}
          >
            Start AutoResearch
          </button>
        </div>
      </div>
    );
  }

  // ---- Main dashboard ----
  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 space-y-4">
      {/* Status Bar */}
      <div className="flex items-center gap-4 px-4 py-3 bg-gray-50 rounded-xl border text-sm">
        <span className={`w-2 h-2 rounded-full ${
          loopState === 'running' ? 'bg-green-500 animate-pulse' :
          loopState === 'paused' ? 'bg-yellow-500' :
          loopState === 'error' ? 'bg-red-500' : 'bg-gray-400'
        }`} />
        <span className="font-medium text-gray-700 capitalize">{loopState}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">Exp {currentIteration}/{maxIterations}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">
          Best: {bestMetric !== null ? `${metricName}=${bestMetric}` : 'N/A'}
        </span>
        {consecutiveFailures > 0 && (
          <>
            <span className="text-gray-400">|</span>
            <span className="text-red-500">⚠ {consecutiveFailures} consecutive failure(s)</span>
          </>
        )}

        <div className="flex-1" />

        {/* Control buttons */}
        {loopState === 'idle' && (
          <button
            onClick={() => setShowSetup(true)}
            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
          >
            ▶ Setup & Start
          </button>
        )}
        {loopState === 'running' && (
          <>
            <button onClick={handlePause} className="px-3 py-1 bg-yellow-500 text-white rounded-lg text-xs hover:bg-yellow-600">
              ⏸ Pause
            </button>
            <button onClick={handleStop} className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600">
              ⏹ Stop
            </button>
          </>
        )}
        {loopState === 'paused' && (
          <>
            <button onClick={handleResume} className="px-3 py-1 bg-green-500 text-white rounded-lg text-xs hover:bg-green-600">
              ▶ Resume
            </button>
            <button onClick={handleStop} className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600">
              ⏹ Stop
            </button>
          </>
        )}
        {(loopState === 'stopped' || loopState === 'error') && (
          <button
            onClick={() => { useAutoResearchStore.getState().resetSession(); setShowSetup(true); }}
            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
          >
            ↻ New Session
          </button>
        )}
      </div>

      {/* Error banner */}
      {loopState === 'error' && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {useAutoResearchStore.getState().errorMessage}
        </div>
      )}

      {/* Experiment Timeline */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {experiments.length === 0 ? (
          <div className="text-center text-gray-400 text-sm mt-20">
            {loopState === 'idle' ? 'Configure and start an experiment session.' : 'Waiting for first experiment...'}
          </div>
        ) : (
          experiments.map((exp, idx) => (
            <button
              key={exp.iteration}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm text-left transition
                ${idx === useAutoResearchStore.getState().selectedExperiment
                  ? 'bg-blue-50 border border-blue-200'
                  : 'hover:bg-gray-50'}`}
              onClick={() => setSelectedExperiment(idx)}
            >
              <span className="w-8 text-gray-400 text-xs">#{exp.iteration}</span>
              <StatusBadge status={exp.status} />
              <span className="flex-1 text-gray-700 truncate">{exp.hypothesis}</span>
              <span className="text-gray-400 text-xs font-mono">
                {exp.metricValue !== null ? exp.metricValue : '—'}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Live output */}
      {liveOutput && (
        <div className="max-h-32 overflow-y-auto bg-gray-900 text-green-400 text-xs font-mono p-3 rounded-lg">
          <pre className="whitespace-pre-wrap">{liveOutput}</pre>
        </div>
      )}
    </div>
  );
}

// ============== Page wrapper ==============

export function AutoResearch() {
  return (
    <MainLayout
      showRightPanel={true}
      rightPanelContent={<ExperimentDetailPanel />}
      rightPanelWidthClassName="w-[360px]"
    >
      <AutoResearchView />
    </MainLayout>
  );
}

export default AutoResearch;
