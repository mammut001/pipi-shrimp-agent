/**
 * AutoResearchSetupModal — Compact SSH + experiment config modal.
 *
 * Triggered when:
 * - User says "研究/research" in chat → skill activates → modal pops up
 * - User clicks "Setup" button from the AutoResearch panel tab
 */

import { useState, useCallback, useEffect, useRef, lazy, Suspense, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { t } from '@/i18n';
import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { useUIStore } from '@/store';
import {
  isHorizontalArrowKey,
  sanitizePathInput,
} from '@/services/autoresearch/pathInput';
import {
  buildAutoResearchDefaultConfig,
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
  getAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';

const BootstrapChatView = lazy(() => import('@/components/autoresearch/BootstrapChatView').then((module) => ({
  default: module.BootstrapChatView,
})));

/* ---------- local helper components ---------- */

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-4 space-y-3">
      <h4 className="text-xs font-bold text-gray-800">{title}</h4>
      {children}
    </div>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="flex items-center gap-1 text-[11px] font-semibold text-gray-600">
      {label}
      {required && <span className="text-red-400 text-[10px]">*</span>}
    </label>
  );
}

function InlineHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-gray-400 leading-snug">{children}</p>;
}

function ReadinessRow({ label, status, action }: { label: string; status: 'ok' | 'warn' | 'error'; action?: React.ReactNode }) {
  const colors = { ok: 'text-emerald-600', warn: 'text-amber-600', error: 'text-red-500' };
  const icons = { ok: '✓', warn: '⚠', error: '✗' };
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-gray-600">{label}</span>
      <span className={`font-semibold ${colors[status]}`}>
        {icons[status]} {status === 'ok' ? 'Ready' : status === 'warn' ? 'Warning' : 'Missing'}
      </span>
      {action}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="font-medium text-gray-700 truncate">{value}</span>
    </div>
  );
}

/* ---------- main component ---------- */

export function AutoResearchSetupModal() {
  const showSetupModal = useAutoResearchStore(s => s.showSetupModal);
  const setShowSetupModal = useAutoResearchStore(s => s.setShowSetupModal);
  const lifecycleLock = useAutoResearchStore((state) => getAutoResearchLifecycleLock(state));
  const sshConfig = useAutoResearchStore(s => s.sshConfig);
  const lastUsedConfig = useAutoResearchStore(s => s.lastUsedConfig);
  const setSshConfig = useAutoResearchStore(s => s.setSshConfig);
  const setLastUsedConfig = useAutoResearchStore(s => s.setLastUsedConfig);
  const clearLastUsedConfig = useAutoResearchStore(s => s.clearLastUsedConfig);
  const initSession = useAutoResearchStore(s => s.initSession);
  const setAgentPanelTab = useUIStore(s => s.setAgentPanelTab);
  const toggleSettings = useUIStore(s => s.toggleSettings);
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
  const [activeTab, setActiveTab] = useState<'conversational' | 'advanced'>('conversational');
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

  const handleExperimentDirChange = useCallback((value: string) => {
    if (setupLocked) {
      setSubmitError(lockMessage);
      return;
    }

    setExperimentDir(sanitizePathInput(value));
  }, [lockMessage, setupLocked]);

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
      await assertSupportedPlatform();
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
      setAgentPanelTab('autoresearch');
    } catch (error) {
      setSubmitError(logAutoResearchSetupFailure('modal-start', error, {
        mode: validation.value.sshConfig.mode,
        experimentDir: validation.value.experimentDir,
        workdir: validation.value.sshConfig.remoteWorkDir,
      }));
    } finally {
      setIsStarting(false);
    }
  }, [agentConfigError, baselineInput, direction, experimentDir, form, initSession, lifecycleLock, maxIter, metric, setAgentPanelTab, setLastUsedConfig, setShowSetupModal, setSshConfig, setupLocked]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleStart();
  }, [handleStart]);

  const handleBootstrapReady = useCallback(() => {
    setShowSetupModal(false);
    setAgentPanelTab('autoresearch');
  }, [setAgentPanelTab, setShowSetupModal]);

  if (!showSetupModal) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        ref={modalRef}
        className="flex w-[860px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-white shadow-2xl animate-in zoom-in-95 duration-200"
        style={{ height: 'min(760px, calc(100vh - 48px))' }}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-indigo-50 rounded-lg">
                <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">AutoResearch</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Prepare an autonomous experiment run.</p>
              </div>
            </div>
            <button
              onClick={() => setShowSetupModal(false)}
              className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {lockMessage && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {lockMessage}
            </div>
          )}
          {/* Tab bar */}
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('conversational')}
              disabled={setupLocked}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${activeTab === 'conversational' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('autoresearch.tabs.guided')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('advanced')}
              disabled={setupLocked}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${activeTab === 'advanced' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('autoresearch.tabs.manual')}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 px-1">
            {activeTab === 'conversational'
              ? t('autoresearch.tabs.guidedSubtitle')
              : t('autoresearch.tabs.manualSubtitle')}
          </p>
        </div>

        {/* Body */}
        {activeTab === 'conversational' ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {setupLocked ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-amber-800">
                {buildAutoResearchRunLockMessage('start a new run', lifecycleLock)}
              </div>
            ) : (
              <Suspense fallback={
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
                  Loading AutoResearch bootstrap...
                </div>
              }>
                <BootstrapChatView onReady={handleBootstrapReady} />
              </Suspense>
            )}
          </div>
        ) : (
        <form className="min-h-0 flex-1 overflow-y-auto px-5 pb-5" onSubmit={handleSubmit}>
          <fieldset className="space-y-4" disabled={setupLocked || isStarting}>

          {/* Card 1: Run Target */}
          <SectionCard title={t('autoresearch.card.runTarget')}>
            {/* Mode toggle */}
            <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'local' }))}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${form.mode === 'local' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
              >Local</button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'ssh' }))}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${form.mode === 'ssh' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
              >SSH</button>
            </div>

            {form.mode === 'ssh' && (
              <>
                <div className="space-y-1.5">
                  <FieldLabel label="Host" required />
                  <div className="flex gap-2">
                    <input
                      className={`flex-1 px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.host ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`}
                      placeholder="e.g. 192.168.1.10 or connect.westd.seetacloud.com"
                      value={form.host}
                      onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                    />
                    <input
                      className="w-16 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder="port"
                      type="number"
                      value={form.port}
                      onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                    />
                  </div>
                  {fieldHints.host && <InlineHint>{fieldHints.host}</InlineHint>}
                </div>
                <div className="space-y-1.5">
                  <FieldLabel label="User & Auth" required />
                  <div className="flex gap-2">
                    <input
                      className={`w-24 px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.user ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`}
                      placeholder="user"
                      value={form.user}
                      onChange={e => setForm(f => ({ ...f, user: e.target.value }))}
                    />
                    <select
                      className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors bg-white disabled:bg-gray-50 disabled:text-gray-400"
                      value={form.authMode}
                      onChange={e => setForm(f => ({ ...f, authMode: e.target.value as SshConfig['authMode'] }))}
                    >
                      <option value="agent">Auth: Agent (~/.ssh/config)</option>
                      <option value="password">Auth: Password</option>
                      <option value="key">Auth: Private key</option>
                    </select>
                  </div>
                  {fieldHints.user && <InlineHint>{fieldHints.user}</InlineHint>}
                </div>
                {form.authMode === 'password' && (
                  <div className="space-y-1.5">
                    <FieldLabel label="Password" required />
                    <input
                      className={`w-full px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.password ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`}
                      placeholder="password"
                      type="password"
                      autoComplete="off"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    />
                    {fieldHints.password && <InlineHint>{fieldHints.password}</InlineHint>}
                    <p className="text-[10px] text-gray-400 leading-snug">
                      Kept in memory only (not saved to disk). Requires <code className="px-1 py-0.5 bg-gray-100 rounded">sshpass</code>:<br/>
                      <code className="px-1 py-0.5 bg-gray-100 rounded">brew install hudochenkov/sshpass/sshpass</code>
                    </p>
                  </div>
                )}
                {form.authMode === 'key' && (
                  <div className="space-y-1.5">
                    <FieldLabel label="Key Path" required />
                    <input
                      className={`w-full px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.keyPath ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`}
                      placeholder="e.g. ~/.ssh/id_rsa"
                      value={form.keyPath}
                      onChange={e => setForm(f => ({ ...f, keyPath: e.target.value }))}
                    />
                    {fieldHints.keyPath && <InlineHint>{fieldHints.keyPath}</InlineHint>}
                  </div>
                )}
              </>
            )}

            <div className="space-y-1.5">
              <FieldLabel label={form.mode === 'local' ? 'Local Work Directory' : 'Remote Work Directory'} required />
              <input
                className={`w-full px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.workdir ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`}
                placeholder={form.mode === 'local'
                  ? t('autoresearch.localWorkDirPlaceholder')
                  : t('autoresearch.remoteWorkDirPlaceholder')}
                aria-label="AutoResearch workdir"
                value={form.remoteWorkDir}
                onChange={e => handleWorkDirChange(e.target.value)}
                onKeyDown={handlePathInputKeyDown}
              />
              <InlineHint>{t('autoresearch.workdirHelper')}</InlineHint>
            </div>
          </SectionCard>

          {/* Card 2: Experiment Goal */}
          <SectionCard title={t('autoresearch.card.experimentGoal')}>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-indigo-50/70 px-2.5 py-2 text-[10px] text-indigo-700">
              <span>
                {prefillSource === 'last-used'
                  ? t('autoresearch.prefillLastUsed')
                  : t('autoresearch.prefillDefaults')}
              </span>
              <button
                type="button"
                onClick={handleResetToDefaults}
                className="font-semibold text-indigo-700 transition-colors hover:text-indigo-800 disabled:cursor-not-allowed disabled:text-indigo-400"
              >
                {t('autoresearch.resetToDefaults')}
              </button>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Experiment Directory" required />
              <input
                className={`w-full px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none transition-colors font-mono disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.experimentDir ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`}
                placeholder={t('autoresearch.experimentDirPlaceholder')}
                aria-label="Experiment path"
                value={experimentDir}
                onChange={e => handleExperimentDirChange(e.target.value)}
                onKeyDown={handlePathInputKeyDown}
              />
              <InlineHint>{t('autoresearch.experimentDirHelper')}</InlineHint>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Metric Name" required />
              <div className="flex gap-2">
                <input
                  className={`flex-1 px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.metric ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`}
                  placeholder={t('autoresearch.metricNamePlaceholder')}
                  value={metric}
                  onChange={e => setMetric(e.target.value)}
                />
                <select
                  className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors bg-white disabled:bg-gray-50 disabled:text-gray-400"
                  value={direction}
                  onChange={e => setDirection(e.target.value as 'lower' | 'higher')}
                >
                  <option value="lower">{t('autoresearch.lowerIsBetter')}</option>
                  <option value="higher">{t('autoresearch.higherIsBetter')}</option>
                </select>
              </div>
              <InlineHint>{t('autoresearch.metricHelper')}</InlineHint>
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Max Iterations" />
              <input
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                placeholder={t('autoresearch.maxIterationsPlaceholder')}
                type="number"
                value={maxIter}
                onChange={e => setMaxIter(buildAutoResearchDefaultConfig({ iterations: parseInt(e.target.value, 10) || 50 }).iterations)}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel label="Baseline (optional)" />
              <input
                className={`w-full px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none transition-colors ${fieldHints.baseline ? 'border-red-300 focus:border-red-400' : 'border-gray-200 focus:border-indigo-400'}`}
                placeholder="e.g. 0.963284"
                value={baselineInput}
                onChange={e => setBaselineInput(e.target.value)}
              />
              {fieldHints.baseline && <InlineHint>{fieldHints.baseline}</InlineHint>}
              <InlineHint>{t('autoresearch.baselineHelper')}</InlineHint>
            </div>
          </SectionCard>

          {/* Card 3: Readiness & Start */}
          <SectionCard title={t('autoresearch.card.readiness')}>
            {/* Readiness checklist */}
            <div className="space-y-2 rounded-lg bg-gray-50 p-3">
              <ReadinessRow
                label="Provider / API"
                status={providerReady ? 'ok' : 'error'}
                action={!providerReady && (
                  <button
                    type="button"
                    onClick={toggleSettings}
                    className="ml-2 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    Open Settings
                  </button>
                )}
              />
              <ReadinessRow label="Work directory" status={workdirReady ? 'ok' : 'warn'} />
              <ReadinessRow label="Experiment directory" status={experimentDirReady ? 'ok' : 'warn'} />
              <ReadinessRow label="Metric" status={metricReady ? 'ok' : 'warn'} />
              {form.mode === 'ssh' && (
                <ReadinessRow label="SSH connection" status={sshReady ? 'ok' : 'warn'} />
              )}
            </div>

            {/* Summary strip */}
            <div className="space-y-2 rounded-lg border border-gray-200 p-3">
              <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('autoresearch.summaryTitle')}</h5>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <SummaryItem label={t('autoresearch.summaryTarget')} value={form.mode === 'local' ? 'Local' : `SSH ${form.user}@${form.host || '...'}`} />
                <SummaryItem label={t('autoresearch.summaryWorkdir')} value={form.remoteWorkDir || '—'} />
                <SummaryItem label={t('autoresearch.summaryExperimentDir')} value={experimentDir || '—'} />
                <SummaryItem label={t('autoresearch.summaryMetric')} value={`${metric || '—'} (${direction === 'lower' ? t('autoresearch.summaryDirectionMinimize') : t('autoresearch.summaryDirectionMaximize')})`} />
                <SummaryItem label={t('autoresearch.summaryIterations')} value={String(maxIter)} />
              </div>
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                {submitError}
              </div>
            )}

            {/* Start button */}
            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 transition-all"
              disabled={isStarting || setupLocked}
              aria-busy={isStarting}
            >
              {isStarting ? t('autoresearch.starting') : t('autoresearch.start')}
            </button>

            {/* Preparing state */}
            {isStarting && (
              <div className="space-y-1 text-[11px] text-gray-500">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span>{t('autoresearch.preparing')}</span>
                </div>
                <div className="pl-5 space-y-0.5 text-[10px] text-gray-400">
                  <div>• {t('autoresearch.preparingStepValidating')}</div>
                  <div>• {t('autoresearch.preparingStepChecking')}</div>
                  <div>• {t('autoresearch.preparingStepPreparing')}</div>
                </div>
              </div>
            )}
          </SectionCard>

          </fieldset>
        </form>
        )}
      </div>
    </div>
  );
}

export default AutoResearchSetupModal;
