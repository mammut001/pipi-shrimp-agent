/**
 * AutoResearch Page — Experiment monitoring & control dashboard.
 *
 * Layout: MainLayout with experiment timeline in center and detail panel on right.
 */

import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import { TerminalPanel } from '@/components';
import { MainLayout } from '@/layout';
import { useAutoResearchStore, type ExperimentEntry, type SshConfig } from '@/store/autoresearchStore';
import {
  createAutoResearchSendMessage,
  startExperimentLoop,
  stopExperimentLoop,
  pauseExperimentLoop,
  resumeExperimentLoop,
} from '@/services/autoresearch';
import { getDefaultAutoResearchSessionFilePath } from '@/services/autoresearch/paths';
import { assertSupportedPlatform } from '@/services/autoresearch/platformGuard';
import { buildRemoteBashCommand } from '@/utils/remoteExec';

const AUTORESEARCH_CONFIG_STORAGE_KEY = 'pipi-shrimp-autoresearch-ssh-config';

interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

type ConnectionTestState =
  | { status: 'idle'; output: string }
  | { status: 'testing'; output: string }
  | { status: 'success'; output: string }
  | { status: 'error'; output: string };

function loadPersistedSetup(): SshConfig {
  const fallback: SshConfig = {
    mode: 'local',
    host: '',
    user: 'root',
    keyPath: '',
    port: 22,
    remoteWorkDir: '',
    authMode: 'agent',
    password: '',
  };

  try {
    const raw = localStorage.getItem(AUTORESEARCH_CONFIG_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<SshConfig>;
    return {
      ...fallback,
      ...parsed,
      password: '',
    };
  } catch {
    return fallback;
  }
}

function createStableAutoResearchSessionId(
  cfg: SshConfig,
  sessionFilePath: string,
  metricName: string,
  direction: 'lower' | 'higher',
): string {
  const seed = `${cfg.mode}|${cfg.host}|${cfg.user}|${cfg.port}|${cfg.remoteWorkDir}|${sessionFilePath}|${metricName}|${direction}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return `autoresearch-${Math.abs(hash).toString(36)}`;
}

function getStatusLabel(status: ExperimentEntry['status']) {
  switch (status) {
    case 'IMPROVED':
      return t('autoresearch.statusImproved');
    case 'NOT_IMPROVED':
      return t('autoresearch.statusNotImproved');
    case 'FAILED':
      return t('autoresearch.statusFailed');
    default:
      return status;
  }
}

function getLoopStateLabel(state: string) {
  switch (state) {
    case 'idle':
      return t('autoresearch.loopStateIdle');
    case 'running':
      return t('autoresearch.loopStateRunning');
    case 'paused':
      return t('autoresearch.loopStatePaused');
    case 'stopped':
      return t('autoresearch.loopStateStopped');
    case 'error':
      return t('autoresearch.loopStateError');
    default:
      return state;
  }
}

// ============== Experiment Detail Panel ==============

function ExperimentDetailPanel() {
  const experiments = useAutoResearchStore(s => s.experiments);
  const selectedIdx = useAutoResearchStore(s => s.selectedExperiment);
  const entry = selectedIdx >= 0 ? experiments[selectedIdx] : null;

  if (!entry) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        {t('autoresearch.selectExperimentForDetails')}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 text-sm overflow-y-auto h-full">
      <h3 className="text-lg font-semibold text-gray-800">
        {t('autoresearch.experiment')} #{entry.iteration}
      </h3>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.hypothesis')}</label>
        <p className="text-gray-800 mt-1">{entry.hypothesis}</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.change')}</label>
        <p className="text-gray-700 mt-1 font-mono text-xs">{entry.change}</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.result')}</label>
        <p className="mt-1">
          <StatusBadge status={entry.status} />
          <span className="ml-2 text-gray-700">
            {entry.metricValue !== null ? entry.metricValue : t('autoresearch.notAvailable')}
          </span>
          {entry.failReason && (
            <span className="ml-2 text-red-500 text-xs">({entry.failReason})</span>
          )}
        </p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.reasoning')}</label>
        <p className="text-gray-600 mt-1 whitespace-pre-wrap">{entry.reasoning || t('autoresearch.emptyValue')}</p>
      </div>
      <div className="text-xs text-gray-400">
        {entry.timestamp} · {(entry.durationMs / 1000).toFixed(1)}{t('autoresearch.secondsShort')}
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
      {icons[status]} {getStatusLabel(status)}
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
    terminalVisible, terminalSessionId, terminalCwd,
    openTerminalPanel, setTerminalReady, setTerminalVisible,
  } = useAutoResearchStore();

  const [showSetup, setShowSetup] = useState(!sshConfig);
  const [setupForm, setSetupForm] = useState<SshConfig>(() => loadPersistedSetup());
  const [maxIter, setMaxIter] = useState(50);
  const [metric, setMetric] = useState('val_bpb');
  const [direction, setDirection] = useState<'lower' | 'higher'>('lower');
  const [connectionTest, setConnectionTest] = useState<ConnectionTestState>({ status: 'idle', output: '' });

  useEffect(() => {
    const { password: _password, ...persisted } = setupForm;
    localStorage.setItem(AUTORESEARCH_CONFIG_STORAGE_KEY, JSON.stringify(persisted));
  }, [setupForm]);

  useEffect(() => {
    if (!showSetup) {
      return;
    }
    void assertSupportedPlatform().catch((error) => {
      useAutoResearchStore.getState().setError(
        error instanceof Error ? error.message : String(error),
      );
      setShowSetup(false);
    });
  }, [showSetup]);

  useEffect(() => {
    setConnectionTest((prev) => (prev.status === 'idle'
      ? prev
      : { status: 'idle', output: '' }));
  }, [
    setupForm.mode,
    setupForm.host,
    setupForm.user,
    setupForm.port,
    setupForm.authMode,
    setupForm.password,
    setupForm.keyPath,
    setupForm.remoteWorkDir,
  ]);

  const handlePickLocalWorkDir = useCallback(async () => {
    const selection = await open({
      directory: true,
      multiple: false,
      defaultPath: setupForm.remoteWorkDir || undefined,
    });
    if (typeof selection === 'string') {
      setSetupForm((current) => ({ ...current, remoteWorkDir: selection }));
    }
  }, [setupForm.remoteWorkDir]);

  const handleShowSetup = useCallback(async () => {
    try {
      await assertSupportedPlatform();
      setShowSetup(true);
    } catch (error) {
      useAutoResearchStore.getState().setError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }, []);

  const handleTestConnection = useCallback(async () => {
    try {
      await assertSupportedPlatform();
    } catch (error) {
      useAutoResearchStore.getState().setError(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    const cfg = sshConfig || setupForm;
    setConnectionTest({ status: 'testing', output: t('autoresearch.connectionTesting') });

    try {
      const result = await invoke<RawBashResult>('execute_bash', {
        args: {
          command: buildRemoteBashCommand(cfg, 'uname -s && pwd && git rev-parse --is-inside-work-tree'),
          timeoutSecs: 30,
        },
      });
      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();
      const exitCode = result.exit_code ?? 0;
      if (exitCode !== 0) {
        throw new Error(stderr || stdout || `connection test failed (exit ${exitCode})`);
      }

      const [unameLine = '', pwdLine = '', gitLine = ''] = stdout.split('\n');
      if (cfg.mode === 'ssh' && unameLine.trim() !== 'Linux') {
        throw new Error('Remote target must be Linux');
      }
      if (cfg.mode === 'local' && !['Darwin', 'Linux'].includes(unameLine.trim())) {
        throw new Error('AutoResearch supports macOS and Linux only');
      }

      setConnectionTest({
        status: 'success',
        output: [unameLine, pwdLine, gitLine].filter(Boolean).join('\n'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConnectionTest({ status: 'error', output: message });
      useAutoResearchStore.getState().setError(message);
    }
  }, [setupForm, sshConfig]);

  const handleStart = useCallback(async () => {
    try {
      await assertSupportedPlatform();
    } catch (error) {
      useAutoResearchStore.getState().setError(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

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
    if (connectionTest.status !== 'success') {
      useAutoResearchStore.getState().setError(t('autoresearch.connectionTestRequired'));
      return;
    }
    if (!sshConfig) {
      setSshConfig(cfg);
    }

    let sessionFilePath = '';
    try {
      sessionFilePath = await getDefaultAutoResearchSessionFilePath();
    } catch (error) {
      useAutoResearchStore.getState().setError(
        t('autoresearch.failedToResolveSessionFilePath').replace(
          '{message}',
          error instanceof Error ? error.message : String(error),
        ),
      );
      return;
    }

    initSession({
      id: createStableAutoResearchSessionId(cfg, sessionFilePath, metric, direction),
      maxIterations: maxIter,
      metricName: metric,
      metricDirection: direction,
      sshConfig: cfg,
      sessionFilePath,
    });

    setShowSetup(false);
    openTerminalPanel(`autoresearch-terminal-${Date.now()}`, cfg.mode === 'local' ? cfg.remoteWorkDir : '');

    const sendMessage = createAutoResearchSendMessage(cfg.remoteWorkDir);
    void startExperimentLoop(sendMessage);
  }, [
    connectionTest.status,
    direction,
    initSession,
    maxIter,
    metric,
    openTerminalPanel,
    setSshConfig,
    setupForm,
    sshConfig,
  ]);

  const handlePause = useCallback(() => pauseExperimentLoop(), []);
  const handleResume = useCallback(() => resumeExperimentLoop(), []);
  const handleStop = useCallback(() => stopExperimentLoop(), []);
  const handleTerminalClose = useCallback(() => setTerminalVisible(false), [setTerminalVisible]);
  const handleTerminalReady = useCallback(() => setTerminalReady(true), [setTerminalReady]);
  const handleTerminalExit = useCallback(() => setTerminalReady(false), [setTerminalReady]);

  // ---- Setup form ----
  if (showSetup && loopState === 'idle') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-gray-800">{t('autoresearch.setupTitle')}</h2>
          <p className="text-sm text-gray-500">
            {t('autoresearch.setupDescription')}
          </p>

          <div className="space-y-3">
            {/* Mode toggle */}
            <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSetupForm(f => ({ ...f, mode: 'ssh' }))}
                className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${setupForm.mode === 'ssh' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >{t('autoresearch.modeRemote')}</button>
              <button
                type="button"
                onClick={() => setSetupForm(f => ({ ...f, mode: 'local' }))}
                className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${setupForm.mode === 'local' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >{t('autoresearch.modeLocal')}</button>
            </div>

            {setupForm.mode === 'ssh' && (
              <>
                <input
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder={t('autoresearch.hostPlaceholder')}
                  value={setupForm.host}
                  onChange={e => setSetupForm(f => ({ ...f, host: e.target.value }))}
                />
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                    placeholder={t('autoresearch.userPlaceholder')}
                    value={setupForm.user}
                    onChange={e => setSetupForm(f => ({ ...f, user: e.target.value }))}
                  />
                  <input
                    className="w-20 px-3 py-2 border rounded-lg text-sm"
                    placeholder={t('autoresearch.portPlaceholder')}
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
                  <option value="agent">{t('autoresearch.authAgent')}</option>
                  <option value="password">{t('autoresearch.authPassword')}</option>
                  <option value="key">{t('autoresearch.authKey')}</option>
                </select>
                {setupForm.authMode === 'password' && (
                  <input
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder={t('autoresearch.passwordPlaceholder')}
                    type="password"
                    autoComplete="off"
                    value={setupForm.password}
                    onChange={e => setSetupForm(f => ({ ...f, password: e.target.value }))}
                  />
                )}
                {setupForm.authMode === 'key' && (
                  <input
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder={t('autoresearch.sshKeyPathPlaceholder')}
                    value={setupForm.keyPath}
                    onChange={e => setSetupForm(f => ({ ...f, keyPath: e.target.value }))}
                  />
                )}
              </>
            )}
            {setupForm.mode === 'local' ? (
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  placeholder={t('autoresearch.localWorkDirPlaceholder')}
                  value={setupForm.remoteWorkDir}
                  onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: e.target.value }))}
                />
                <button
                  type="button"
                  className="px-3 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                  onClick={handlePickLocalWorkDir}
                >
                  {t('autoresearch.chooseDirectory')}
                </button>
              </div>
            ) : (
              <input
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder={t('autoresearch.remoteWorkDirPlaceholder')}
                value={setupForm.remoteWorkDir}
                onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: e.target.value }))}
              />
            )}

            <button
              type="button"
              className="w-full py-2 border rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              disabled={
                setupForm.mode === 'ssh'
                  ? (!setupForm.host || !setupForm.user
                      || (setupForm.authMode === 'password' && !setupForm.password)
                      || (setupForm.authMode === 'key' && !setupForm.keyPath)
                      || !setupForm.remoteWorkDir)
                  : !setupForm.remoteWorkDir
              }
              onClick={handleTestConnection}
            >
              {connectionTest.status === 'testing'
                ? t('autoresearch.connectionTesting')
                : t('autoresearch.testConnection')}
            </button>

            {connectionTest.output && (
              <div className={`rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap ${
                connectionTest.status === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : connectionTest.status === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600'
              }`}>
                {connectionTest.output}
              </div>
            )}

            <hr className="border-gray-200" />

            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
                placeholder={t('autoresearch.metricNamePlaceholder')}
                value={metric}
                onChange={e => setMetric(e.target.value)}
              />
              <select
                className="px-3 py-2 border rounded-lg text-sm"
                value={direction}
                onChange={e => setDirection(e.target.value as 'lower' | 'higher')}
              >
                <option value="lower">{t('autoresearch.lowerIsBetter')}</option>
                <option value="higher">{t('autoresearch.higherIsBetter')}</option>
              </select>
            </div>
            <input
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder={t('autoresearch.maxIterationsPlaceholder')}
              type="number"
              value={maxIter}
              onChange={e => setMaxIter(parseInt(e.target.value) || 50)}
            />
          </div>

          <button
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            disabled={
              connectionTest.status !== 'success'
              || (setupForm.mode === 'ssh'
                ? (!setupForm.host || !setupForm.user
                    || (setupForm.authMode === 'password' && !setupForm.password)
                    || (setupForm.authMode === 'key' && !setupForm.keyPath)
                    || !setupForm.remoteWorkDir)
                : !setupForm.remoteWorkDir)
            }
            onClick={handleStart}
          >
            {t('autoresearch.start')}
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
        <span className="font-medium text-gray-700">{getLoopStateLabel(loopState)}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">{t('autoresearch.experimentShort')} {currentIteration}/{maxIterations}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">
          {t('autoresearch.best')}: {bestMetric !== null ? `${metricName}=${bestMetric}` : t('autoresearch.notAvailable')}
        </span>
        {consecutiveFailures > 0 && (
          <>
            <span className="text-gray-400">|</span>
            <span className="text-red-500">⚠ {t('autoresearch.consecutiveFailures').replace('{count}', String(consecutiveFailures))}</span>
          </>
        )}

        <div className="flex-1" />

        {/* Control buttons */}
        {loopState === 'idle' && (
          <button
            onClick={() => { void handleShowSetup(); }}
            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
          >
            ▶ {t('autoresearch.setupAndStart')}
          </button>
        )}
        {loopState === 'running' && (
          <>
            <button onClick={handlePause} className="px-3 py-1 bg-yellow-500 text-white rounded-lg text-xs hover:bg-yellow-600">
              ⏸ {t('autoresearch.pause')}
            </button>
            <button onClick={handleStop} className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600">
              ⏹ {t('autoresearch.stop')}
            </button>
          </>
        )}
        {loopState === 'paused' && (
          <>
            <button onClick={handleResume} className="px-3 py-1 bg-green-500 text-white rounded-lg text-xs hover:bg-green-600">
              ▶ {t('autoresearch.resume')}
            </button>
            <button onClick={handleStop} className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600">
              ⏹ {t('autoresearch.stop')}
            </button>
          </>
        )}
        {(loopState === 'stopped' || loopState === 'error') && (
          <button
            onClick={() => {
              useAutoResearchStore.getState().resetSession();
              void handleShowSetup();
            }}
            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
          >
            ↻ {t('autoresearch.newSession')}
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
            {loopState === 'idle' ? t('autoresearch.emptyIdle') : t('autoresearch.emptyWaiting')}
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

      {terminalSessionId && (
        <div className="rounded-xl border overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b text-xs">
            <span className="font-medium text-gray-700">{t('autoresearch.terminalTitle')}</span>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-700"
              onClick={() => setTerminalVisible(!terminalVisible)}
            >
              {terminalVisible ? t('autoresearch.hideTerminal') : t('autoresearch.showTerminal')}
            </button>
          </div>
          <div
            style={{
              height: terminalVisible ? 260 : 0,
              display: terminalVisible ? undefined : 'none',
            }}
          >
            <TerminalPanel
              sessionId={terminalSessionId}
              cwd={terminalCwd || undefined}
              onClose={handleTerminalClose}
              onSessionReady={handleTerminalReady}
              onSessionExit={handleTerminalExit}
            />
          </div>
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
