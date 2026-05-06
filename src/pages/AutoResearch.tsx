/**
 * AutoResearch Page — Experiment monitoring & control dashboard.
 *
 * Layout: MainLayout with experiment timeline in center and detail panel on right.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import { TerminalPanel } from '@/components';
import { MainLayout } from '@/layout';
import { useSettingsStore } from '@/store';
import {
  useAutoResearchStore,
  type SshConfig,
  getSelectedAutoResearchRun,
  getSortedAutoResearchRuns,
} from '@/store/autoresearchStore';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import {
  createAutoResearchSendMessage,
  startExperimentLoop,
  stopExperimentLoop,
  pauseExperimentLoop,
  resumeExperimentLoop,
} from '@/services/autoresearch';
import { assertSupportedPlatform } from '@/services/autoresearch/platformGuard';
import { runAutoResearchPreflight } from '@/services/autoresearch/preflight';
import { formatError } from '@/services/autoresearch/errors';
import { createAutoResearchRunId } from '@/services/autoresearch/history';
import { resolveAutoResearchRunConfig } from '@/services/autoresearch/runConfig';
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

// ============== Experiment Detail Panel ==============

function ExperimentDetailPanel() {
  const selectedRun = useAutoResearchStore(getSelectedAutoResearchRun);
  const selectedIdx = useAutoResearchStore(s => s.selectedExperiment);
  const entry = selectedRun && selectedIdx >= 0 ? selectedRun.iterations[selectedIdx] : null;

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
        {t('autoresearch.experiment')} #{entry.index}
      </h3>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.hypothesis')}</label>
        <p className="text-gray-800 mt-1">{entry.hypothesis || t('autoresearch.emptyValue')}</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.change')}</label>
        <p className="text-gray-700 mt-1 font-mono text-xs whitespace-pre-wrap">{entry.change || t('autoresearch.emptyValue')}</p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.result')}</label>
        <p className="mt-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {entry.status}
          </span>
          <span className="ml-2 text-gray-700">
            {entry.metricValue !== null && entry.metricValue !== undefined ? entry.metricValue : t('autoresearch.notAvailable')}
          </span>
          {entry.error && (
            <span className="ml-2 text-red-500 text-xs">({entry.error})</span>
          )}
        </p>
      </div>
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider">{t('autoresearch.reasoning')}</label>
        <p className="text-gray-600 mt-1 whitespace-pre-wrap">{entry.reasoning || t('autoresearch.emptyValue')}</p>
      </div>
      {entry.artifactPaths && entry.artifactPaths.length > 0 && (
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wider">Artifacts</label>
          <div className="mt-1 space-y-1">
            {entry.artifactPaths.slice(0, 8).map((artifactPath) => (
              <p key={artifactPath} className="text-xs text-gray-500 break-all font-mono">{artifactPath}</p>
            ))}
          </div>
        </div>
      )}
      {selectedRun && selectedRun.events.length > 0 && (
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wider">Recent events</label>
          <div className="mt-1 space-y-1">
            {selectedRun.events.slice(-5).reverse().map((event) => (
              <p key={event.id} className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{event.phase}</span>
                <span className="text-gray-300"> · </span>
                {event.message}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="text-xs text-gray-400">
        {[entry.startedAt, entry.endedAt].filter(Boolean).join(' → ')}
      </div>
    </div>
  );
}

// ============== Main View ==============

function AutoResearchView() {
  const {
    id: activeRunId,
    loopState, currentIteration, maxIterations, bestMetric,
    metricName, consecutiveFailures,
    liveOutput, sshConfig, statusMessage, agentConfigSnapshot,
    setSelectedExperiment, initSession, setSshConfig, runHistory, selectRun,
    terminalVisible, terminalSessionId, terminalCwd,
    openTerminalPanel, setTerminalReady, setTerminalVisible,
  } = useAutoResearchStore();
  const selectedRun = useAutoResearchStore(getSelectedAutoResearchRun);
  const sortedRuns = useAutoResearchStore(getSortedAutoResearchRuns);
  const activeConfigId = useSettingsStore((state) => state.activeConfigId);
  const apiConfigs = useSettingsStore((state) => state.apiConfigs);

  const [showSetup, setShowSetup] = useState(!sshConfig && runHistory.length === 0);
  const [setupForm, setSetupForm] = useState<SshConfig>(() => loadPersistedSetup());
  const [maxIter, setMaxIter] = useState(50);
  const [metric, setMetric] = useState('val_bpb');
  const [direction, setDirection] = useState<'lower' | 'higher'>('lower');
  const [connectionTest, setConnectionTest] = useState<ConnectionTestState>({ status: 'idle', output: '' });
  const agentConfig = useMemo(
    () => resolveActiveAgentConfig(),
    [activeConfigId, apiConfigs],
  );
  const agentConfigIssues = validateResolvedAgentConfig(agentConfig);
  const agentConfigError = agentConfigIssues.length > 0
    ? formatAgentConfigValidationError(agentConfig, agentConfigIssues)
    : '';
  const displayRun = selectedRun;
  const displayedCurrentIteration = displayRun?.currentIteration ?? currentIteration;
  const displayedMaxIterations = displayRun?.config.iterations ?? maxIterations;
  const displayedMetricName = displayRun?.config.metric ?? metricName;
  const displayedBestMetric = displayRun?.bestMetricValue ?? bestMetric;
  const displayedIterations = displayRun?.iterations ?? [];
  const displayedLiveOutput = displayRun?.id === activeRunId ? liveOutput : (displayRun?.liveOutputExcerpt || '');
  const displayedStatus = displayRun?.status ?? loopState;
  const displayedConfigSnapshot = displayRun?.config.configSnapshot ?? agentConfigSnapshot;

  useEffect(() => {
    const { password: _password, ...persisted } = setupForm;
    localStorage.setItem(AUTORESEARCH_CONFIG_STORAGE_KEY, JSON.stringify(persisted));
  }, [setupForm]);

  useEffect(() => {
    if (!showSetup) {
      return;
    }
    void assertSupportedPlatform().catch((error) => {
      useAutoResearchStore.getState().setError(formatError(error));
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
      useAutoResearchStore.getState().setError(formatError(error));
    }
  }, []);

  const handleTestConnection = useCallback(async () => {
    try {
      await assertSupportedPlatform();
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
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
      const message = formatError(error);
      setConnectionTest({ status: 'error', output: message });
      useAutoResearchStore.getState().setError(message);
    }
  }, [setupForm, sshConfig]);

  const handleStart = useCallback(async () => {
    try {
      await assertSupportedPlatform();
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
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

    let runConfig;
    try {
      runConfig = resolveAutoResearchRunConfig();
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
      return;
    }

    const sessionId = createAutoResearchRunId();

    try {
      const preflight = await runAutoResearchPreflight({
        sshConfig: cfg,
        experimentDir: useAutoResearchStore.getState().experimentDir || cfg.remoteWorkDir,
        workDir: cfg.remoteWorkDir,
        sessionId,
        agentConfig: runConfig.agentConfig,
      });

      const resolvedConfig = {
        ...cfg,
        remoteWorkDir: preflight.resolvedWorkDir,
      };

      if (!sshConfig) {
        setSshConfig(resolvedConfig);
      }

      initSession({
        id: sessionId,
        maxIterations: maxIter,
        metricName: metric,
        metricDirection: direction,
        sshConfig: resolvedConfig,
        experimentDir: preflight.resolvedExperimentDir,
        sessionFilePath: preflight.sessionFilePath,
        livingDocPath: preflight.livingDocPath,
        agentConfigSnapshot: runConfig.snapshot,
      });

      setShowSetup(false);
      openTerminalPanel(`autoresearch-terminal-${Date.now()}`, resolvedConfig.mode === 'local' ? resolvedConfig.remoteWorkDir : '');

      const sendMessage = createAutoResearchSendMessage(
        preflight.resolvedExperimentDir,
        preflight.agentConfig,
        {
          environmentSummary: preflight.environmentSummary,
          metricName: metric,
          direction,
          maxIterations: maxIter,
        },
      );
      void startExperimentLoop(sendMessage);
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
    }
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
                      || !setupForm.remoteWorkDir
                      || Boolean(agentConfigError))
                  : !setupForm.remoteWorkDir || Boolean(agentConfigError)
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
                      || !setupForm.remoteWorkDir
                      || Boolean(agentConfigError))
                  : !setupForm.remoteWorkDir || Boolean(agentConfigError))
              }
              onClick={handleStart}
            >
              {t('autoresearch.start')}
            </button>
            {agentConfigError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {agentConfigError}
              </div>
            )}
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
          displayedStatus === 'running' ? 'bg-green-500 animate-pulse' :
          displayedStatus === 'waiting_rate_limit' ? 'bg-yellow-500' :
          displayedStatus === 'failed' ? 'bg-red-500' : 'bg-gray-400'
        }`} />
        <span className="font-medium text-gray-700">{String(displayedStatus).replace(/_/g, ' ')}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">{t('autoresearch.experimentShort')} {displayedCurrentIteration}/{displayedMaxIterations}</span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">
          {t('autoresearch.best')}: {displayedBestMetric !== null && displayedBestMetric !== undefined ? `${displayedMetricName}=${displayedBestMetric}` : t('autoresearch.notAvailable')}
        </span>
        {(displayRun?.failureCount ?? consecutiveFailures) > 0 && (
          <>
            <span className="text-gray-400">|</span>
            <span className="text-red-500">⚠ {t('autoresearch.consecutiveFailures').replace('{count}', String(displayRun?.failureCount ?? consecutiveFailures))}</span>
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
        {loopState === 'running' && displayRun?.id === activeRunId && (
          <>
            <button onClick={handlePause} className="px-3 py-1 bg-yellow-500 text-white rounded-lg text-xs hover:bg-yellow-600">
              ⏸ {t('autoresearch.pause')}
            </button>
            <button onClick={handleStop} className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600">
              ⏹ {t('autoresearch.stop')}
            </button>
          </>
        )}
        {loopState === 'paused' && displayRun?.id === activeRunId && (
          <>
            <button onClick={handleResume} className="px-3 py-1 bg-green-500 text-white rounded-lg text-xs hover:bg-green-600">
              ▶ {t('autoresearch.resume')}
            </button>
            <button onClick={handleStop} className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600">
              ⏹ {t('autoresearch.stop')}
            </button>
          </>
        )}
        {(loopState === 'stopped' || loopState === 'error' || displayRun?.id !== activeRunId) && (
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

      {sortedRuns.length > 0 && (
        <div className="rounded-lg border px-3 py-2 bg-white">
          <div className="text-xs font-semibold text-gray-600 mb-2">Recent runs</div>
          <div className="flex flex-wrap gap-2">
            {sortedRuns.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => {
                  selectRun(run.id);
                  setSelectedExperiment(-1);
                  setShowSetup(false);
                }}
                className={`rounded-md border px-2 py-1 text-xs text-left ${
                  displayRun?.id === run.id ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div className="font-medium truncate max-w-[220px]">{run.title}</div>
                <div className="text-[11px] opacity-80">{run.status.replace(/_/g, ' ')} · {run.currentIteration}/{run.config.iterations}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {displayedConfigSnapshot && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-800">
          <div className="font-medium">
            Run config: {displayedConfigSnapshot.configName} · {displayedConfigSnapshot.provider} · {displayedConfigSnapshot.model} · {displayedConfigSnapshot.source}
          </div>
          <div className="mt-1 break-all text-blue-700">
            {displayedConfigSnapshot.apiFormat} · {displayedConfigSnapshot.baseUrl} · key {displayedConfigSnapshot.keyPreview || '<EMPTY>'}
          </div>
          <div className="mt-1 text-blue-700">
            This run is using the config captured when the run started. Start a new run to use latest Settings.
          </div>
          {displayedConfigSnapshot.warning && (
            <div className="mt-1 text-amber-700">{displayedConfigSnapshot.warning}</div>
          )}
        </div>
      )}

      {statusMessage && loopState !== 'error' && (
        <div className="px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
          {statusMessage}
        </div>
      )}

      {/* Error banner */}
      {loopState === 'error' && (
        <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {useAutoResearchStore.getState().errorMessage}
        </div>
      )}

      {/* Experiment Timeline */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {displayedIterations.length === 0 ? (
          <div className="text-center text-gray-400 text-sm mt-20">
            {sortedRuns.length === 0 && loopState === 'idle' ? t('autoresearch.emptyIdle') : t('autoresearch.emptyWaiting')}
          </div>
        ) : (
          displayedIterations.map((exp, idx) => (
            <button
              key={exp.id}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm text-left transition
                ${idx === useAutoResearchStore.getState().selectedExperiment
                  ? 'bg-blue-50 border border-blue-200'
                  : 'hover:bg-gray-50'}`}
              onClick={() => setSelectedExperiment(idx)}
            >
              <span className="w-8 text-gray-400 text-xs">#{exp.index}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                {exp.status}
              </span>
              <span className="flex-1 text-gray-700 truncate">{exp.hypothesis || 'Pending iteration'}</span>
              <span className="text-gray-400 text-xs font-mono">
                {exp.metricValue !== null && exp.metricValue !== undefined ? exp.metricValue : '—'}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Live output */}
      {displayedLiveOutput && (
        <div className="max-h-32 overflow-y-auto bg-gray-900 text-green-400 text-xs font-mono p-3 rounded-lg">
          <pre className="whitespace-pre-wrap">{displayedLiveOutput}</pre>
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
