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

/**
 * Extract a human-readable SSH error from the raw stderr/stdout of a
 * connection test. The raw output often contains WSL path warnings,
 * generic "Command timed out" suffixes, and sshpass boilerplate that
 * obscure the real failure reason.
 *
 * Priority order:
 *   1. Known SSH error patterns (Connection refused, Permission denied, etc.)
 *   2. Non-noise stderr lines
 *   3. stdout fallback
 *   4. Generic exit-code message
 */
function extractSshError(stderr: string, stdout: string, exitCode: number): string {
  // Lines to ignore - they are informational, not errors.
  const NOISE_PATTERNS = [
    /^WSL will use a converted/i,
    /^Avoid mixing WSL/i,
    /^Command timed out after \d+ seconds$/i,
    /^\s*$/,
  ];

  const isNoise = (line: string): boolean =>
    NOISE_PATTERNS.some((pattern) => pattern.test(line.trim()));

  // Split stderr into lines, filter noise, and look for SSH-specific errors.
  const stderrLines = stderr.split('\n').filter((line) => !isNoise(line));

  // Known SSH/sshpass error patterns - prefer these over raw output.
  const SSH_ERROR_PATTERNS = [
    /connection timed out/i,
    /connection refused/i,
    /no route to host/i,
    /permission denied/i,
    /host key verification failed/i,
    /could not resolve hostname/i,
    /network is unreachable/i,
    /banner exchange/i,
    /ssh_exchange_identification/i,
    /kex_exchange_identification/i,
    /port \d+ timed out/i,
    /sshpass.*error/i,
    /invalid password/i,
  ];

  for (const line of stderrLines) {
    const trimmed = line.trim();
    if (SSH_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      return trimmed;
    }
  }

  // No recognized SSH pattern - return the first meaningful stderr line.
  if (stderrLines.length > 0) {
    return stderrLines.join('\n');
  }

  // Fall back to stdout or generic message.
  if (stdout) {
    return stdout;
  }

  return `Connection test failed (exit ${exitCode})`;
}

// AUDIT-FIX [audit-1-ar#7]: Strict schema validation + explicit password strip.
// Two security/correctness concerns addressed here:
//   1. Field-by-field type validation. The previous implementation did
//      `return { ...fallback, ...parsed }` and trusted `parsed` to have
//      the right types. A future build that renames `remoteWorkDir` to
//      `workDir`, or writes `port` as a string, would silently break
//      the SSH flow downstream with a confusing error.
//   2. `password` is intentionally NEVER loaded. The persist effect
//      below strips it on write, but a stolen localStorage dump from
//      a previous build (before the strip was added) or an external
//      injection would otherwise replay credentials. We re-assert
//      `password: ''` here as a defense-in-depth measure.
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

  // Strict field whitelist: if a field is missing or has the wrong type we
  // fall back to the default value rather than letting garbage into the
  // form. Note `password` is intentionally NOT loaded from storage - we
  // never persist it (see the persist useEffect) and any stale value from
  // a previous build is explicitly scrubbed here as a defense-in-depth
  // measure.
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
      // SECURITY: password is never persisted. If a previous build wrote it
      // to localStorage (e.g. before the strip was added), explicitly drop
      // it on load so a stolen localStorage dump can't replay credentials.
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
        args: {
          command: buildRemoteBashCommand(cfg, 'uname -s && pwd && git rev-parse --is-inside-work-tree'),
          // SSH ConnectTimeout is 10s (set in buildSshArgs), so 15s gives
          // enough headroom for the connection to fail naturally while still
          // surfacing the real SSH error instead of a generic timeout.
          timeoutSecs: 15,
          windowsShellProfile,
        },
      });
      const stdout = (result.stdout || '').trim();
      const stderr = (result.stderr || '').trim();
      const exitCode = result.exit_code ?? 0;
      if (exitCode !== 0) {
        throw new Error(extractSshError(stderr, stdout, exitCode));
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
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50/70 px-3 py-2 text-xs text-neutral-700">
              <span>
                {prefillSource === 'last-used'
                  ? t('autoresearch.prefillLastUsed')
                  : t('autoresearch.prefillDefaults')}
              </span>
              <button
                type="button"
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-neutral-700 transition-colors hover:bg-white/70 hover:text-neutral-900"
                onClick={handleResetToDefaults}
              >
                {t('autoresearch.resetToDefaults')}
              </button>
            </div>
            <div className="flex gap-1 rounded-2xl bg-gray-100/80 p-1">
              <button
                type="button"
                onClick={() => setSetupForm((current) => ({ ...current, mode: 'ssh' }))}
                className={`flex-1 rounded-xl py-1.5 text-sm font-semibold transition-all ${setupForm.mode === 'ssh' ? 'bg-white text-neutral-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >{t('autoresearch.modeRemote')}</button>
              <button
                type="button"
                onClick={() => setSetupForm((current) => ({ ...current, mode: 'local' }))}
                className={`flex-1 rounded-xl py-1.5 text-sm font-semibold transition-all ${setupForm.mode === 'local' ? 'bg-white text-neutral-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >{t('autoresearch.modeLocal')}</button>
            </div>

            {setupForm.mode === 'ssh' && (
              <>
                <input
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                  placeholder={t('autoresearch.hostPlaceholder')}
                  value={setupForm.host}
                  onChange={(event) => setSetupForm((current) => ({ ...current, host: event.target.value }))}
                />
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                    placeholder={t('autoresearch.userPlaceholder')}
                    value={setupForm.user}
                    onChange={(event) => setSetupForm((current) => ({ ...current, user: event.target.value }))}
                  />
                  <input
                    className="w-20 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                    placeholder={t('autoresearch.portPlaceholder')}
                    type="number"
                    value={setupForm.port}
                    onChange={(event) => setSetupForm((current) => ({ ...current, port: Number.parseInt(event.target.value, 10) || 22 }))}
                  />
                </div>
                <select
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                  value={setupForm.authMode}
                  onChange={(event) => setSetupForm((current) => ({ ...current, authMode: event.target.value as SshConfig['authMode'] }))}
                >
                  <option value="agent">{t('autoresearch.authAgent')}</option>
                  <option value="password">{t('autoresearch.authPassword')}</option>
                  <option value="key">{t('autoresearch.authKey')}</option>
                </select>
                {setupForm.authMode === 'password' && (
                  <input
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                    placeholder={t('autoresearch.passwordPlaceholder')}
                    type="password"
                    autoComplete="off"
                    value={setupForm.password}
                    onChange={(event) => setSetupForm((current) => ({ ...current, password: event.target.value }))}
                  />
                )}
                {setupForm.authMode === 'key' && (
                  <input
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                    placeholder={t('autoresearch.sshKeyPathPlaceholder')}
                    value={setupForm.keyPath}
                    onChange={(event) => setSetupForm((current) => ({ ...current, keyPath: event.target.value }))}
                  />
                )}
              </>
            )}

            {setupForm.mode === 'local' ? (
              <>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                    placeholder={t('autoresearch.localWorkDirPlaceholder')}
                    value={setupForm.remoteWorkDir}
                    onChange={(event) => setSetupForm((current) => ({ ...current, remoteWorkDir: sanitizePathInput(event.target.value) }))}
                  />
                  <button
                    type="button"
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
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
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                  placeholder={t('autoresearch.remoteWorkDirPlaceholder')}
                  value={setupForm.remoteWorkDir}
                  onChange={(event) => setSetupForm((current) => ({ ...current, remoteWorkDir: sanitizePathInput(event.target.value) }))}
                />
                <AutoResearchPathSummary label={t('autoresearch.summaryWorkdir')} path={setupForm.remoteWorkDir} />
                <AutoResearchInlineHint>{t('autoresearch.workdirHelper')}</AutoResearchInlineHint>
              </>
            )}

            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                placeholder={t('autoresearch.experimentDirPlaceholder')}
                value={experimentDir}
                onChange={(event) => setExperimentDir(sanitizePathInput(event.target.value))}
              />
              <button
                type="button"
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
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
                className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                placeholder={t('autoresearch.metricNamePlaceholder')}
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
              />
              <select
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                value={direction}
                onChange={(event) => setDirection(event.target.value as 'lower' | 'higher')}
                >
                  <option value="lower">{t('autoresearch.lowerIsBetter')}</option>
                  <option value="higher">{t('autoresearch.higherIsBetter')}</option>
                </select>
              </div>
              <AutoResearchInlineHint>{t('autoresearch.metricHelper')}</AutoResearchInlineHint>
            <input
              className={`w-full rounded-xl border bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none ${baselineInvalid ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-neutral-400'}`}
              placeholder={t('autoresearch.baselinePlaceholder')}
              value={baselineInput}
              onChange={(event) => setBaselineInput(event.target.value)}
            />
            {baselineInvalid && (
              <div className="text-xs text-rose-500">{t('autoresearch.validationBaselineNumber')}</div>
            )}
            <AutoResearchInlineHint>{t('autoresearch.baselineHelper')}</AutoResearchInlineHint>
            <input
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
              placeholder={t('autoresearch.maxIterationsPlaceholder')}
              type="number"
              value={maxIter}
              onChange={(event) => setMaxIter(buildAutoResearchDefaultConfig({ iterations: Number.parseInt(event.target.value, 10) || 50 }).iterations)}
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
            <div className="mt-3 shrink-0 border-t border-gray-100 pt-3">
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
                disabled={isStarting}
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
          </form>
        </div>
      </div>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">AutoResearch</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{t('autoresearch.runHistoryTitle')}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {t('autoresearch.runHistoryHelper')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeRun && (
                  <button
                    type="button"
                    onClick={handleViewActiveRun}
                    className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                  >
                    {t('autoresearch.viewActiveRun')}
                  </button>
                )}
                <button
                  onClick={() => { void handleShowSetup(); }}
                  className="rounded-2xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800"
                >
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
