/**
 * Owns AutoResearchView's existing state, effects and event handlers.
 * Called once by AutoResearchView so React keeps the same owner and hook order.
 */
import { useState, useCallback, useEffect, useMemo, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import {
  useAutoResearchStore,
  type SshConfig,
  getSelectedAutoResearchRunContext,
  getSortedAutoResearchRuns,
} from '@/store/autoresearchStore';
import { useSettingsStore } from '@/store';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import { stopExperimentLoop, pauseExperimentLoop, resumeExperimentLoop, suspendExperimentLoopOnUnmount } from '@/services/autoresearch';
import { assertSupportedPlatform } from '@/services/autoresearch/platformGuard';
import { formatError } from '@/services/autoresearch/errors';
import {
  getAutoResearchDefaultConfig,
  resolveAutoResearchDefaultConfig,
  type AutoResearchDefaultSource,
} from '@/services/autoresearch/defaultConfig';
import {
  buildAutoResearchRunLockMessage,
  useAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
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
  loadPersistedSetup,
  type ConnectionTestState,
  type RawBashResult,
} from './autoResearchSetupPersistence';

export function useAutoResearchViewController() {
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
      suspendExperimentLoopOnUnmount();
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
      const result = await invoke<RawBashResult>('execute_bash', {
        args: buildAutoResearchConnectionProbeInvokeArgs({
          mode: cfg.mode,
          sshConfig: cfg,
          workDir: cfg.remoteWorkDir,
          experimentDir,
          timeoutSecs: 30,
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

  return {
    activeRunId, setSelectedExperiment, setShowSetup, selectedRunContext, displayRun, sortedRuns, showSetup,
    activeRun, handleViewActiveRun, getLifecycleLockMessage, setupForm, setSetupForm, setupLocked, isStarting,
    prefillSource, handleResetToDefaults, handlePickLocalWorkDir, experimentDir, setExperimentDir, handlePickExperimentDir, metric,
    setMetric, direction, setDirection, baselineInput, setBaselineInput, baselineInvalid, maxIter,
    setMaxIter, providerReady, workdirReady, experimentDirReady, metricReady, connectionTestReady, sshReady,
    setupError, agentConfigError, handleSetupSubmit, handleTestConnection, testConnectionDisabled, connectionTest, handleShowSetup,
    setShowRunList, isSelectMode, batchSelectedIds, handleBatchDelete, handleExitSelection, handleToggleSelectRun, handleSingleDelete,
    selectRun, showRunList, statusMessage, loopState, displayReason, displayedLiveOutput, handleOpenRunArtifact,
    handlePause, handleResume, handleStop, terminalSessionId, terminalCwd, terminalVisible, setTerminalVisible,
    handleTerminalClose, handleTerminalReady, handleTerminalExit,
  };
}
