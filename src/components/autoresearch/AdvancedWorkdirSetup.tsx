import { useState, useCallback, useEffect, useMemo, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import { TerminalPanel } from '@/components';
import { AutoResearchRunDetailDocument } from '@/components/autoresearch/AutoResearchRunDetailDocument';
import { useSettingsStore } from '@/store';
import {
  useAutoResearchStore,
  type SshConfig,
  getSelectedAutoResearchRunContext,
  getSelectedAutoResearchRun,
  getSortedAutoResearchRuns,
} from '@/store/autoresearchStore';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import { stopExperimentLoop, pauseExperimentLoop, resumeExperimentLoop } from '@/services/autoresearch';
import { assertSupportedPlatform } from '@/services/autoresearch/platformGuard';
import { formatError } from '@/services/autoresearch/errors';
import {
  buildAutoResearchDefaultConfig,
  getAutoResearchDefaultConfig,
  resolveAutoResearchDefaultConfig,
  type AutoResearchDefaultSource,
} from '@/services/autoresearch/defaultConfig';
import { sanitizePathInput } from '@/services/autoresearch/pathInput';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import { openFileExternal } from '@/services/docService';
import { buildRemoteBashCommand } from '@/utils/remoteExec';
import { buildAutoResearchModelDisplayFromSnapshot } from '@/services/autoresearch/modelDisplay';
import {
  logAutoResearchSetupFailure,
  parseOptionalBaseline,
  startAutoResearchRun,
  validateAutoResearchSetupDraft,
} from '@/services/autoresearch/setupFlow';

function formatRunStatusLabel(status: NonNullable<ReturnType<typeof getSelectedAutoResearchRun>>['status']): string {
  return status === 'reflection_failed'
    ? t('autoresearch.statusReflectionFailed')
    : status.replace(/_/g, ' ');
}

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
  const defaults = getAutoResearchDefaultConfig();
  const fallback: SshConfig = {
    mode: 'local',
    host: '',
    user: 'root',
    keyPath: '',
    port: 22,
    remoteWorkDir: defaults.workdir,
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

export function AdvancedWorkdirSetup() {
  const {
    id: activeRunId,
    sshConfig,
    setSelectedExperiment, initSession, setSshConfig, runHistory, selectRun,
    terminalVisible, terminalSessionId, terminalCwd,
    openTerminalPanel, setTerminalReady, setTerminalVisible,
  } = useAutoResearchStore();
  const lastUsedConfig = useAutoResearchStore((state) => state.lastUsedConfig);
  const setLastUsedConfig = useAutoResearchStore((state) => state.setLastUsedConfig);
  const clearLastUsedConfig = useAutoResearchStore((state) => state.clearLastUsedConfig);
  const selectedRunContext = useAutoResearchStore(getSelectedAutoResearchRunContext);
  const selectedRun = selectedRunContext.run;
  const sortedRuns = useAutoResearchStore(getSortedAutoResearchRuns);
  const activeConfigId = useSettingsStore((state) => state.activeConfigId);
  const apiConfigs = useSettingsStore((state) => state.apiConfigs);
  const windowsShellProfile = useSettingsStore((state) => state.windowsShellProfile);

  const [showSetup, setShowSetup] = useState(!sshConfig && runHistory.length === 0);
  const [setupForm, setSetupForm] = useState<SshConfig>(() => loadPersistedSetup());
  const [maxIter, setMaxIter] = useState(getAutoResearchDefaultConfig().iterations);
  const [metric, setMetric] = useState(getAutoResearchDefaultConfig().metric);
  const [direction, setDirection] = useState<'lower' | 'higher'>(getAutoResearchDefaultConfig().direction);
  const [experimentDir, setExperimentDir] = useState(getAutoResearchDefaultConfig().experimentDir);
  const [baselineInput, setBaselineInput] = useState('');
  const [prefillSource, setPrefillSource] = useState<AutoResearchDefaultSource>('defaults');
  const [connectionTest, setConnectionTest] = useState<ConnectionTestState>({ status: 'idle', output: '' });
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showRunList, setShowRunList] = useState(false);
  const agentConfig = useMemo(
    () => resolveActiveAgentConfig(),
    [activeConfigId, apiConfigs],
  );
  const agentConfigIssues = validateResolvedAgentConfig(agentConfig);
  const agentConfigError = agentConfigIssues.length > 0
    ? formatAgentConfigValidationError(agentConfig, agentConfigIssues)
    : '';
  const displayRun = selectedRun;
  const displayedLiveOutput = selectedRunContext.liveOutput;
  const displayReason = selectedRunContext.reason;
  const loopState = selectedRunContext.loopState;
  const statusMessage = selectedRunContext.statusMessage;
  const baselineInvalid = baselineInput.trim().length > 0 && parseOptionalBaseline(baselineInput) === null;

  useEffect(() => {
    const { password: _password, ...persisted } = setupForm;
    localStorage.setItem(AUTORESEARCH_CONFIG_STORAGE_KEY, JSON.stringify(persisted));
  }, [setupForm]);

  useEffect(() => {
    if (!showSetup) {
      return;
    }
    const resolved = resolveAutoResearchDefaultConfig(lastUsedConfig);
    setSetupForm((current) => ({
      ...current,
      remoteWorkDir: resolved.config.workdir,
    }));
    setMetric(resolved.config.metric);
    setDirection(resolved.config.direction);
    setMaxIter(resolved.config.iterations);
    setExperimentDir(resolved.config.experimentDir);
    setPrefillSource(resolved.source);
    setSetupError(null);
    setIsStarting(false);
  }, [lastUsedConfig, showSetup]);

  useEffect(() => {
    if (activeRunId) {
      setShowRunList(false);
    }
  }, [activeRunId]);

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

  useEffect(() => {
    setSetupError(null);
  }, [agentConfigError, baselineInput, direction, experimentDir, maxIter, metric, setupForm, connectionTest.status]);

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
    setSetupError(null);
    setShowSetup(true);
  }, []);

  const handleResetToDefaults = useCallback(() => {
    const defaults = getAutoResearchDefaultConfig();
    clearLastUsedConfig();
    setSetupForm((current) => ({
      ...current,
      remoteWorkDir: defaults.workdir,
    }));
    setMetric(defaults.metric);
    setDirection(defaults.direction);
    setMaxIter(defaults.iterations);
    setExperimentDir(defaults.experimentDir);
    setPrefillSource('defaults');
    setSetupError(null);
  }, [clearLastUsedConfig]);

  const handleTestConnection = useCallback(async () => {
    const cfg = setupForm;
    try {
      await assertSupportedPlatform(cfg);
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
      return;
    }

    setConnectionTest({ status: 'testing', output: t('autoresearch.connectionTesting') });

    try {
      const result = await invoke<RawBashResult>('execute_bash', {
        args: {
          command: buildRemoteBashCommand(cfg, 'uname -s && pwd && git rev-parse --is-inside-work-tree'),
          timeoutSecs: 30,
          windowsShellProfile,
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
    }
  }, [setupForm, windowsShellProfile]);

  const handleStart = useCallback(async () => {
    const validation = validateAutoResearchSetupDraft({
      sshConfig: setupForm,
      experimentDir,
      metric,
      direction,
      iterations: maxIter,
      baselineInput,
      agentConfigError,
      requireConnectionTest: true,
      connectionTestStatus: connectionTest.status,
    });
    if (!validation.value) {
      setSetupError(validation.error);
      return;
    }

    setIsStarting(true);
    setSetupError(null);

    try {
      const started = await startAutoResearchRun(validation.value, {
        setSshConfig,
        setLastUsedConfig,
        initSession,
      });

      setShowSetup(false);
      openTerminalPanel(
        `autoresearch-terminal-${Date.now()}`,
        started.resolvedConfig.mode === 'local' ? started.resolvedConfig.remoteWorkDir : '',
      );
    } catch (error) {
      setSetupError(logAutoResearchSetupFailure('page-start', error, {
        mode: validation.value.sshConfig.mode,
        experimentDir: validation.value.experimentDir,
        workdir: validation.value.sshConfig.remoteWorkDir,
      }));
    } finally {
      setIsStarting(false);
    }
  }, [
    agentConfigError,
    baselineInput,
    connectionTest.status,
    direction,
    experimentDir,
    initSession,
    maxIter,
    metric,
    openTerminalPanel,
    setLastUsedConfig,
    setSshConfig,
    setupForm,
  ]);

  const handleSetupSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleStart();
  }, [handleStart]);

  const handlePause = useCallback(() => pauseExperimentLoop(), []);
  const handleResume = useCallback(() => resumeExperimentLoop(), []);
  const handleStop = useCallback(() => stopExperimentLoop(), []);
  const handleTerminalClose = useCallback(() => setTerminalVisible(false), [setTerminalVisible]);
  const handleTerminalReady = useCallback(() => setTerminalReady(true), [setTerminalReady]);
  const handleTerminalExit = useCallback(() => setTerminalReady(false), [setTerminalReady]);

  const handleOpenRunArtifact = useCallback(() => {
    const targetPath = displayRun?.config.livingDocPath
      || displayRun?.config.sessionFilePath
      || displayRun?.config.experimentDir;
    if (targetPath) {
      void openFileExternal(targetPath);
    }
  }, [displayRun]);

  const runControls = selectedRunContext.isActive ? (
    <div className="flex flex-wrap items-center gap-2">
      {loopState === 'running' && (
        <>
          <button onClick={handlePause} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700 hover:bg-amber-100">
            Pause
          </button>
          <button onClick={handleStop} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
            Stop
          </button>
        </>
      )}
      {loopState === 'paused' && (
        <>
          <button onClick={handleResume} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-[12px] font-medium text-green-700 hover:bg-green-100">
            Resume
          </button>
          <button onClick={handleStop} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
            Stop
          </button>
        </>
      )}
    </div>
  ) : null;

  if (showSetup) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-gray-800">{t('autoresearch.setupTitle')}</h2>
          <p className="text-sm text-gray-500">
            {t('autoresearch.setupDescription')}
          </p>

          <form className="space-y-3" onSubmit={handleSetupSubmit}>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <span>
                {prefillSource === 'last-used'
                  ? t('autoresearch.prefillLastUsed')
                  : t('autoresearch.prefillDefaults')}
              </span>
              <button
                type="button"
                className="font-semibold hover:text-blue-800"
                onClick={handleResetToDefaults}
              >
                {t('autoresearch.resetToDefaults')}
              </button>
            </div>
            <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
              <button
                type="button"
                onClick={() => setSetupForm((current) => ({ ...current, mode: 'ssh' }))}
                className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition-all ${setupForm.mode === 'ssh' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >{t('autoresearch.modeRemote')}</button>
              <button
                type="button"
                onClick={() => setSetupForm((current) => ({ ...current, mode: 'local' }))}
                className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition-all ${setupForm.mode === 'local' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >{t('autoresearch.modeLocal')}</button>
            </div>

            {setupForm.mode === 'ssh' && (
              <>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder={t('autoresearch.hostPlaceholder')}
                  value={setupForm.host}
                  onChange={(event) => setSetupForm((current) => ({ ...current, host: event.target.value }))}
                />
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2 text-sm"
                    placeholder={t('autoresearch.userPlaceholder')}
                    value={setupForm.user}
                    onChange={(event) => setSetupForm((current) => ({ ...current, user: event.target.value }))}
                  />
                  <input
                    className="w-20 rounded-lg border px-3 py-2 text-sm"
                    placeholder={t('autoresearch.portPlaceholder')}
                    type="number"
                    value={setupForm.port}
                    onChange={(event) => setSetupForm((current) => ({ ...current, port: Number.parseInt(event.target.value, 10) || 22 }))}
                  />
                </div>
                <select
                  className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                  value={setupForm.authMode}
                  onChange={(event) => setSetupForm((current) => ({ ...current, authMode: event.target.value as SshConfig['authMode'] }))}
                >
                  <option value="agent">{t('autoresearch.authAgent')}</option>
                  <option value="password">{t('autoresearch.authPassword')}</option>
                  <option value="key">{t('autoresearch.authKey')}</option>
                </select>
                {setupForm.authMode === 'password' && (
                  <input
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder={t('autoresearch.passwordPlaceholder')}
                    type="password"
                    autoComplete="off"
                    value={setupForm.password}
                    onChange={(event) => setSetupForm((current) => ({ ...current, password: event.target.value }))}
                  />
                )}
                {setupForm.authMode === 'key' && (
                  <input
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder={t('autoresearch.sshKeyPathPlaceholder')}
                    value={setupForm.keyPath}
                    onChange={(event) => setSetupForm((current) => ({ ...current, keyPath: event.target.value }))}
                  />
                )}
              </>
            )}

            {setupForm.mode === 'local' ? (
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border px-3 py-2 text-sm"
                  placeholder={t('autoresearch.localWorkDirPlaceholder')}
                  value={setupForm.remoteWorkDir}
                  onChange={(event) => setSetupForm((current) => ({ ...current, remoteWorkDir: sanitizePathInput(event.target.value) }))}
                />
                <button
                  type="button"
                  className="rounded-lg border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={handlePickLocalWorkDir}
                >
                  {t('autoresearch.chooseDirectory')}
                </button>
              </div>
            ) : (
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                placeholder={t('autoresearch.remoteWorkDirPlaceholder')}
                value={setupForm.remoteWorkDir}
                onChange={(event) => setSetupForm((current) => ({ ...current, remoteWorkDir: sanitizePathInput(event.target.value) }))}
              />
            )}

            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder={t('autoresearch.experimentDirPlaceholder')}
              value={experimentDir}
              onChange={(event) => setExperimentDir(sanitizePathInput(event.target.value))}
            />

            <button
              type="button"
              className="w-full rounded-lg border py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              disabled={
                setupForm.mode === 'ssh'
                  ? (!setupForm.host || !setupForm.user
                      || (setupForm.authMode === 'password' && !setupForm.password)
                      || (setupForm.authMode === 'key' && !setupForm.keyPath)
                      || !setupForm.remoteWorkDir
                      || !experimentDir
                      || Boolean(agentConfigError)
                      || baselineInvalid)
                  : !setupForm.remoteWorkDir || !experimentDir || Boolean(agentConfigError) || baselineInvalid
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
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                placeholder={t('autoresearch.metricNamePlaceholder')}
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
              />
              <select
                className="rounded-lg border px-3 py-2 text-sm"
                value={direction}
                onChange={(event) => setDirection(event.target.value as 'lower' | 'higher')}
              >
                <option value="lower">{t('autoresearch.lowerIsBetter')}</option>
                <option value="higher">{t('autoresearch.higherIsBetter')}</option>
              </select>
            </div>
            <input
              className={`w-full rounded-lg border px-3 py-2 text-sm ${baselineInvalid ? 'border-red-300' : ''}`}
              placeholder="Baseline (optional, e.g. 0.963284)"
              value={baselineInput}
              onChange={(event) => setBaselineInput(event.target.value)}
            />
            {baselineInvalid && (
              <div className="text-xs text-red-500">{t('autoresearch.validationBaselineNumber')}</div>
            )}
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder={t('autoresearch.maxIterationsPlaceholder')}
              type="number"
              value={maxIter}
              onChange={(event) => setMaxIter(buildAutoResearchDefaultConfig({ iterations: Number.parseInt(event.target.value, 10) || 50 }).iterations)}
            />
            {setupError && setupError !== agentConfigError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                {setupError}
              </div>
            )}
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={isStarting}
              aria-busy={isStarting}
            >
              {isStarting ? t('autoresearch.starting') : t('autoresearch.start')}
            </button>
            {agentConfigError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {agentConfigError}
              </div>
            )}
          </form>
        </div>
      </div>
    );
  }

  if (!displayRun && sortedRuns.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-2xl bg-indigo-50 p-4 text-indigo-500">
          <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-800">AutoResearch</h2>
        <p className="mt-2 max-w-md text-sm text-gray-500">{t('autoresearch.emptyIdle')}</p>
        <button
          onClick={() => { void handleShowSetup(); }}
          className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t('autoresearch.setupAndStart')}
        </button>
      </div>
    );
  }

  if (showRunList) {
    return (
      <div className="flex-1 overflow-y-auto bg-[#f6f1e8] p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8f8375]">AutoResearch</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[#2f251a]">Run History</h2>
            </div>
            <button
              onClick={() => { void handleShowSetup(); }}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              New Run
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedRuns.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => {
                  selectRun(run.id);
                  setSelectedExperiment(-1);
                  setShowSetup(false);
                  setShowRunList(false);
                }}
                className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition-colors ${
                  displayRun?.id === run.id ? 'border-blue-300 ring-2 ring-blue-100' : 'border-[#ebe4d9] hover:border-[#d8cfc1]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-[#dceeea] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0f766e]">
                    {formatRunStatusLabel(run.status)}
                  </span>
                  <span className="font-mono text-[11px] text-[#8a7f72]">{run.currentIteration}/{run.config.iterations}</span>
                </div>
                <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-[#2f251a]">{run.title}</h3>
                <p className="mt-2 truncate text-xs text-[#6f665c]">{run.config.metric} · {run.config.direction}</p>
                <p className="mt-1 truncate text-xs text-[#8a7f72]">{buildAutoResearchModelDisplayFromSnapshot(run.config.configSnapshot).compactLabel}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f1e8]">
      {statusMessage && loopState !== 'error' && (
        <div className="border-b border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
          {redactSensitiveText(statusMessage)}
        </div>
      )}
      {loopState === 'error' && displayReason && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {redactSensitiveText(displayReason)}
        </div>
      )}
      {displayRun && (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <AutoResearchRunDetailDocument
            run={displayRun}
            liveOutput={displayedLiveOutput}
            onBack={() => setShowRunList(true)}
            onOpen={handleOpenRunArtifact}
            onClose={() => setShowRunList(true)}
            headerActions={runControls}
            className="min-h-[calc(100vh-2rem)] rounded-[28px] border border-[#e7ded1]"
          />
        </div>
      )}
      {terminalSessionId && (
        <div className="mx-4 mb-4 overflow-hidden rounded-xl border bg-white">
          <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-2 text-xs">
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

export default AdvancedWorkdirSetup;
