/**
 * AutoResearchSetupModal — Compact SSH + experiment config modal.
 *
 * Triggered when:
 * - User says "研究/research" in chat → skill activates → modal pops up
 * - User clicks "Setup" button from the AutoResearch panel tab
 */

import { useState, useCallback, useEffect, useRef, lazy, Suspense, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
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
  useAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';

const BootstrapChatView = lazy(() => import('@/components/autoresearch/BootstrapChatView').then((module) => ({
  default: module.BootstrapChatView,
})));

/* ---------- local helper components ---------- */

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">{title}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="flex items-center gap-1 text-[12px] font-semibold text-gray-700">
      {label}
      {required && <span className="text-rose-400 text-[10px]">*</span>}
    </label>
  );
}

function InlineHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-snug text-gray-500">{children}</p>;
}

function ReadinessRow({ label, status, action }: { label: string; status: 'ok' | 'warn' | 'error'; action?: React.ReactNode }) {
  const colors = { ok: 'text-emerald-700', warn: 'text-amber-700', error: 'text-rose-600' };
  const bgColors = { ok: 'bg-emerald-50', warn: 'bg-amber-50', error: 'bg-rose-50' };
  const icons = { ok: '✓', warn: '⚠', error: '✗' };
  const statusLabel = { ok: t('autoresearch.readiness.filled'), warn: t('autoresearch.readiness.check'), error: t('autoresearch.readiness.missing') };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2 text-[12px]">
      <span className="min-w-0 text-gray-700">{label}</span>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${colors[status]} ${bgColors[status]}`}>
          <span aria-hidden="true">{icons[status]}</span>
          {statusLabel[status]}
        </span>
        {action}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">{label}</span>
      <span className="truncate font-medium text-gray-800">{value}</span>
    </div>
  );
}

function PathInputRow({
  value,
  onChange,
  onKeyDown,
  placeholder,
  ariaLabel,
  onPick,
  pickLabel,
  disabled,
  invalid,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  ariaLabel: string;
  onPick?: () => void;
  pickLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-stretch gap-2 ${className ?? ''}`}>
      <input
        className={`flex-1 rounded-xl border bg-white px-3 py-2 font-mono text-[12px] text-gray-800 shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${
          invalid
            ? 'border-rose-300 focus:border-rose-400'
            : 'border-gray-200 focus:border-indigo-400'
        }`}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
      {onPick && (
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        >
          {pickLabel}
        </button>
      )}
    </div>
  );
}

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
        setForm((current) => ({ ...current, remoteWorkDir: selection }));
      }
    } catch {
      // User cancelled the dialog or the platform doesn't support it;
      // fall back to manual text input.
    }
  }, [form.remoteWorkDir, setupLocked]);

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
        setExperimentDir(selection);
      }
    } catch {
      // User cancelled the dialog or the platform doesn't support it;
      // fall back to manual text input.
    }
  }, [experimentDir, setupLocked]);

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1c1917]/40 backdrop-blur-sm animate-in fade-in duration-150" role="presentation">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="autoresearch-setup-modal-title"
        className="flex w-[860px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-[28px] border border-gray-200/80 bg-white shadow-[0_24px_60px_-24px_rgba(28,25,23,0.35)] animate-in zoom-in-95 duration-200"
        style={{ height: 'min(760px, calc(100vh - 48px))' }}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-indigo-50 p-2.5">
                <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <div>
                <h3 id="autoresearch-setup-modal-title" className="text-base font-semibold text-gray-900">
                  AutoResearch<span className="text-gray-400"> · {t('autoresearch.headerSubtitle')}</span>
                </h3>
              </div>
            </div>
            <button
              onClick={() => setShowSetupModal(false)}
              aria-label="Close setup modal"
              className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {lockMessage && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              {lockMessage}
            </div>
          )}
          {/* Tab bar */}
          <div className="mt-5 flex gap-1 rounded-2xl bg-gray-100/80 p-1">
            <button
              type="button"
              id="autoresearch-setup-tab-btn-guided"
              onClick={() => setActiveTab('conversational')}
              disabled={setupLocked}
              role="tab"
              aria-selected={activeTab === 'conversational'}
              aria-controls="autoresearch-setup-tab-guided"
              className={`flex-1 rounded-xl py-1.5 text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${activeTab === 'conversational' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('autoresearch.tabs.guided')}
            </button>
            <button
              type="button"
              id="autoresearch-setup-tab-btn-manual"
              onClick={() => setActiveTab('advanced')}
              disabled={setupLocked}
              role="tab"
              aria-selected={activeTab === 'advanced'}
              aria-controls="autoresearch-setup-tab-manual"
              className={`flex-1 rounded-xl py-1.5 text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${activeTab === 'advanced' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('autoresearch.tabs.manual')}
            </button>
          </div>
          <p className="mt-2 px-1 text-[12px] text-gray-500">
            {activeTab === 'conversational'
              ? t('autoresearch.tabs.guidedSubtitle')
              : t('autoresearch.tabs.manualSubtitle')}
          </p>
        </div>

        {/* Body */}
        {activeTab === 'conversational' ? (
          <div id="autoresearch-setup-tab-guided" role="tabpanel" aria-labelledby="autoresearch-setup-tab-btn-guided" className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {setupLocked ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-amber-800">
                {buildAutoResearchRunLockMessage('start a new run', lifecycleLock)}
              </div>
            ) : (
              <Suspense fallback={
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
                  {t('autoresearch.loadingBootstrap')}
                </div>
              }>
                <BootstrapChatView onReady={handleBootstrapReady} />
              </Suspense>
            )}
          </div>
        ) : (
        <form id="autoresearch-setup-tab-manual" role="tabpanel" aria-labelledby="autoresearch-setup-tab-btn-manual" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6" onSubmit={handleSubmit}>
          <fieldset className="space-y-4" disabled={setupLocked || isStarting}>

          {/* Card 1: Run Target */}
          <SectionCard title={t('autoresearch.card.runTarget')}>
            {/* Mode toggle */}
            <div className="flex gap-1 rounded-2xl bg-gray-100/80 p-1">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'local' }))}
                className={`flex-1 rounded-xl py-1.5 text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${form.mode === 'local' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >{t('autoresearch.mode.local')}</button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'ssh' }))}
                className={`flex-1 rounded-xl py-1.5 text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${form.mode === 'ssh' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >{t('autoresearch.mode.ssh')}</button>
            </div>

            {form.mode === 'ssh' && (
              <>
                <div className="space-y-2">
                  <FieldLabel label={t('autoresearch.field.host')} required />
                  <div className="flex gap-2">
                    <input
                      className={`flex-1 rounded-xl border bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.host ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-indigo-400'}`}
                      placeholder={t('autoresearch.hostPlaceholder')}
                      value={form.host}
                      onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                    />
                    <input
                      className="w-20 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none focus:border-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
                      placeholder={t('autoresearch.portPlaceholder')}
                      type="number"
                      value={form.port}
                      onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                    />
                  </div>
                  {fieldHints.host && <InlineHint>{fieldHints.host}</InlineHint>}
                </div>
                <div className="space-y-2">
                  <FieldLabel label={t('autoresearch.field.userAuth')} required />
                  <div className="flex gap-2">
                    <input
                      className={`w-28 rounded-xl border bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.user ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-indigo-400'}`}
                      placeholder={t('autoresearch.userPlaceholder')}
                      value={form.user}
                      onChange={e => setForm(f => ({ ...f, user: e.target.value }))}
                    />
                    <select
                      className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none focus:border-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
                      value={form.authMode}
                      onChange={e => setForm(f => ({ ...f, authMode: e.target.value as SshConfig['authMode'] }))}
                    >
                      <option value="agent">{t('autoresearch.authOptionAgent')}</option>
                      <option value="password">{t('autoresearch.authOptionPassword')}</option>
                      <option value="key">{t('autoresearch.authOptionKey')}</option>
                    </select>
                  </div>
                  {fieldHints.user && <InlineHint>{fieldHints.user}</InlineHint>}
                </div>
                {form.authMode === 'password' && (
                  <div className="space-y-2">
                    <FieldLabel label={t('autoresearch.field.password')} required />
                    <input
                      className={`w-full rounded-xl border bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.password ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-indigo-400'}`}
                      placeholder={t('autoresearch.passwordPlaceholder')}
                      type="password"
                      autoComplete="off"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    />
                    {fieldHints.password && <InlineHint>{fieldHints.password}</InlineHint>}
                    <p className="text-[11px] leading-relaxed text-gray-500">
                      {t('autoresearch.passwordHintBefore')}<code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">sshpass</code>:<br/>
                      <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">{t('autoresearch.sshpassHintCommand')}</code>
                    </p>
                  </div>
                )}
                {form.authMode === 'key' && (
                  <div className="space-y-2">
                    <FieldLabel label={t('autoresearch.field.keyPath')} required />
                    <input
                      className={`w-full rounded-xl border bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.keyPath ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-indigo-400'}`}
                      placeholder={t('autoresearch.keyPathPlaceholder')}
                      value={form.keyPath}
                      onChange={e => setForm(f => ({ ...f, keyPath: e.target.value }))}
                    />
                    {fieldHints.keyPath && <InlineHint>{fieldHints.keyPath}</InlineHint>}
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <FieldLabel label={form.mode === 'local' ? t('autoresearch.field.localWorkDir') : t('autoresearch.field.remoteWorkDir')} required />
              <PathInputRow
                value={form.remoteWorkDir}
                onChange={handleWorkDirChange}
                onKeyDown={handlePathInputKeyDown}
                placeholder={form.mode === 'local'
                  ? t('autoresearch.localWorkDirPlaceholder')
                  : t('autoresearch.remoteWorkDirPlaceholder')}
                ariaLabel="AutoResearch workdir"
                invalid={!!fieldHints.workdir}
                disabled={setupLocked || isStarting}
                onPick={form.mode === 'local' ? handlePickWorkDir : undefined}
                pickLabel={t('autoresearch.chooseDirectory')}
              />
              <InlineHint>{t('autoresearch.workdirHelper')}</InlineHint>
            </div>
          </SectionCard>

          {/* Card 2: Experiment Goal */}
          <SectionCard title={t('autoresearch.card.experimentGoal')}>
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[12px] text-indigo-700">
              <span>
                {prefillSource === 'last-used'
                  ? t('autoresearch.prefillLastUsed')
                  : t('autoresearch.prefillDefaults')}
              </span>
              <button
                type="button"
                onClick={handleResetToDefaults}
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-white/70 hover:text-indigo-800 disabled:cursor-not-allowed disabled:text-indigo-400"
              >
                {t('autoresearch.resetToDefaults')}
              </button>
            </div>
            <div className="space-y-2">
              <FieldLabel label={t('autoresearch.field.experimentDir')} required />
              <PathInputRow
                value={experimentDir}
                onChange={handleExperimentDirChange}
                onKeyDown={handlePathInputKeyDown}
                placeholder={t('autoresearch.experimentDirPlaceholder')}
                ariaLabel="Experiment path"
                invalid={!!fieldHints.experimentDir}
                disabled={setupLocked || isStarting}
                onPick={handlePickExperimentDir}
                pickLabel={t('autoresearch.chooseDirectory')}
              />
              <InlineHint>{t('autoresearch.experimentDirHelper')}</InlineHint>
            </div>
            <div className="space-y-2">
              <FieldLabel label={t('autoresearch.field.metricName')} required />
              <div className="flex gap-2">
                <input
                  className={`flex-1 rounded-xl border bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${fieldHints.metric ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-indigo-400'}`}
                  placeholder={t('autoresearch.metricNamePlaceholder')}
                  value={metric}
                  onChange={e => setMetric(e.target.value)}
                />
                <select
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none focus:border-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
                  value={direction}
                  onChange={e => setDirection(e.target.value as 'lower' | 'higher')}
                >
                  <option value="lower">{t('autoresearch.lowerIsBetter')}</option>
                  <option value="higher">{t('autoresearch.higherIsBetter')}</option>
                </select>
              </div>
              <InlineHint>{t('autoresearch.metricHelper')}</InlineHint>
            </div>
            <div className="space-y-2">
              <FieldLabel label={t('autoresearch.field.maxIterations')} />
              <input
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none focus:border-indigo-400"
                placeholder={t('autoresearch.maxIterationsPlaceholder')}
                type="number"
                value={maxIter}
                onChange={e => setMaxIter(buildAutoResearchDefaultConfig({ iterations: parseInt(e.target.value, 10) || 50 }).iterations)}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel label={t('autoresearch.field.baselineOptional')} />
              <input
                className={`w-full rounded-xl border bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none ${fieldHints.baseline ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-indigo-400'}`}
                placeholder={t('autoresearch.baselinePlaceholder')}
                value={baselineInput}
                onChange={e => setBaselineInput(e.target.value)}
              />
              {fieldHints.baseline && <InlineHint>{fieldHints.baseline}</InlineHint>}
              <InlineHint>{t('autoresearch.baselineHelper')}</InlineHint>
            </div>
          </SectionCard>

          {/* Card 3: Readiness & Start */}
          <SectionCard title={t('autoresearch.card.setupChecklist')}>
            {/* Readiness checklist */}
            <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
              <ReadinessRow
                label={t('autoresearch.check.provider')}
                status={providerReady ? 'ok' : 'error'}
                action={!providerReady && (
                  <button
                    type="button"
                    onClick={toggleSettings}
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-white"
                  >
                    {t('autoresearch.action.openSettings')}
                  </button>
                )}
              />
              <ReadinessRow label={t('autoresearch.check.workdir')} status={workdirReady ? 'ok' : 'warn'} />
              <ReadinessRow label={t('autoresearch.check.experimentDir')} status={experimentDirReady ? 'ok' : 'warn'} />
              <ReadinessRow label={t('autoresearch.check.metric')} status={metricReady ? 'ok' : 'warn'} />
              {form.mode === 'ssh' && (
                <ReadinessRow label={t('autoresearch.check.sshConnection')} status={sshReady ? 'ok' : 'warn'} />
              )}
              <p className="pt-1 text-[11px] text-gray-500">{t('autoresearch.readiness.helper')}</p>
            </div>

            {/* Summary strip */}
            <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
              <h5 className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">{t('autoresearch.summaryTitle')}</h5>
              <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                <SummaryItem label={t('autoresearch.summaryTarget')} value={form.mode === 'local' ? 'Local' : `SSH ${form.user}@${form.host || '...'}`} />
                <SummaryItem label={t('autoresearch.summaryWorkdir')} value={form.remoteWorkDir || '—'} />
                <SummaryItem label={t('autoresearch.summaryExperimentDir')} value={experimentDir || '—'} />
                <SummaryItem label={t('autoresearch.summaryMetric')} value={`${metric || '—'} (${direction === 'lower' ? t('autoresearch.summaryDirectionMinimize') : t('autoresearch.summaryDirectionMaximize')})`} />
                <SummaryItem label={t('autoresearch.summaryIterations')} value={String(maxIter)} />
              </div>
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="whitespace-pre-wrap rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700" role="alert">
                {submitError}
              </div>
            )}

            {/* Start button */}
            <button
              type="submit"
              className="w-full rounded-2xl bg-indigo-600 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isStarting || setupLocked}
              aria-busy={isStarting}
            >
              {isStarting ? t('autoresearch.starting') : t('autoresearch.start')}
            </button>

            {/* Preparing state */}
            {isStarting && (
              <div className="space-y-1 text-[12px] text-gray-500">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                  <span>{t('autoresearch.preparing')}</span>
                </div>
                <div className="space-y-0.5 pl-5 text-[11px] text-gray-400">
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
