import { useState, useCallback, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import { useUIStore } from '@/store/uiStore';
import { TerminalPanel } from '@/components';
import {
  AutoResearchRunHistoryCard,
} from '@/components/autoresearch/AutoResearchSetupHelpers';
import {
  AutoResearchRunDetailDocument,
} from '@/components/autoresearch/AutoResearchRunDetailDocument';
import {
  getManualSetupReadiness,
  type ManualSetupDraft,
} from './manual/manualReadiness';
import { ManualLaunchCockpit } from './manual/ManualLaunchCockpit';
import { useSettingsStore } from '@/store';
import {
  useAutoResearchStore,
  type SshConfig,
  getSelectedAutoResearchRunContext,
  getSortedAutoResearchRuns,
} from '@/store/autoresearchStore';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import {
  stopExperimentLoop,
  pauseExperimentLoop,
  resumeExperimentLoop,
} from '@/services/autoresearch';
import { assertSupportedPlatform } from '@/services/autoresearch/platformGuard';
import { formatError } from '@/services/autoresearch/errors';
import {
  getAutoResearchDefaultConfig,
  resolveAutoResearchDefaultConfig,
  type AutoResearchDefaultSource,
} from '@/services/autoresearch/defaultConfig';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import { openFileExternal } from '@/services/docService';
import {
  buildAutoResearchConnectionProbeInvokeArgs,
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
import {
  AUTORESEARCH_CONFIG_STORAGE_KEY,
  extractSshError,
  loadPersistedSetup,
} from './advancedWorkdirSetupHelpers';
import type { RawBashResult, ConnectionTestState } from './advancedWorkdirSetupHelpers';
export {
  formatRuntimeSummary,
  formatWorkspaceSummary,
  formatMetricSummary,
  getPathBasename,
  parseConnectionSuccessOutput,
} from './advancedWorkdirSetupHelpers';

export function AdvancedWorkdirSetup() {
  const {
    id: activeRunId,
    sshConfig,
    setSelectedExperiment, initSession, setSshConfig, runHistory, selectRun,
    deleteRun, deleteRuns,
    terminalVisible, terminalSessionId, terminalCwd,
    openTerminalPanel, setTerminalReady, setTerminalVisible,
  } = useAutoResearchStore();
  const lastUsedConfig = useAutoResearchStore((state) => state.lastUsedConfig);
  const storeLoopState = useAutoResearchStore((state) => state.loopState);
  const setLastUsedConfig = useAutoResearchStore((state) => state.setLastUsedConfig);
  const clearLastUsedConfig = useAutoResearchStore((state) => state.clearLastUsedConfig);
  const selectedRunContext = useAutoResearchStore(getSelectedAutoResearchRunContext);
  const selectedRun = selectedRunContext.run;
  const sortedRuns = useAutoResearchStore(getSortedAutoResearchRuns);
  const activeConfigId = useSettingsStore((state) => state.activeConfigId);
  const apiConfigs = useSettingsStore((state) => state.apiConfigs);
  const windowsShellProfile = useSettingsStore((state) => state.windowsShellProfile);

  const [showSetup, setShowSetup] = useState(
    () => !activeRunId && !selectedRun && !sshConfig && runHistory.length === 0 && storeLoopState !== 'running' && storeLoopState !== 'paused'
  );
  const prevRunHistoryLengthRef = useRef(runHistory.length);

  useEffect(() => {
    if (activeRunId || storeLoopState === 'running' || storeLoopState === 'paused') {
      setShowSetup(false);
      setShowRunList(false);
    }
  }, [activeRunId, storeLoopState]);

  useEffect(() => {
    if (prevRunHistoryLengthRef.current === 0 && runHistory.length > 0) {
      setShowSetup(false);
      setShowRunList(false);
    }
    prevRunHistoryLengthRef.current = runHistory.length;
  }, [runHistory.length]);
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
  const providerReady = !agentConfigError;

  const readiness = useMemo(() => {
    const draft: ManualSetupDraft = {
      setupForm,
      experimentDir,
      metric,
      baselineInvalid,
      connectionTestStatus: connectionTest.status,
      providerReady,
    };
    return getManualSetupReadiness(draft);
  }, [setupForm, experimentDir, metric, baselineInvalid, connectionTest.status, providerReady]);

  const getManualSetupSectionStatus = (section: string) => {
    if (section === 'workspace' || section === 'targetProject' || section === 'runtime' || section === 'metric' || section === 'envCheck' || section === 'provider') {
      return readiness.rawSectionStatus[section as keyof typeof readiness.rawSectionStatus];
    }
    return 'completed';
  };

  const workdirReady = Boolean(setupForm.remoteWorkDir.trim());
  const experimentDirReady = Boolean(experimentDir.trim());
  const metricReady = Boolean(metric.trim());
  const sshReady = setupForm.mode === 'local'
    ? true
    : Boolean(setupForm.host.trim() && setupForm.user.trim());
  const connectionTestReady = connectionTest.status === 'success';
  const testConnectionDisabled = setupForm.mode === 'ssh'
    ? (!setupForm.host || !setupForm.user
        || (setupForm.authMode === 'password' && !setupForm.password)
        || (setupForm.authMode === 'key' && !setupForm.keyPath)
        || !setupForm.remoteWorkDir
        || !experimentDir
        || Boolean(agentConfigError)
        || baselineInvalid)
    : !setupForm.remoteWorkDir || !experimentDir || Boolean(agentConfigError) || baselineInvalid;

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
      setShowSetup(false);
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
      setSetupForm((current) => ({
        ...current,
        remoteWorkDir: normalizePathForWindowsShellSelection(selection, windowsShellProfile),
      }));
    }
  }, [setupForm.remoteWorkDir, windowsShellProfile]);

  const handlePickExperimentDir = useCallback(async () => {
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
  }, [experimentDir, windowsShellProfile]);

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
        args: buildAutoResearchConnectionProbeInvokeArgs({
          mode: cfg.mode,
          sshConfig: cfg,
          workDir: cfg.remoteWorkDir,
          experimentDir,
          // SSH ConnectTimeout is 10s (set in buildSshArgs), so 15s gives
          // enough headroom for the connection to fail naturally while still
          // surfacing the real SSH error instead of a generic timeout.
          timeoutSecs: 15,
          windowsShellProfile,
        }),
      });
      const verdict = interpretAutoResearchConnectionProbe({
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exit_code ?? 0,
        mode: cfg.mode,
      });
      if (!verdict.ok) {
        throw new Error(
          verdict.error
          || extractSshError(result.stderr || '', result.stdout || '', result.exit_code ?? 1),
        );
      }

      setConnectionTest({
        status: 'success',
        output: verdict.output,
      });
    } catch (error) {
      const message = formatError(error);
      setConnectionTest({ status: 'error', output: message });
    }
  }, [experimentDir, setupForm, windowsShellProfile]);

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
    initSession,
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
  const handleResume = useCallback(() => resumeExperimentLoop(displayRun?.id), [displayRun?.id]);
  const handleStop = useCallback(() => stopExperimentLoop(displayRun?.id), [displayRun?.id]);
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

  const isPersistedPausedRun = !selectedRunContext.isActive
    && Boolean(displayRun?.resumeToken?.resumable)
    && (displayRun?.status === 'paused' || displayRun?.resumeToken?.status === 'paused');

  const runControls = (selectedRunContext.isActive || isPersistedPausedRun) ? (
    <div className="flex flex-wrap items-center gap-2">
      {selectedRunContext.isActive && loopState === 'running' && (
        <>
          <button onClick={handlePause} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700 hover:bg-amber-100">
            {t('autoresearch.pause')}
          </button>
          <button onClick={handleStop} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
            {t('autoresearch.stop')}
          </button>
        </>
      )}
      {(loopState === 'paused' || isPersistedPausedRun) && (
        <>
          <button onClick={handleResume} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-[12px] font-medium text-green-700 hover:bg-green-100">
            {t('autoresearch.resume')}
          </button>
          <button onClick={handleStop} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
            {t('autoresearch.stop')}
          </button>
        </>
      )}
      {selectedRunContext.isActive && loopState === 'error' && selectedRun?.status === 'reflection_failed' && (
        <>
          <button
            onClick={() => useAutoResearchStore.getState().acknowledgeReflectionFailure()}
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] font-medium text-indigo-700 hover:bg-indigo-100"
          >
            {t('autoresearch.acknowledge')}
          </button>
          <button onClick={handleStop} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
            {t('autoresearch.stop')}
          </button>
        </>
      )}
    </div>
  ) : null;

  // When an active or selected run exists or loopState is running/paused,
  // we must show the running dashboard, not leftover setup.
  const hasActiveDashboard = Boolean(displayRun && (selectedRunContext.isActive || storeLoopState === 'running' || storeLoopState === 'paused'));

  if (showSetup && !hasActiveDashboard) {
    return (
      <ManualLaunchCockpit
        setupForm={setupForm}
        setSetupForm={setSetupForm}
        maxIter={maxIter}
        setMaxIter={setMaxIter}
        metric={metric}
        setMetric={setMetric}
        direction={direction}
        setDirection={setDirection}
        experimentDir={experimentDir}
        setExperimentDir={setExperimentDir}
        baselineInput={baselineInput}
        setBaselineInput={setBaselineInput}
        baselineInvalid={baselineInvalid}
        prefillSource={prefillSource}
        windowsShellProfile={windowsShellProfile}
        connectionTest={connectionTest}
        setupError={setupError}
        isStarting={isStarting}
        activeRun={activeRun}
        loopState={activeRunId ? storeLoopState : null}
        activeRunStatus={activeRun?.status ?? null}
        providerReady={providerReady}
        agentConfigError={agentConfigError}
        readiness={readiness}
        handleResetToDefaults={handleResetToDefaults}
        handlePickLocalWorkDir={handlePickLocalWorkDir}
        handlePickExperimentDir={handlePickExperimentDir}
        handleTestConnection={handleTestConnection}
        handleSetupSubmit={handleSetupSubmit}
        handleStart={handleStart}
        handleViewActiveRun={handleViewActiveRun}
        setShowRunList={setShowRunList}
        onToggleSettings={() => useUIStore.getState().toggleSettings()}
      />
    );
  }

  if (!displayRun && sortedRuns.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
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
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
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
        <div className="mx-4 mb-4 overflow-hidden rounded-xl border bg-white">
          <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-2 text-xs">
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

export default AdvancedWorkdirSetup;
