/**
 * AutoResearchSetupModal — Compact SSH + experiment config modal.
 *
 * Triggered when:
 * - User says "研究/research" in chat → skill activates → modal pops up
 * - User clicks "Setup" button from the AutoResearch panel tab
 */

import { useState, useCallback, useEffect, useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { useSettingsStore, useUIStore } from '@/store';
import {
  isHorizontalArrowKey,
  sanitizePathInput,
} from '@/services/autoresearch/pathInput';
import {
  getAutoResearchDefaultConfig,
  resolveAutoResearchDefaultConfig,
  type AutoResearchDefaultSource,
} from '@/services/autoresearch/defaultConfig';
import {
  logAutoResearchSetupFailure,
  parseOptionalBaseline,
  startAutoResearchRun,
  validateAutoResearchSetupDraft,
} from '@/services/autoresearch/setupFlow';
import { assertSupportedPlatform } from '@/services/autoresearch/platformGuard';
import { resolveAutoResearchRunConfig } from '@/services/autoresearch/runConfig';
import {
  buildAutoResearchRunLockMessage,
  useAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
import { normalizePathForWindowsShellSelection } from '@/utils/windowsShellProfile';

import {
  SetupModalShell,
  SetupModalHeader,
  SetupGuidedTabPanel,
  SetupRunTargetCard,
  SetupExperimentGoalCard,
  SetupChecklistCard,
  type SetupActiveTab,
} from '@/components/autoResearchSetup/AutoResearchSetupModalSections';

/* ---------- main component ---------- */

export function AutoResearchSetupModal() {
  const showSetupModal = useAutoResearchStore(s => s.showSetupModal);
  const setShowSetupModal = useAutoResearchStore(s => s.setShowSetupModal);
  const lifecycleLock = useAutoResearchLifecycleLock();
  const sshConfig = useAutoResearchStore(s => s.sshConfig);
  const lastUsedConfig = useAutoResearchStore(s => s.lastUsedConfig);
  const setSshConfig = useAutoResearchStore(s => s.setSshConfig);
  const setLastUsedConfig = useAutoResearchStore(s => s.setLastUsedConfig);
  const clearLastUsedConfig = useAutoResearchStore(s => s.clearLastUsedConfig);
  const initSession = useAutoResearchStore(s => s.initSession);
  const setCurrentView = useUIStore(s => s.setCurrentView);
  const toggleSettings = useUIStore(s => s.toggleSettings);
  const windowsShellProfile = useSettingsStore((state) => state.windowsShellProfile);
  const suppressFailurePreview = useBrowserObservabilityStore((state) => state.suppressFailurePreview);
  let agentConfigError = '';
  if (showSetupModal) {
    try {
      resolveAutoResearchRunConfig();
    } catch (error) {
      agentConfigError = error instanceof Error ? error.message : String(error);
    }
  }

  const modalRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<SshConfig>({
    mode: sshConfig?.mode || 'local',
    host: sshConfig?.host || '',
    user: sshConfig?.user || 'root',
    keyPath: sshConfig?.keyPath || '',
    port: sshConfig?.port || 22,
    remoteWorkDir: sshConfig?.remoteWorkDir || '~/autoresearch',
    authMode: sshConfig?.authMode || 'agent',
    password: sshConfig?.password || '',
  });
  const [metric, setMetric] = useState(getAutoResearchDefaultConfig().metric);
  const [direction, setDirection] = useState<'lower' | 'higher'>(getAutoResearchDefaultConfig().direction);
  const [maxIter, setMaxIter] = useState(getAutoResearchDefaultConfig().iterations);
  const [baselineInput, setBaselineInput] = useState('');
  const [experimentDir, setExperimentDir] = useState(getAutoResearchDefaultConfig().experimentDir);
  const [prefillSource, setPrefillSource] = useState<AutoResearchDefaultSource>('defaults');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [activeTab, setActiveTab] = useState<SetupActiveTab>('conversational');
  const baselineInvalid = baselineInput.trim().length > 0 && parseOptionalBaseline(baselineInput) === null;
  const setupLocked = lifecycleLock.locked;
  const lockMessage = setupLocked
    ? buildAutoResearchRunLockMessage('change the setup', lifecycleLock)
    : null;

  // Field-level hints (soft validation while editing)
  const fieldHints = {
    host: form.mode === 'ssh' && !form.host.trim() ? t('autoresearch.validationHostRequired') : null,
    user: form.mode === 'ssh' && !form.user.trim() ? t('autoresearch.validationUserRequired') : null,
    password: form.mode === 'ssh' && form.authMode === 'password' && !form.password ? t('autoresearch.validationPasswordRequired') : null,
    keyPath: form.mode === 'ssh' && form.authMode === 'key' && !form.keyPath.trim() ? t('autoresearch.validationKeyPathRequired') : null,
    workdir: !form.remoteWorkDir.trim() ? t('autoresearch.validationWorkdirRequired') : null,
    experimentDir: !experimentDir.trim() ? t('autoresearch.validationExperimentDirRequired') : null,
    metric: !metric.trim() ? t('autoresearch.validationMetricRequired') : null,
    baseline: baselineInvalid ? t('autoresearch.validationBaselineNumber') : null,
  };

  // Readiness statuses
  const providerReady = !agentConfigError;
  const workdirReady = !!form.remoteWorkDir.trim();
  const experimentDirReady = !!experimentDir.trim();
  const metricReady = !!metric.trim();
  const sshReady = form.mode === 'local' || (!!form.host.trim() && !!form.user.trim());

  // Sync form when sshConfig changes (e.g. from previous session)
  useEffect(() => {
    if (sshConfig) {
      setForm((current) => ({
        ...current,
        ...sshConfig,
      }));
    }
  }, [sshConfig]);

  const applyPrefillConfig = useCallback((
    source: AutoResearchDefaultSource,
    config: ReturnType<typeof getAutoResearchDefaultConfig>,
  ) => {
    setForm((current) => ({
      ...current,
      remoteWorkDir: config.workdir,
    }));
    setMetric(config.metric);
    setDirection(config.direction);
    setMaxIter(config.iterations);
    setExperimentDir(config.experimentDir);
    setPrefillSource(source);
  }, []);

  useEffect(() => {
    if (!showSetupModal) {
      return;
    }
    setSubmitError(null);
    setIsStarting(false);
    setActiveTab('conversational');
    const resolved = resolveAutoResearchDefaultConfig(lastUsedConfig);
    applyPrefillConfig(resolved.source, resolved.config);
  }, [applyPrefillConfig, lastUsedConfig, setActiveTab, showSetupModal]);

  useEffect(() => {
    setSubmitError(null);
  }, [agentConfigError, baselineInput, direction, experimentDir, form, maxIter, metric]);

  useEffect(() => {
    if (lockMessage) {
      setSubmitError(lockMessage);
    }
  }, [lockMessage]);

  useEffect(() => {
    suppressFailurePreview(showSetupModal);

    return () => {
      suppressFailurePreview(false);
    };
  }, [showSetupModal, suppressFailurePreview]);

  // Close on click outside
  useEffect(() => {
    if (!showSetupModal) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowSetupModal(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSetupModal, setShowSetupModal]);

  // Close on Escape
  useEffect(() => {
    if (!showSetupModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSetupModal(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showSetupModal, setShowSetupModal]);

  const handlePathInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isHorizontalArrowKey(event.key)) {
      event.stopPropagation();
    }
  }, []);

  const handleWorkDirChange = useCallback((value: string) => {
    if (setupLocked) {
      setSubmitError(lockMessage);
      return;
    }

    setForm((current) => ({
      ...current,
      remoteWorkDir: sanitizePathInput(value),
    }));
  }, [lockMessage, setupLocked]);

  const handlePickWorkDir = useCallback(async () => {
    if (setupLocked) {
      return;
    }
    try {
      const selection = await open({
        directory: true,
        multiple: false,
        defaultPath: form.remoteWorkDir || undefined,
      });
      if (typeof selection === 'string' && selection.length > 0) {
        setForm((current) => ({
          ...current,
          remoteWorkDir: normalizePathForWindowsShellSelection(selection, windowsShellProfile),
        }));
      }
    } catch {
      // User cancelled the dialog or the platform doesn't support it;
      // fall back to manual text input.
    }
  }, [form.remoteWorkDir, setupLocked, windowsShellProfile]);

  const handleExperimentDirChange = useCallback((value: string) => {
    if (setupLocked) {
      setSubmitError(lockMessage);
      return;
    }

    setExperimentDir(sanitizePathInput(value));
  }, [lockMessage, setupLocked]);

  const handlePickExperimentDir = useCallback(async () => {
    if (setupLocked) {
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
  }, [experimentDir, setupLocked, windowsShellProfile]);

  const handleResetToDefaults = useCallback(() => {
    if (setupLocked) {
      setSubmitError(lockMessage);
      return;
    }

    clearLastUsedConfig();
    applyPrefillConfig('defaults', getAutoResearchDefaultConfig());
  }, [applyPrefillConfig, clearLastUsedConfig, lockMessage, setupLocked]);

  const handleStart = useCallback(async () => {
    if (setupLocked) {
      setSubmitError(buildAutoResearchRunLockMessage('start a new run', lifecycleLock));
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      console.debug('[AutoResearch] Modal handleStart called', {
        mode: form.mode,
        experimentDir,
        metric,
        direction,
        iterations: maxIter,
      });
    }

    try {
      await assertSupportedPlatform(form);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      return;
    }

    const validation = validateAutoResearchSetupDraft({
      sshConfig: form,
      experimentDir,
      metric,
      direction,
      iterations: maxIter,
      baselineInput,
      agentConfigError,
    });
    if (!validation.value) {
      setSubmitError(validation.error);
      return;
    }

    setIsStarting(true);
    setSubmitError(null);

    try {
      await startAutoResearchRun(validation.value, {
        setSshConfig,
        setLastUsedConfig,
        initSession,
      });
      setShowSetupModal(false);
      setCurrentView('autoresearch');
    } catch (error) {
      setSubmitError(logAutoResearchSetupFailure('modal-start', error, {
        mode: validation.value.sshConfig.mode,
        experimentDir: validation.value.experimentDir,
        workdir: validation.value.sshConfig.remoteWorkDir,
      }));
    } finally {
      setIsStarting(false);
    }
  }, [agentConfigError, baselineInput, direction, experimentDir, form, initSession, lifecycleLock, maxIter, metric, setCurrentView, setLastUsedConfig, setShowSetupModal, setSshConfig, setupLocked]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleStart();
  }, [handleStart]);

  const handleBootstrapReady = useCallback(() => {
    setShowSetupModal(false);
    setCurrentView('autoresearch');
  }, [setCurrentView, setShowSetupModal]);

  if (!showSetupModal) return null;

  return (
    <SetupModalShell modalRef={modalRef}>
      <SetupModalHeader
        lockMessage={lockMessage}
        setupLocked={setupLocked}
        activeTab={activeTab}
        onClose={() => setShowSetupModal(false)}
        onSelectTab={setActiveTab}
      />

      {activeTab === 'conversational' ? (
        <SetupGuidedTabPanel
          setupLocked={setupLocked}
          lifecycleLock={lifecycleLock}
          form={form}
          onBootstrapReady={handleBootstrapReady}
        />
      ) : (
        <form id="autoresearch-setup-tab-manual" role="tabpanel" aria-labelledby="autoresearch-setup-tab-btn-manual" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6" onSubmit={handleSubmit}>
          <fieldset className="space-y-4" disabled={setupLocked || isStarting}>
            <SetupRunTargetCard
              form={form}
              setForm={setForm}
              fieldHints={fieldHints}
              setupLocked={setupLocked}
              isStarting={isStarting}
              onWorkDirChange={handleWorkDirChange}
              onPathInputKeyDown={handlePathInputKeyDown}
              onPickWorkDir={handlePickWorkDir}
            />
            <SetupExperimentGoalCard
              prefillSource={prefillSource}
              experimentDir={experimentDir}
              metric={metric}
              direction={direction}
              maxIter={maxIter}
              baselineInput={baselineInput}
              fieldHints={fieldHints}
              setupLocked={setupLocked}
              isStarting={isStarting}
              onResetToDefaults={handleResetToDefaults}
              onExperimentDirChange={handleExperimentDirChange}
              onPathInputKeyDown={handlePathInputKeyDown}
              onPickExperimentDir={handlePickExperimentDir}
              onMetricChange={setMetric}
              onDirectionChange={setDirection}
              onMaxIterChange={setMaxIter}
              onBaselineChange={setBaselineInput}
            />
            <SetupChecklistCard
              form={form}
              experimentDir={experimentDir}
              metric={metric}
              direction={direction}
              maxIter={maxIter}
              providerReady={providerReady}
              workdirReady={workdirReady}
              experimentDirReady={experimentDirReady}
              metricReady={metricReady}
              sshReady={sshReady}
              submitError={submitError}
              isStarting={isStarting}
              setupLocked={setupLocked}
              onOpenSettings={toggleSettings}
            />
          </fieldset>
        </form>
      )}
    </SetupModalShell>
  );

}

export default AutoResearchSetupModal;
