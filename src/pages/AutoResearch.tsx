/**
 * AutoResearch Page — Experiment monitoring & control dashboard.
 *
 * Layout: MainLayout with experiment timeline in center and detail panel on right.
 */

import { useState, useCallback, useEffect, useMemo, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import { TerminalPanel } from '@/components';
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
  resolveVerificationPresetId,
  resolveVerificationCommands,
  VERIFICATION_PRESETS,
  DEFAULT_VERIFICATION_PRESET,
  type AutoResearchDefaultSource,
  type VerificationPresetId,
} from '@/services/autoresearch/defaultConfig';
import { sanitizePathInput } from '@/services/autoresearch/pathInput';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import {
  buildAutoResearchRunLockMessage,
  getAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
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
        {/* Self-improve mode report card */}
        {entry.parsedMetrics?.selfImproveMode && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Self-Improve Report</h4>

            {/* Issue Found */}
            {entry.hypothesis && entry.hypothesis !== '—' && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Issue Found</p>
                <p className="text-xs text-gray-700 mt-0.5">{entry.hypothesis}</p>
              </div>
            )}

            {/* Evidence */}
            {entry.reasoning && entry.reasoning !== '—' && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Evidence</p>
                <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{entry.reasoning}</p>
              </div>
            )}

            {/* Files Changed */}
            {entry.change && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Files Changed</p>
                <p className="text-xs text-gray-600 font-mono break-all mt-0.5">{entry.change}</p>
              </div>
            )}

            {/* Verification Results */}
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Verification Results</p>
              <div className="flex flex-wrap gap-1.5">
                {entry.parsedMetrics.buildPassed !== undefined && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${entry.parsedMetrics.buildPassed === true ? 'bg-green-100 text-green-700' : entry.parsedMetrics.buildPassed === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                    Build: {entry.parsedMetrics.buildPassed === true ? 'PASS' : entry.parsedMetrics.buildPassed === false ? 'FAIL' : String(entry.parsedMetrics.buildPassed)}
                  </span>
                )}
                {entry.parsedMetrics.testsPassed !== undefined && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${entry.parsedMetrics.testsPassed === true ? 'bg-green-100 text-green-700' : entry.parsedMetrics.testsPassed === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                    Tests: {entry.parsedMetrics.testsPassed === true ? 'PASS' : entry.parsedMetrics.testsPassed === false ? 'FAIL' : String(entry.parsedMetrics.testsPassed)}
                  </span>
                )}
                {entry.parsedMetrics.typecheckPassed !== undefined && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${entry.parsedMetrics.typecheckPassed === true ? 'bg-green-100 text-green-700' : entry.parsedMetrics.typecheckPassed === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                    Typecheck: {entry.parsedMetrics.typecheckPassed === true ? 'PASS' : entry.parsedMetrics.typecheckPassed === false ? 'FAIL' : String(entry.parsedMetrics.typecheckPassed)}
                  </span>
                )}
                {entry.parsedMetrics.lintPassed !== undefined && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${entry.parsedMetrics.lintPassed === true ? 'bg-green-100 text-green-700' : entry.parsedMetrics.lintPassed === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                    Lint: {entry.parsedMetrics.lintPassed === true ? 'PASS' : entry.parsedMetrics.lintPassed === false ? 'FAIL' : String(entry.parsedMetrics.lintPassed)}
                  </span>
                )}
              </div>
            </div>

            {/* Risk */}
            {entry.parsedMetrics.riskLevel && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Risk</p>
                <p className="text-xs mt-0.5">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold ${
                    entry.parsedMetrics.riskLevel === 'low' ? 'bg-blue-100 text-blue-700'
                      : entry.parsedMetrics.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {String(entry.parsedMetrics.riskLevel).toUpperCase()}
                  </span>
                  {entry.parsedMetrics.score !== undefined && (
                    <span className="ml-2 text-gray-500">Score: <span className="font-semibold text-gray-700">{String(entry.parsedMetrics.score)}</span></span>
                  )}
                </p>
              </div>
            )}

            {/* Next Recommendation */}
            {entry.parsedMetrics.nextRecommendation && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Next Recommendation</p>
                <p className="text-xs text-gray-700 mt-0.5">{String(entry.parsedMetrics.nextRecommendation)}</p>
              </div>
            )}

            {/* Needs Review Reason (shown when failed) */}
            {(entry.status === 'failed' || entry.error) && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2">
                <p className="text-[10px] text-red-600 uppercase tracking-wider font-medium">Needs Review</p>
                <p className="text-xs text-red-700 mt-0.5">
                  {entry.parsedMetrics.needsReviewReason
                    ? String(entry.parsedMetrics.needsReviewReason)
                    : entry.error || 'Verification failed — changes may need manual review.'}
                </p>
              </div>
            )}
          </div>
        )}
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
  const [autoResearchMode, setAutoResearchMode] = useState<'ml_experiment' | 'repo_self_improve'>(
    getAutoResearchDefaultConfig().mode ?? 'ml_experiment',
  );
  const [verificationCommands, setVerificationCommands] = useState<string[]>(
    getAutoResearchDefaultConfig().verificationCommands ?? ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
  );
  const [verificationPreset, setVerificationPreset] = useState<VerificationPresetId>(
    resolveVerificationPresetId(getAutoResearchDefaultConfig().verificationCommands ?? ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit']),
  );
  const agentConfig = useMemo(
    () => resolveActiveAgentConfig(),
    [activeConfigId, apiConfigs],
  );
  const agentConfigIssues = validateResolvedAgentConfig(agentConfig);
  const agentConfigError = agentConfigIssues.length > 0
    ? formatAgentConfigValidationError(agentConfig, agentConfigIssues)
    : '';
  const lifecycleLock = useAutoResearchStore((state) => getAutoResearchLifecycleLock(state));
  const displayRun = selectedRun;
  const displayedLiveOutput = selectedRunContext.liveOutput;
  const displayReason = selectedRunContext.reason;
  const loopState = selectedRunContext.loopState;
  const statusMessage = selectedRunContext.statusMessage;
  const baselineInvalid = baselineInput.trim().length > 0 && parseOptionalBaseline(baselineInput) === null;
  const setupLocked = lifecycleLock.locked;

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
    if (!showSetup) {
      return;
    }
    void assertSupportedPlatform().catch((error) => {
      useAutoResearchStore.getState().setError(formatError(error));
      setShowSetup(false);
    });
  }, [showSetup]);

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
      setSetupForm((current) => ({ ...current, remoteWorkDir: selection }));
    }
  }, [getLifecycleLockMessage, setupForm.remoteWorkDir, setupLocked]);

  const handleShowSetup = useCallback(async () => {
    if (lifecycleLock.locked) {
      setSetupError(getLifecycleLockMessage('open the setup form'));
      return;
    }

    try {
      await assertSupportedPlatform();
      setSetupError(null);
      setShowSetup(true);
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
    }
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
    setAutoResearchMode(defaults.mode ?? 'ml_experiment');
    const defaultCommands = defaults.verificationCommands ?? ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'];
    setVerificationCommands(defaultCommands);
    setVerificationPreset(resolveVerificationPresetId(defaultCommands));
    setPrefillSource('defaults');
    setSetupError(null);
  }, [clearLastUsedConfig, getLifecycleLockMessage, setupLocked]);

  const handleTestConnection = useCallback(async () => {
    if (setupLocked) {
      setSetupError(getLifecycleLockMessage('test a different execution target'));
      return;
    }

    try {
      await assertSupportedPlatform();
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
      return;
    }

    const cfg = setupForm;
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
    }
  }, [getLifecycleLockMessage, setupForm, setupLocked]);

  const handleStart = useCallback(async () => {
    if (lifecycleLock.locked) {
      setSetupError(getLifecycleLockMessage('start a new run'));
      return;
    }

    const isSelfImprove = autoResearchMode === 'repo_self_improve';

    // Filter out empty commands and validate
    const filteredCommands = verificationCommands.map(c => c.trim()).filter(Boolean);
    if (isSelfImprove && filteredCommands.length === 0) {
      setSetupError('At least one verification command is required in self-improve mode.');
      return;
    }
    const validation = validateAutoResearchSetupDraft({
      sshConfig: setupForm,
      experimentDir,
      metric: isSelfImprove ? 'repo_health' : metric,
      direction: isSelfImprove ? 'higher' : direction,
      iterations: maxIter,
      baselineInput,
      agentConfigError,
      requireConnectionTest: true,
      connectionTestStatus: connectionTest.status,
      mode: autoResearchMode,
      verificationCommands: isSelfImprove ? filteredCommands : undefined,
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
    autoResearchMode,
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
    verificationCommands,
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
        <div className="w-full max-w-md space-y-4">
          <h2 className="text-xl font-bold text-gray-800">{t('autoresearch.setupTitle')}</h2>
          <p className="text-sm text-gray-500">
            {autoResearchMode === 'repo_self_improve'
              ? 'Analyze a repository for issues and automatically propose fixes. Run locally or on a remote machine via SSH.'
              : t('autoresearch.setupDescription')}
          </p>

          <form className="space-y-3" onSubmit={handleSetupSubmit}>
            <fieldset className="space-y-3" disabled={setupLocked || isStarting}>
              {setupLocked && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {getLifecycleLockMessage('change the setup')}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <span>
                  {prefillSource === 'last-used'
                    ? t('autoresearch.prefillLastUsed')
                    : t('autoresearch.prefillDefaults')}
                </span>
                <button
                  type="button"
                  className="font-semibold hover:text-blue-800 disabled:cursor-not-allowed disabled:text-blue-400"
                  onClick={handleResetToDefaults}
                >
                  {t('autoresearch.resetToDefaults')}
                </button>
              </div>
              {/* Execution mode toggle */}
              <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSetupForm(f => ({ ...f, mode: 'ssh' }))}
                  className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${setupForm.mode === 'ssh' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                >{t('autoresearch.modeRemote')}</button>
                <button
                  type="button"
                  onClick={() => setSetupForm(f => ({ ...f, mode: 'local' }))}
                  className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${setupForm.mode === 'local' ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                >{t('autoresearch.modeLocal')}</button>
              </div>

              {/* AutoResearch mode toggle */}
              <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setAutoResearchMode('ml_experiment')}
                  className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${autoResearchMode === 'ml_experiment' ? 'bg-white shadow-sm text-purple-700' : 'text-gray-500 hover:text-gray-700'}`}
                >ML Experiment</button>
                <button
                  type="button"
                  onClick={() => setAutoResearchMode('repo_self_improve')}
                  className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${autoResearchMode === 'repo_self_improve' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}
                >Repo Self-Improve</button>
              </div>

              {/* Verification commands for self-improve mode */}
              {autoResearchMode === 'repo_self_improve' && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wider">Verification Commands</label>
                  <div className="grid grid-cols-4 gap-1 p-0.5 bg-gray-100 rounded-lg">
                    {VERIFICATION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setVerificationPreset(preset.id);
                          if (preset.id !== 'custom') {
                            setVerificationCommands(preset.commands);
                          } else {
                            setVerificationCommands(verificationCommands.map(c => c.trim()).filter(Boolean).length > 0
                              ? verificationCommands
                              : ['']);
                          }
                        }}
                        className={`py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                          verificationPreset === preset.id
                            ? 'bg-white shadow-sm text-emerald-700'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                        title={preset.description}
                      >{preset.label}</button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {VERIFICATION_PRESETS.find(p => p.id === verificationPreset)?.description ?? ''}
                  </p>

                  {/* Show commands preview for non-custom presets */}
                  {verificationPreset !== 'custom' && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
                      {verificationCommands.filter(c => c.trim()).map((cmd, idx) => (
                        <p key={idx} className="text-xs font-mono text-gray-600">{cmd}</p>
                      ))}
                    </div>
                  )}

                  {/* Editable commands for custom preset */}
                  {verificationPreset === 'custom' && (
                    <div className="space-y-2">
                      {verificationCommands.map((cmd, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono disabled:bg-gray-50 disabled:text-gray-400"
                            placeholder="e.g. pnpm run build"
                            value={cmd}
                            onChange={e => {
                              const next = [...verificationCommands];
                              next[idx] = e.target.value;
                              setVerificationCommands(next);
                            }}
                          />
                          <button
                            type="button"
                            className="px-2 py-1 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50"
                            onClick={() => setVerificationCommands(verificationCommands.filter((_, i) => i !== idx))}
                          >×</button>
                        </div>
                      ))}
                      {verificationCommands.length < 10 && (
                        <button
                          type="button"
                          className="text-xs text-blue-600 hover:text-blue-800"
                          onClick={() => setVerificationCommands([...verificationCommands, ''])}
                        >+ Add command</button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {setupForm.mode === 'ssh' && (
                <>
                  <input
                    className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                    placeholder={t('autoresearch.hostPlaceholder')}
                    value={setupForm.host}
                    onChange={e => setSetupForm(f => ({ ...f, host: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <input
                      className="flex-1 px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.userPlaceholder')}
                      value={setupForm.user}
                      onChange={e => setSetupForm(f => ({ ...f, user: e.target.value }))}
                    />
                    <input
                      className="w-20 px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.portPlaceholder')}
                      type="number"
                      value={setupForm.port}
                      onChange={e => setSetupForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                    />
                  </div>
                  <select
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
                    value={setupForm.authMode}
                    onChange={e => setSetupForm(f => ({ ...f, authMode: e.target.value as SshConfig['authMode'] }))}
                  >
                    <option value="agent">{t('autoresearch.authAgent')}</option>
                    <option value="password">{t('autoresearch.authPassword')}</option>
                    <option value="key">{t('autoresearch.authKey')}</option>
                  </select>
                  {setupForm.authMode === 'password' && (
                    <input
                      className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.passwordPlaceholder')}
                      type="password"
                      autoComplete="off"
                      value={setupForm.password}
                      onChange={e => setSetupForm(f => ({ ...f, password: e.target.value }))}
                    />
                  )}
                  {setupForm.authMode === 'key' && (
                    <input
                      className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
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
                    className="flex-1 px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                    placeholder={t('autoresearch.localWorkDirPlaceholder')}
                    value={setupForm.remoteWorkDir}
                    onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: sanitizePathInput(e.target.value) }))}
                  />
                  <button
                    type="button"
                    className="px-3 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                    onClick={handlePickLocalWorkDir}
                  >
                    {t('autoresearch.chooseDirectory')}
                  </button>
                </div>
              ) : (
                <input
                  className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                  placeholder={t('autoresearch.remoteWorkDirPlaceholder')}
                  value={setupForm.remoteWorkDir}
                  onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: sanitizePathInput(e.target.value) }))}
                />
              )}

              {autoResearchMode === 'repo_self_improve' && (
                <p className="text-[10px] text-gray-400">{t('autoresearch.selfImproveWorkdirHint')}</p>
              )}

              <label className="text-xs font-medium text-gray-600 uppercase tracking-wider">
                {autoResearchMode === 'repo_self_improve'
                  ? t('autoresearch.selfImproveRepoField')
                  : 'Experiment Directory'}
              </label>
              <input
                className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                placeholder={autoResearchMode === 'repo_self_improve'
                  ? t('autoresearch.selfImproveRepoPlaceholder')
                  : t('autoresearch.experimentDirPlaceholder')}
                value={experimentDir}
                onChange={e => setExperimentDir(sanitizePathInput(e.target.value))}
              />

              <button
                type="button"
                className="w-full py-2 border rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                disabled={
                  setupLocked
                    || (setupForm.mode === 'ssh'
                      ? (!setupForm.host || !setupForm.user
                          || (setupForm.authMode === 'password' && !setupForm.password)
                          || (setupForm.authMode === 'key' && !setupForm.keyPath)
                          || !setupForm.remoteWorkDir
                          || !experimentDir
                            || Boolean(agentConfigError)
                            || baselineInvalid)
                          : !setupForm.remoteWorkDir || !experimentDir || Boolean(agentConfigError) || baselineInvalid)
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

              {/* ML-only fields: metric, direction, baseline — hidden in self-improve mode */}
              {autoResearchMode === 'ml_experiment' && (
                <>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.metricNamePlaceholder')}
                      value={metric}
                      onChange={e => setMetric(e.target.value)}
                    />
                    <select
                      className="px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      value={direction}
                      onChange={e => setDirection(e.target.value as 'lower' | 'higher')}
                    >
                      <option value="lower">{t('autoresearch.lowerIsBetter')}</option>
                      <option value="higher">{t('autoresearch.higherIsBetter')}</option>
                    </select>
                  </div>
                  <input
                    className={`w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400 ${baselineInvalid ? 'border-red-300' : ''}`}
                    placeholder="Baseline (optional, e.g. 0.963284)"
                    value={baselineInput}
                    onChange={e => setBaselineInput(e.target.value)}
                  />
                  {baselineInvalid && (
                    <div className="text-xs text-red-500">{t('autoresearch.validationBaselineNumber')}</div>
                  )}
                </>
              )}
              {autoResearchMode === 'repo_self_improve' && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {t('autoresearch.selfImproveInfo')}
                </div>
              )}
              <input
                className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:text-gray-400"
                placeholder={t('autoresearch.maxIterationsPlaceholder')}
                type="number"
                value={maxIter}
                onChange={e => setMaxIter(buildAutoResearchDefaultConfig({ iterations: parseInt(e.target.value, 10) || 50 }).iterations)}
              />
              {setupError && setupError !== agentConfigError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                  {setupError}
                </div>
              )}
              <button
                type="submit"
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                disabled={isStarting || setupLocked}
                aria-busy={isStarting}
              >
                {isStarting ? t('autoresearch.starting') : t('autoresearch.start')}
              </button>
              {agentConfigError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {agentConfigError}
                </div>
              )}
            </fieldset>
          </form>
        </div>
      </div>
    );
  }

  if (!displayRun && sortedRuns.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
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
                <p className="mt-2 truncate text-xs text-[#6f665c]">
                  {run.config.mode === 'repo_self_improve'
                    ? 'Self-Improve'
                    : `${run.config.metric} · ${run.config.direction}`}
                </p>
                {run.config.mode === 'repo_self_improve' && run.iterations.length > 0 && (() => {
                  const lastIter = run.iterations[run.iterations.length - 1];
                  const pm = lastIter.parsedMetrics;
                  return (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {pm?.buildPassed !== undefined && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${pm.buildPassed === true ? 'bg-green-100 text-green-700' : pm.buildPassed === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                          build {pm.buildPassed === true ? '✓' : pm.buildPassed === false ? '✗' : '?'}
                        </span>
                      )}
                      {pm?.testsPassed !== undefined && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${pm.testsPassed === true ? 'bg-green-100 text-green-700' : pm.testsPassed === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                          tests {pm.testsPassed === true ? '✓' : pm.testsPassed === false ? '✗' : '?'}
                        </span>
                      )}
                      {pm?.typecheckPassed !== undefined && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${pm.typecheckPassed === true ? 'bg-green-100 text-green-700' : pm.typecheckPassed === false ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                          tsc {pm.typecheckPassed === true ? '✓' : pm.typecheckPassed === false ? '✗' : '?'}
                        </span>
                      )}
                      {pm?.riskLevel && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${pm.riskLevel === 'low' ? 'bg-blue-100 text-blue-700' : pm.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          risk: {String(pm.riskLevel)}
                        </span>
                      )}
                    </div>
                  );
                })()}
                <p className="mt-1 truncate text-xs text-[#8a7f72]">{buildAutoResearchModelDisplayFromSnapshot(run.config.configSnapshot).compactLabel}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 flex-col bg-[#f6f1e8]">
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
            className="min-h-[calc(100vh-2rem)] rounded-[28px] border border-[#e7ded1]"
          />
        </div>
      )}
      {terminalSessionId && (
        <div className="mx-4 mb-4 rounded-xl border bg-white overflow-hidden">
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
      <AutoResearchTabs />
    </MainLayout>
  );
}

export default AutoResearch;
