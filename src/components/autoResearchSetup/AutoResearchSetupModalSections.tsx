/**
 * Section panels for AutoResearchSetupModal.
 * Behavior-preserving extract (split-soon / <500 follow-up).
 */

import { lazy, Suspense, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { t } from '@/i18n';
import type { SshConfig } from '@/store/autoresearchStore';
import {
  buildAutoResearchDefaultConfig,
  type AutoResearchDefaultSource,
} from '@/services/autoresearch/defaultConfig';
import {
  buildAutoResearchRunLockMessage,
  type AutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
import {
  SectionCard,
  FieldLabel,
  InlineHint,
  ReadinessRow,
  SummaryItem,
  PathInputRow,
} from '@/components/autoResearchSetup/AutoResearchSetupModalUi';

const BootstrapChatView = lazy(() => import('@/components/autoresearch/BootstrapChatView').then((module) => ({
  default: module.BootstrapChatView,
})));

export type SetupActiveTab = 'conversational' | 'advanced';

export type SetupFieldHints = {
  host: string | null;
  user: string | null;
  password: string | null;
  keyPath: string | null;
  workdir: string | null;
  experimentDir: string | null;
  metric: string | null;
  baseline: string | null;
};

export function SetupModalHeader({
  lockMessage,
  setupLocked,
  activeTab,
  onClose,
  onSelectTab,
}: {
  lockMessage: string | null;
  setupLocked: boolean;
  activeTab: SetupActiveTab;
  onClose: () => void;
  onSelectTab: (tab: SetupActiveTab) => void;
}) {
  return (
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
          onClick={onClose}
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
          onClick={() => onSelectTab('conversational')}
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
          onClick={() => onSelectTab('advanced')}
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
  );
}

export function SetupGuidedTabPanel({
  setupLocked,
  lifecycleLock,
  form,
  onBootstrapReady,
}: {
  setupLocked: boolean;
  lifecycleLock: AutoResearchLifecycleLock;
  form: SshConfig;
  onBootstrapReady: () => void;
}) {
  return (
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
          <BootstrapChatView onReady={onBootstrapReady} sshConfig={form} />
        </Suspense>
      )}
    </div>
  );
}

export function SetupRunTargetCard({
  form,
  setForm,
  fieldHints,
  setupLocked,
  isStarting,
  onWorkDirChange,
  onPathInputKeyDown,
  onPickWorkDir,
}: {
  form: SshConfig;
  setForm: Dispatch<SetStateAction<SshConfig>>;
  fieldHints: SetupFieldHints;
  setupLocked: boolean;
  isStarting: boolean;
  onWorkDirChange: (value: string) => void;
  onPathInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPickWorkDir: () => void;
}) {
  return (
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
          onChange={onWorkDirChange}
          onKeyDown={onPathInputKeyDown}
          placeholder={form.mode === 'local'
            ? t('autoresearch.localWorkDirPlaceholder')
            : t('autoresearch.remoteWorkDirPlaceholder')}
          ariaLabel="AutoResearch workdir"
          invalid={!!fieldHints.workdir}
          disabled={setupLocked || isStarting}
          onPick={form.mode === 'local' ? onPickWorkDir : undefined}
          pickLabel={t('autoresearch.chooseDirectory')}
        />
        <InlineHint>{t('autoresearch.workdirHelper')}</InlineHint>
      </div>
    </SectionCard>
  );
}

export function SetupExperimentGoalCard({
  prefillSource,
  experimentDir,
  metric,
  direction,
  maxIter,
  baselineInput,
  fieldHints,
  setupLocked,
  isStarting,
  onResetToDefaults,
  onExperimentDirChange,
  onPathInputKeyDown,
  onPickExperimentDir,
  onMetricChange,
  onDirectionChange,
  onMaxIterChange,
  onBaselineChange,
}: {
  prefillSource: AutoResearchDefaultSource;
  experimentDir: string;
  metric: string;
  direction: 'lower' | 'higher';
  maxIter: number;
  baselineInput: string;
  fieldHints: SetupFieldHints;
  setupLocked: boolean;
  isStarting: boolean;
  onResetToDefaults: () => void;
  onExperimentDirChange: (value: string) => void;
  onPathInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPickExperimentDir: () => void;
  onMetricChange: (value: string) => void;
  onDirectionChange: (value: 'lower' | 'higher') => void;
  onMaxIterChange: (value: number) => void;
  onBaselineChange: (value: string) => void;
}) {
  return (
    <SectionCard title={t('autoresearch.card.experimentGoal')}>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[12px] text-indigo-700">
        <span>
          {prefillSource === 'last-used'
            ? t('autoresearch.prefillLastUsed')
            : t('autoresearch.prefillDefaults')}
        </span>
        <button
          type="button"
          onClick={onResetToDefaults}
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-white/70 hover:text-indigo-800 disabled:cursor-not-allowed disabled:text-indigo-400"
        >
          {t('autoresearch.resetToDefaults')}
        </button>
      </div>
      <div className="space-y-2">
        <FieldLabel label={t('autoresearch.field.experimentDir')} required />
        <PathInputRow
          value={experimentDir}
          onChange={onExperimentDirChange}
          onKeyDown={onPathInputKeyDown}
          placeholder={t('autoresearch.experimentDirPlaceholder')}
          ariaLabel="Experiment path"
          invalid={!!fieldHints.experimentDir}
          disabled={setupLocked || isStarting}
          onPick={onPickExperimentDir}
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
            onChange={e => onMetricChange(e.target.value)}
          />
          <select
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none focus:border-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
            value={direction}
            onChange={e => onDirectionChange(e.target.value as 'lower' | 'higher')}
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
          onChange={e => onMaxIterChange(buildAutoResearchDefaultConfig({ iterations: parseInt(e.target.value, 10) || 50 }).iterations)}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel label={t('autoresearch.field.baselineOptional')} />
        <input
          className={`w-full rounded-xl border bg-white px-3 py-2 text-[12px] shadow-sm transition-colors focus:outline-none ${fieldHints.baseline ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-indigo-400'}`}
          placeholder={t('autoresearch.baselinePlaceholder')}
          value={baselineInput}
          onChange={e => onBaselineChange(e.target.value)}
        />
        {fieldHints.baseline && <InlineHint>{fieldHints.baseline}</InlineHint>}
        <InlineHint>{t('autoresearch.baselineHelper')}</InlineHint>
      </div>
    </SectionCard>
  );
}

export function SetupChecklistCard({
  form,
  experimentDir,
  metric,
  direction,
  maxIter,
  providerReady,
  workdirReady,
  experimentDirReady,
  metricReady,
  sshReady,
  submitError,
  isStarting,
  setupLocked,
  onOpenSettings,
}: {
  form: SshConfig;
  experimentDir: string;
  metric: string;
  direction: 'lower' | 'higher';
  maxIter: number;
  providerReady: boolean;
  workdirReady: boolean;
  experimentDirReady: boolean;
  metricReady: boolean;
  sshReady: boolean;
  submitError: string | null;
  isStarting: boolean;
  setupLocked: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <SectionCard title={t('autoresearch.card.setupChecklist')}>
      {/* Readiness checklist */}
      <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
        <ReadinessRow
          label={t('autoresearch.check.provider')}
          status={providerReady ? 'ok' : 'error'}
          action={!providerReady && (
            <button
              type="button"
              onClick={onOpenSettings}
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
          <SummaryItem label={t('autoresearch.summaryTarget')} value={form.mode === 'local' ? t('autoresearch.mode.local') : `SSH ${form.user}@${form.host || '...'}`} />
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
  );
}

export function SetupModalShell({
  modalRef,
  children,
}: {
  modalRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
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
        {children}
      </div>
    </div>
  );
}
