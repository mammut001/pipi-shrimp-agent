/**
 * AutoResearch Page - Experiment monitoring & control dashboard.
 *
 * Layout: MainLayout with experiment timeline in center and detail panel on right.
 */

import { useState, useCallback, useEffect, useMemo, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import { TerminalPanel } from '@/components';
import {
  AutoResearchActiveRunBanner,
  AutoResearchInlineHint,
  AutoResearchMetricSummary,
  AutoResearchPathSummary,
  AutoResearchConnectionStatusPanel,
  AutoResearchReadinessRow,
  AutoResearchRunHistoryCard,
  AutoResearchSummaryItem,
  AutoResearchTargetSummary,
} from '@/components/autoresearch/AutoResearchSetupHelpers';
import { AutoResearchTabs } from '@/components/autoresearch/AutoResearchTabs';
import { AutoResearchRunDetailDocument } from '@/components/autoresearch/AutoResearchRunDetailDocument';
import { MainLayout } from '@/layout';
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
import {
  buildAutoResearchRunLockMessage,
  useAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
import { openFileExternal } from '@/services/docService';
import { buildRemoteBashCommand } from '@/utils/remoteExec';
import {
  buildAutoResearchConnectionProbeCommand,
  interpretAutoResearchConnectionProbe,
} from '@/services/autoresearch/connectionProbe';
import {
  normalizePathForWindowsShellSelection,
  shouldAutoOpenAutoResearchTerminal,
} from '@/utils/windowsShellProfile';
import {
  logAutoResearchSetupFailure,
  parseOptionalBaseline,
  startAutoResearchRun,
  validateAutoResearchSetupDraft,
} from '@/services/autoresearch/setupFlow';

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

  const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
  const asNumber = (value: unknown, fallbackNumber: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallbackNumber;
  const asMode = (value: unknown): SshConfig['mode'] => (value === 'ssh' || value === 'local' ? value : 'local');
  const asAuthMode = (value: unknown): SshConfig['authMode'] =>
    value === 'agent' || value === 'password' || value === 'key' ? value : 'agent';

  try {
    const raw = localStorage.getItem(AUTORESEARCH_CONFIG_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }
    const obj = parsed as Record<string, unknown>;
    return {
      mode: asMode(obj.mode),
      host: asString(obj.host),
      user: asString(obj.user) || 'root',
      keyPath: asString(obj.keyPath),
      port: asNumber(obj.port, 22),
      remoteWorkDir: asString(obj.remoteWorkDir) || defaults.workdir,
      authMode: asAuthMode(obj.authMode),
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
        {[entry.startedAt, entry.endedAt].filter(Boolean).join(' -> ')}
      </div>
    </div>
  );
}

// ============== Main View ==============

function AutoResearchView() {
  const {
    id: activeRunId,
    sshConfig,
    setSelectedExperiment, initSession, setSshConfig, runHistory, selectRun,
    deleteRun, deleteRuns,
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
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);

  const isSelectMode = batchSelectedIds.length > 0;

  const handleToggleSelectRun = (runId: string) => {
    setBatchSelectedIds((prev) =>
      prev.includes(runId)
        ? prev.filter((id) => id !== runId)
        : [...prev, runId]
    );
  };

  const handleExitSelection = () => {
    setBatchSelectedIds([]);
  };

  const handleBatchDelete = () => {
    if (batchSelectedIds.length === 0) return;
    const confirmMessage = t('autoresearch.batchDeleteConfirm', { count: batchSelectedIds.length });
    if (window.confirm(confirmMessage)) {
      deleteRuns(batchSelectedIds);
      setBatchSelectedIds([]);
    }
  };

  const handleSingleDelete = (runId: string) => {
    const confirmMessage = t('autoresearch.deleteConfirm');
    if (window.confirm(confirmMessage)) {
      deleteRun(runId);
    }
  };
  const agentConfig = useMemo(
    () => resolveActiveAgentConfig(),
    [activeConfigId, apiConfigs],
  );
  const agentConfigIssues = validateResolvedAgentConfig(agentConfig);
  const agentConfigError = agentConfigIssues.length > 0
    ? formatAgentConfigValidationError(agentConfig, agentConfigIssues)
    : '';
  const lifecycleLock = useAutoResearchLifecycleLock();
  const displayRun = selectedRun;
  const activeRun = useMemo(
    () => (activeRunId ? sortedRuns.find((run) => run.id === activeRunId) ?? null : null),
    [activeRunId, sortedRuns],
  );
  const displayedLiveOutput = selectedRunContext.liveOutput;
  const displayReason = selectedRunContext.reason;
  const loopState = selectedRunContext.loopState;
  const statusMessage = selectedRunContext.statusMessage;
  const baselineInvalid = baselineInput.trim().length > 0 && parseOptionalBaseline(baselineInput) === null;
  const setupLocked = lifecycleLock.locked;
  const providerReady = !agentConfigError;
  const workdirReady = Boolean(setupForm.remoteWorkDir.trim());
  const experimentDirReady = Boolean(experimentDir.trim());
  const metricReady = Boolean(metric.trim());
  const sshReady = setupForm.mode === 'local'
    ? true
    : Boolean(setupForm.host.trim() && setupForm.user.trim());
  const connectionTestReady = connectionTest.status === 'success';
  const testConnectionDisabled = setupLocked
    || (setupForm.mode === 'ssh'
      ? (!setupForm.host || !setupForm.user
          || (setupForm.authMode === 'password' && !setupForm.password)
          || (setupForm.authMode === 'key' && !setupForm.keyPath)
          || !setupForm.remoteWorkDir
          || !experimentDir
          || Boolean(agentConfigError)
          || baselineInvalid)
      : !setupForm.remoteWorkDir || !experimentDir || Boolean(agentConfigError) || baselineInvalid);

  const handleViewActiveRun = useCallback(() => {
    const targetRunId = activeRunId || selectedRun?.id || sortedRuns[0]?.id;
    if (!targetRunId) {
      return;
    }
    selectRun(targetRunId);
    setSelectedExperiment(-1);
    setSetupError(null);
    setShowSetup(false);
    setShowRunList(false);
  }, [activeRunId, selectRun, selectedRun?.id, setSelectedExperiment, sortedRuns]);

  const getLifecycleLockMessage = useCallback((action: string) => (
    buildAutoResearchRunLockMessage(action, lifecycleLock)
  ), [lifecycleLock]);

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

  // Stop the in-flight AutoResearch loop if the user navigates away from
  // this page (e.g. back to Chat). Without this, the SSH session and the
  // next LLM call would keep running and burning tokens in the background.
  //
  // AUDIT-FIX [R5-04]: Stop on ANY non-terminal state. The set is
  // sourced from the canonical `LoopState` type in autoresearchStore
  // (idle | running | paused | stopped | error). Previously this only
  // stopped when loopState === 'running', so a paused loop on a
  // different page would keep its SSH session and reconnect on next
  // visit. We now treat 'running' and 'paused' as live and the rest
  // as terminal — 'stopped' is already stopped so calling stop again
  // is a no-op but harmless.
  useEffect(() => {
    return () => {
      const state = useAutoResearchStore.getState();
      if (state.loopState === 'running' || state.loopState === 'paused') {
        stopExperimentLoop();
      }
    };
  }, []);

  const handlePickLocalWorkDir = useCallback(async () => {
    if (setupLocked) {
      setSetupError(getLifecycleLockMessage('change the workdir'));
      return;
    }

    const selection = await open({
      directory: true,
      multiple: false,
      defaultPath: setupForm.remoteWorkDir || undefined,
    });
    if (typeof selection === 'string') {
      setSetupForm((current) => ({
        ...current,
        remoteWorkDir: normalizePathForWindowsShellSelection(selection, windowsShellProfile),
      }));
    }
  }, [getLifecycleLockMessage, setupForm.remoteWorkDir, setupLocked, windowsShellProfile]);

  const handlePickExperimentDir = useCallback(async () => {
    if (setupLocked) {
      setSetupError(getLifecycleLockMessage('change the experiment dir'));
      return;
    }

    try {
      const selection = await open({
        directory: true,
        multiple: false,
        defaultPath: experimentDir || undefined,
      });
      if (typeof selection === 'string' && selection.length > 0) {
        setExperimentDir(normalizePathForWindowsShellSelection(selection, windowsShellProfile));
      }
    } catch {
      // User cancelled the dialog or the platform doesn't support it;
      // fall back to manual text input.
    }
  }, [experimentDir, getLifecycleLockMessage, setupLocked, windowsShellProfile]);

  const handleShowSetup = useCallback(async () => {
    if (lifecycleLock.locked) {
      setSetupError(getLifecycleLockMessage('open the setup form'));
      return;
    }

    setSetupError(null);
    setShowSetup(true);
  }, [getLifecycleLockMessage, lifecycleLock.locked]);

  const handleResetToDefaults = useCallback(() => {
    if (setupLocked) {
      setSetupError(getLifecycleLockMessage('change the setup'));
      return;
    }

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
  }, [clearLastUsedConfig, getLifecycleLockMessage, setupLocked]);

  const handleTestConnection = useCallback(async () => {
    if (setupLocked) {
      setSetupError(getLifecycleLockMessage('test a different execution target'));
      return;
    }

    const cfg = setupForm;
    try {
      await assertSupportedPlatform(cfg);
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
      return;
    }

    setConnectionTest({ status: 'testing', output: t('autoresearch.connectionTesting') });

    try {
      const probeCommand = buildAutoResearchConnectionProbeCommand({
        workDir: cfg.remoteWorkDir,
        experimentDir,
      });
      const result = await invoke<RawBashResult>('execute_bash', {
        args: {
          command: buildRemoteBashCommand({ ...cfg, remoteWorkDir: '' }, probeCommand),
          timeoutSecs: 30,
          windowsShellProfile,
        },
      });
      const verdict = interpretAutoResearchConnectionProbe({
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exit_code ?? 0,
        mode: cfg.mode,
      });
      if (!verdict.ok) {
        throw new Error(verdict.error || 'connection test failed');
      }

      setConnectionTest({
        status: 'success',
        output: verdict.output,
      });
    } catch (error) {
      const message = formatError(error);
      setConnectionTest({ status: 'error', output: message });
    }
  }, [experimentDir, getLifecycleLockMessage, setupForm, setupLocked, windowsShellProfile]);

  const handleStart = useCallback(async () => {
    if (lifecycleLock.locked) {
      setSetupError(getLifecycleLockMessage('start a new run'));
      return;
    }

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
      if (shouldAutoOpenAutoResearchTerminal({
        selection: windowsShellProfile,
        mode: started.resolvedConfig.mode,
        workDir: started.resolvedConfig.remoteWorkDir,
      })) {
        openTerminalPanel(
          `autoresearch-terminal-${Date.now()}`,
          started.resolvedConfig.mode === 'local' ? started.resolvedConfig.remoteWorkDir : '',
        );
      }
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
      getLifecycleLockMessage,
    initSession,
      lifecycleLock.locked,
    maxIter,
    metric,
    openTerminalPanel,
    setLastUsedConfig,
    setSshConfig,
    setupForm,
    windowsShellProfile,
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

  // ---- Setup form ----
  if (showSetup) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex max-h-[calc(100vh-6rem)] w-full max-w-2xl flex-col rounded-[28px] border border-gray-200/70 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(28,25,23,0.25)]">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">AutoResearch</p>
            <h2 className="text-xl font-semibold text-gray-900">{t('autoresearch.setupTitle')}</h2>
            <p className="text-sm text-gray-500">
              {t('autoresearch.setupDescription')}
            </p>
          </div>

          {activeRun && (
            <AutoResearchActiveRunBanner
              run={activeRun}
              onView={handleViewActiveRun}
              onBrowseHistory={() => setShowRunList(true)}
            />
          )}

          <form className="mt-4 flex min-h-0 flex-1 flex-col" onSubmit={handleSetupSubmit}>
            <fieldset className="flex min-h-0 flex-1 flex-col gap-3" disabled={setupLocked || isStarting}>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {setupLocked && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{getLifecycleLockMessage('change the setup')}</span>
                    {activeRunId && (
                      <button
                        type="button"
                        className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                        onClick={handleViewActiveRun}
                      >
                        {t('autoresearch.viewActiveRun')}
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50/70 px-3 py-2 text-xs text-neutral-700">
                <span>
                  {prefillSource === 'last-used'
                    ? t('autoresearch.prefillLastUsed')
                    : t('autoresearch.prefillDefaults')}
                </span>
                <button
                  type="button"
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-neutral-700 transition-colors hover:bg-white/70 hover:text-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-400"
                  onClick={handleResetToDefaults}
                >
                  {t('autoresearch.resetToDefaults')}
                </button>
              </div>
              {/* Mode toggle */}
              <div className="flex gap-1 rounded-2xl bg-gray-100/80 p-1">
                <button
                  type="button"
                  onClick={() => setSetupForm(f => ({ ...f, mode: 'ssh' }))}
                  className={`flex-1 rounded-xl py-1.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${setupForm.mode === 'ssh' ? 'bg-white text-neutral-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >{t('autoresearch.modeRemote')}</button>
                <button
                  type="button"
                  onClick={() => setSetupForm(f => ({ ...f, mode: 'local' }))}
                  className={`flex-1 rounded-xl py-1.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${setupForm.mode === 'local' ? 'bg-white text-neutral-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >{t('autoresearch.modeLocal')}</button>
              </div>

              {setupForm.mode === 'ssh' && (
                <>
                  <input
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    placeholder={t('autoresearch.hostPlaceholder')}
                    value={setupForm.host}
                    onChange={e => setSetupForm(f => ({ ...f, host: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.userPlaceholder')}
                      value={setupForm.user}
                      onChange={e => setSetupForm(f => ({ ...f, user: e.target.value }))}
                    />
                    <input
                      className="w-20 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.portPlaceholder')}
                      type="number"
                      value={setupForm.port}
                      onChange={e => setSetupForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                    />
                  </div>
                  <select
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    value={setupForm.authMode}
                    onChange={e => setSetupForm(f => ({ ...f, authMode: e.target.value as SshConfig['authMode'] }))}
                  >
                    <option value="agent">{t('autoresearch.authAgent')}</option>
                    <option value="password">{t('autoresearch.authPassword')}</option>
                    <option value="key">{t('autoresearch.authKey')}</option>
                  </select>
                  {setupForm.authMode === 'password' && (
                    <input
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.passwordPlaceholder')}
                      type="password"
                      autoComplete="off"
                      value={setupForm.password}
                      onChange={e => setSetupForm(f => ({ ...f, password: e.target.value }))}
                    />
                  )}
                  {setupForm.authMode === 'key' && (
                    <input
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.sshKeyPathPlaceholder')}
                      value={setupForm.keyPath}
                      onChange={e => setSetupForm(f => ({ ...f, keyPath: e.target.value }))}
                    />
                  )}
                </>
              )}
              {setupForm.mode === 'local' ? (
                <>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.localWorkDirPlaceholder')}
                      value={setupForm.remoteWorkDir}
                      onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: sanitizePathInput(e.target.value) }))}
                    />
                    <button
                      type="button"
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                      onClick={handlePickLocalWorkDir}
                    >
                      {t('autoresearch.chooseDirectory')}
                    </button>
                  </div>
                  <AutoResearchPathSummary label={t('autoresearch.summaryWorkdir')} path={setupForm.remoteWorkDir} />
                  <AutoResearchInlineHint>{t('autoresearch.workdirHelper')}</AutoResearchInlineHint>
                </>
              ) : (
                <>
                  <input
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    placeholder={t('autoresearch.remoteWorkDirPlaceholder')}
                    value={setupForm.remoteWorkDir}
                    onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: sanitizePathInput(e.target.value) }))}
                  />
                  <AutoResearchPathSummary label={t('autoresearch.summaryWorkdir')} path={setupForm.remoteWorkDir} />
                  <AutoResearchInlineHint>{t('autoresearch.workdirHelper')}</AutoResearchInlineHint>
                </>
              )}

              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  placeholder={t('autoresearch.experimentDirPlaceholder')}
                  value={experimentDir}
                  onChange={e => setExperimentDir(sanitizePathInput(e.target.value))}
                />
                <button
                  type="button"
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                  onClick={handlePickExperimentDir}
                  aria-label={t('autoresearch.chooseDirectory')}
                >
                  {t('autoresearch.chooseDirectory')}
                </button>
              </div>
              <AutoResearchPathSummary label={t('autoresearch.summaryExperimentDir')} path={experimentDir} />
              <AutoResearchInlineHint>{t('autoresearch.experimentDirHelper')}</AutoResearchInlineHint>

              <hr className="border-gray-200" />

              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  placeholder={t('autoresearch.metricNamePlaceholder')}
                  value={metric}
                  onChange={e => setMetric(e.target.value)}
                />
                <select
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  value={direction}
                  onChange={e => setDirection(e.target.value as 'lower' | 'higher')}
                >
                  <option value="lower">{t('autoresearch.lowerIsBetter')}</option>
                  <option value="higher">{t('autoresearch.higherIsBetter')}</option>
                </select>
              </div>
              <AutoResearchInlineHint>{t('autoresearch.metricHelper')}</AutoResearchInlineHint>
              <input
                className={`w-full rounded-xl border bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${baselineInvalid ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-neutral-400'}`}
                placeholder={t('autoresearch.baselinePlaceholder')}
                value={baselineInput}
                onChange={e => setBaselineInput(e.target.value)}
              />
              {baselineInvalid && (
                <div className="text-xs text-rose-500">{t('autoresearch.validationBaselineNumber')}</div>
              )}
              <AutoResearchInlineHint>{t('autoresearch.baselineHelper')}</AutoResearchInlineHint>
              <input
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                placeholder={t('autoresearch.maxIterationsPlaceholder')}
                type="number"
                value={maxIter}
                onChange={e => setMaxIter(buildAutoResearchDefaultConfig({ iterations: parseInt(e.target.value, 10) || 50 }).iterations)}
              />
              <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
                <AutoResearchReadinessRow label={t('autoresearch.check.provider')} ready={providerReady} />
                <AutoResearchReadinessRow label={t('autoresearch.check.workdir')} ready={workdirReady} />
                <AutoResearchReadinessRow label={t('autoresearch.check.experimentDir')} ready={experimentDirReady} />
                <AutoResearchReadinessRow label={t('autoresearch.check.metric')} ready={metricReady} />
                <AutoResearchReadinessRow label={t('autoresearch.check.connectionTest')} ready={connectionTestReady} />
                {setupForm.mode === 'ssh' && (
                  <AutoResearchReadinessRow label={t('autoresearch.check.sshConnection')} ready={sshReady} />
                )}
                <AutoResearchInlineHint>{t('autoresearch.readiness.helper')}</AutoResearchInlineHint>
              </div>
              <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
                <h5 className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">{t('autoresearch.summaryTitle')}</h5>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  <AutoResearchSummaryItem
                    label={t('autoresearch.summaryTarget')}
                    value={AutoResearchTargetSummary({
                      mode: setupForm.mode,
                      user: setupForm.user,
                      host: setupForm.host,
                    })}
                  />
                  <AutoResearchSummaryItem label={t('autoresearch.summaryWorkdir')} value={setupForm.remoteWorkDir || '—'} />
                  <AutoResearchSummaryItem label={t('autoresearch.summaryExperimentDir')} value={experimentDir || '—'} />
                  <AutoResearchSummaryItem
                    label={t('autoresearch.summaryMetric')}
                    value={AutoResearchMetricSummary({ metric, direction })}
                  />
                  <AutoResearchSummaryItem label={t('autoresearch.summaryIterations')} value={String(maxIter)} />
                </div>
              </div>
            {setupError && setupError !== agentConfigError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{setupError}</span>
                    {activeRunId && (
                      <button
                        type="button"
                        className="rounded-full border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-50"
                        onClick={handleViewActiveRun}
                      >
                        {t('autoresearch.viewActiveRun')}
                      </button>
                    )}
                </div>
              </div>
            )}
              </div>
              <div className="mt-2 shrink-0 border-t border-gray-100 pt-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="w-full rounded-2xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 sm:w-48"
                  disabled={testConnectionDisabled || isStarting}
                  onClick={handleTestConnection}
                >
                  {connectionTest.status === 'testing'
                    ? t('autoresearch.connectionTesting')
                    : t('autoresearch.testConnection')}
                </button>
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-neutral-900 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800 disabled:opacity-50"
                  disabled={isStarting || setupLocked}
                  aria-busy={isStarting}
                >
                  {isStarting ? t('autoresearch.starting') : t('autoresearch.start')}
                </button>
              </div>
              <div className="mt-2">
                <AutoResearchConnectionStatusPanel
                  status={connectionTest.status}
                  output={connectionTest.output}
                />
              </div>
              {agentConfigError && (
                <div className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {agentConfigError}
                </div>
              )}
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    );
  }

  if (!displayRun && sortedRuns.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-2xl bg-neutral-100 p-4 text-neutral-500">
          <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-800">AutoResearch</h2>
        <p className="mt-2 max-w-md text-sm text-gray-500">{t('autoresearch.emptyIdle')}</p>
        <button
          onClick={() => { void handleShowSetup(); }}
          className="mt-5 rounded-2xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800"
        >
          {t('autoresearch.setupAndStart')}
        </button>
      </div>
    );
  }

  if (showRunList) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {isSelectMode ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-all">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-neutral-900 animate-pulse" />
                <span className="text-sm font-medium text-gray-700">
                  {t('autoresearch.selectedCount', { count: batchSelectedIds.length })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBatchDelete}
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-100"
                >
                  {t('autoresearch.batchDelete')}
                </button>
                <button
                  type="button"
                  onClick={handleExitSelection}
                  className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                >
                  {t('autoresearch.exitSelect')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-600" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">AutoResearch Lab</span>
                </div>
                <h2 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900">{t('autoresearch.runHistoryTitle')}</h2>
              </div>
              <div className="flex items-center gap-2">
                {activeRun && (
                  <button
                    type="button"
                    onClick={handleViewActiveRun}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300"
                  >
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    {t('autoresearch.viewActiveRun')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { void handleShowSetup(); }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.98]"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  {t('autoresearch.newRun')}
                </button>
              </div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedRuns.map((run) => (
              <AutoResearchRunHistoryCard
                key={run.id}
                run={run}
                isSelected={displayRun?.id === run.id}
                isActive={activeRunId === run.id}
                isSelectMode={isSelectMode}
                isChecked={batchSelectedIds.includes(run.id)}
                onToggleSelect={() => handleToggleSelectRun(run.id)}
                onDelete={() => handleSingleDelete(run.id)}
                onClick={() => {
                  selectRun(run.id);
                  setSelectedExperiment(-1);
                  setShowSetup(false);
                  setShowRunList(false);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 flex-col bg-gray-50">
      {!showSetup && setupError && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {setupError}
        </div>
      )}
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
            className="min-h-[calc(100vh-2rem)] rounded-[28px] border border-gray-200"
          />
        </div>
      )}
      {terminalSessionId && (
        <div className="mx-4 mb-4 rounded-xl border bg-white overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b text-xs">
            <span className="font-medium text-gray-700">{t('autoresearch.terminalTitle')}</span>
            <button
              type="button"
              className="text-neutral-700 hover:text-neutral-900"
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
  const selectedRun = useAutoResearchStore(getSelectedAutoResearchRun);
  const selectedExperiment = useAutoResearchStore((state) => state.selectedExperiment);
  const hasSelectedIteration = Boolean(
    selectedRun
    && selectedExperiment >= 0
    && selectedExperiment < selectedRun.iterations.length,
  );

  return (
    <MainLayout
      showRightPanel={hasSelectedIteration}
      rightPanelContent={hasSelectedIteration ? <ExperimentDetailPanel /> : null}
      rightPanelWidthClassName="w-[360px]"
    >
      <AutoResearchTabs />
    </MainLayout>
  );
}

export default AutoResearch;
