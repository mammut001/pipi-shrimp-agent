import type React from 'react';
import { t } from '@/i18n';
import type { AutoResearchBootstrapResult } from '@/services/autoresearch/bootstrap/types';
import type { SshConfig } from '@/store/autoresearchStore';
import {
  type AutoResearchLifecycleLock,
  buildAutoResearchRunLockMessage,
} from '@/services/autoresearch/runLock';
import {
  BOOTSTRAP_MISSING_FINALIZE_MESSAGE,
  resolveBootstrapRemoteWorkDir,
} from './bootstrapChatHelpers';
import { AutoResearchSetupPhaseChip } from './AutoResearchSetupPhaseChip';

export interface BootstrapReadySummaryCardProps {
  readyResult: AutoResearchBootstrapResult | null;
  handoffSummary: string | null;
  sshConfig?: SshConfig;
  iterations: number;
  onChangeIterations: (iterations: number) => void;
  lifecycleLock: AutoResearchLifecycleLock;
  onStartHandoff: (result: AutoResearchBootstrapResult, runIterations: number) => void;
}

export function BootstrapReadySummaryCard({
  readyResult,
  handoffSummary,
  sshConfig,
  iterations,
  onChangeIterations,
  lifecycleLock,
  onStartHandoff,
}: BootstrapReadySummaryCardProps) {
  if (!readyResult || readyResult.status !== 'ready' || handoffSummary) {
    return null;
  }

  const isSshMode = sshConfig && sshConfig.mode === 'ssh';
  const displayedWorkDir = isSshMode
    ? resolveBootstrapRemoteWorkDir(sshConfig, readyResult.plan.scaffold.workDir)
    : readyResult.plan.scaffold.workDir;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm animate-fadeIn flex flex-col gap-2 font-sans">
      <div>
        <p className="font-semibold">{t('autoresearch.bootstrap.readyTitle')}</p>
        <p className="mt-1">{readyResult.plan.primaryMetric} · {displayedWorkDir}</p>
        <p className="mt-1 text-xs text-emerald-800">{readyResult.plan.successCriteria}</p>
      </div>
      <div className="flex flex-col gap-2 border-t border-emerald-200/50 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="text-xs font-semibold text-emerald-800">{t('autoresearch.bootstrap.iterations')}</label>
        <input
          type="number"
          min={1}
          max={1000}
          value={iterations}
          onChange={(e) => onChangeIterations(parseInt(e.target.value, 10) || 1)}
          className="w-16 rounded border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <button
          type="button"
          data-testid="bootstrap-start-handoff"
          aria-disabled={lifecycleLock.locked}
          title={lifecycleLock.locked ? buildAutoResearchRunLockMessage('start a new run', lifecycleLock) : undefined}
          onClick={() => onStartHandoff(readyResult, iterations)}
          className={`w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1 font-sans sm:ml-auto sm:w-auto ${lifecycleLock.locked ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <span>🚀</span> {t('autoresearch.bootstrap.start')}
        </button>
        {lifecycleLock.locked && (
          <p className="w-full text-xs text-amber-800 sm:basis-full" data-testid="bootstrap-handoff-lock-hint">
            {buildAutoResearchRunLockMessage('start a new run', lifecycleLock)}
          </p>
        )}
      </div>
    </div>
  );
}

export interface BootstrapConfirmationPanelProps {
  readyResult: AutoResearchBootstrapResult | null;
  handoffSummary: string | null;
  onBackToRecipe: () => void;
}

export function BootstrapConfirmationPanel({
  readyResult,
  handoffSummary,
  onBackToRecipe,
}: BootstrapConfirmationPanelProps) {
  if (readyResult?.status !== 'needs_user_confirmation' || handoffSummary) {
    return null;
  }

  return (
    <div
      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm font-sans flex flex-col gap-2"
      data-testid="bootstrap-confirmation-panel"
    >
      <p className="font-semibold">{t('autoresearch.bootstrap.needsConfirmationTitle')}</p>
      <p className="text-xs text-amber-800">
        {readyResult.unresolvedQuestions.filter(Boolean).join(' ') || 'The bootstrap plan needs user confirmation before starting AutoResearch.'}
      </p>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onBackToRecipe}
          className="rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 px-3 py-1 text-xs font-semibold transition-all"
        >
          {t('autoresearch.bootstrap.backToRecipe')}
        </button>
      </div>
    </div>
  );
}

export interface BootstrapHandoffBannerProps {
  handoffSummary: string | null;
}

export function BootstrapHandoffBanner({
  handoffSummary,
}: BootstrapHandoffBannerProps) {
  if (!handoffSummary) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm font-sans">
      {t('autoresearch.bootstrap.started')}: {handoffSummary}
    </div>
  );
}

export interface BootstrapErrorPanelProps {
  error: string | null;
  missingFinalize: boolean;
  isStreaming: boolean;
  onRetryBootstrap: () => void;
  onBackToRecipe: () => void;
}

export function BootstrapErrorPanel({
  error,
  missingFinalize,
  isStreaming,
  onRetryBootstrap,
  onBackToRecipe,
}: BootstrapErrorPanelProps) {
  if (!error) {
    return null;
  }

  return (
    <div
      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm font-sans"
      data-testid="bootstrap-error-panel"
    >
      <p>{error}</p>
      {(missingFinalize || error.includes(BOOTSTRAP_MISSING_FINALIZE_MESSAGE)) && !isStreaming && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="retry-bootstrap"
            onClick={onRetryBootstrap}
            className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-xs font-bold transition-all shadow-sm"
          >
            {t('autoresearch.bootstrap.retry')}
          </button>
          <button
            type="button"
            data-testid="back-to-recipe-from-error"
            onClick={onBackToRecipe}
            className="rounded-lg border border-red-300 bg-white hover:bg-red-50 text-red-800 px-3 py-1.5 text-xs font-bold transition-all"
          >
            {t('autoresearch.bootstrap.backToRecipe')}
          </button>
        </div>
      )}
    </div>
  );
}

export interface BootstrapDeveloperConsoleProps {
  isStreaming: boolean;
  stoppedByUser: boolean;
  error: string | null;
  readyResult: AutoResearchBootstrapResult | null;
  agentLogs: string;
  consoleScrollRef?: React.RefObject<HTMLDivElement>;
  setupPhaseInput: Parameters<typeof AutoResearchSetupPhaseChip>[0]['input'];
  onStopBootstrap: () => void;
  onBackToRecipe: () => void;
}

export function BootstrapDeveloperConsole({
  isStreaming,
  stoppedByUser,
  error,
  readyResult,
  agentLogs,
  consoleScrollRef,
  setupPhaseInput,
  onStopBootstrap,
  onBackToRecipe,
}: BootstrapDeveloperConsoleProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-neutral-950 text-neutral-200 font-mono text-xs rounded-2xl overflow-hidden border border-neutral-800 shadow-xl">
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/80"></span>
            <span className="w-3 h-3 rounded-full bg-yellow-500/80"></span>
            <span className="w-3 h-3 rounded-full bg-green-500/80"></span>
          </div>
          <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider ml-2">{t('autoresearch.bootstrap.developerConsole')}</span>
          <AutoResearchSetupPhaseChip
            input={setupPhaseInput}
            className="ml-1 border-neutral-700 bg-neutral-800/80 text-neutral-300"
          />
        </div>
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <>
              <button
                type="button"
                onClick={onStopBootstrap}
                className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-red-700 bg-red-900/40 hover:bg-red-800/60 hover:text-white transition-all text-red-200 font-sans"
              >
                {t('autoresearch.bootstrap.stop')}
              </button>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] text-neutral-400">{t('autoresearch.bootstrap.inProgress')}</span>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onBackToRecipe}
                className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 hover:text-white transition-all text-neutral-300 font-sans"
              >
                ← {t('autoresearch.bootstrap.backToRecipe')}
              </button>
              {stoppedByUser ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  <span className="text-[10px] text-amber-400 font-bold">{t('autoresearch.bootstrap.statusStopped')}</span>
                </>
              ) : error ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="text-[10px] text-red-400 font-bold">{t('autoresearch.bootstrap.statusFailed')}</span>
                </>
              ) : readyResult?.status === 'ready' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="text-[10px] text-emerald-400 font-bold">{t('autoresearch.bootstrap.statusFinished')}</span>
                </>
              ) : readyResult?.status === 'needs_user_confirmation' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  <span className="text-[10px] text-amber-400 font-bold">{t('autoresearch.bootstrap.statusNeedsConfirmation')}</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  <span className="text-[10px] text-amber-400 font-bold">{t('autoresearch.bootstrap.statusIncomplete')}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5 selection:bg-neutral-800" ref={consoleScrollRef}>
        <pre className="whitespace-pre-wrap leading-relaxed">{agentLogs || t('autoresearch.bootstrap.initializing')}</pre>
        {isStreaming && (
          <div className="inline-flex items-center gap-1 text-[10px] text-neutral-500 animate-pulse font-sans">
            <span>▋</span>
            <span>{t('autoresearch.bootstrap.streamingLogs')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export interface BootstrapChatStartedPanelsProps {
  readyResult: AutoResearchBootstrapResult | null;
  handoffSummary: string | null;
  sshConfig?: SshConfig;
  iterations: number;
  onChangeIterations: (iterations: number) => void;
  lifecycleLock: AutoResearchLifecycleLock;
  onStartHandoff: (result: AutoResearchBootstrapResult, runIterations: number) => void;
  onBackToRecipe: () => void;
  error: string | null;
  missingFinalize: boolean;
  isStreaming: boolean;
  onRetryBootstrap: () => void;
  stoppedByUser: boolean;
  agentLogs: string;
  consoleScrollRef?: React.RefObject<HTMLDivElement>;
  setupPhaseInput: Parameters<typeof AutoResearchSetupPhaseChip>[0]['input'];
  onStopBootstrap: () => void;
}

export function BootstrapChatStartedPanels(props: BootstrapChatStartedPanelsProps) {
  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0 animate-fadeIn">
      <BootstrapReadySummaryCard
        readyResult={props.readyResult}
        handoffSummary={props.handoffSummary}
        sshConfig={props.sshConfig}
        iterations={props.iterations}
        onChangeIterations={props.onChangeIterations}
        lifecycleLock={props.lifecycleLock}
        onStartHandoff={props.onStartHandoff}
      />
      <BootstrapConfirmationPanel
        readyResult={props.readyResult}
        handoffSummary={props.handoffSummary}
        onBackToRecipe={props.onBackToRecipe}
      />
      <BootstrapHandoffBanner handoffSummary={props.handoffSummary} />
      <BootstrapErrorPanel
        error={props.error}
        missingFinalize={props.missingFinalize}
        isStreaming={props.isStreaming}
        onRetryBootstrap={props.onRetryBootstrap}
        onBackToRecipe={props.onBackToRecipe}
      />
      <BootstrapDeveloperConsole
        isStreaming={props.isStreaming}
        stoppedByUser={props.stoppedByUser}
        error={props.error}
        readyResult={props.readyResult}
        agentLogs={props.agentLogs}
        consoleScrollRef={props.consoleScrollRef}
        setupPhaseInput={props.setupPhaseInput}
        onStopBootstrap={props.onStopBootstrap}
        onBackToRecipe={props.onBackToRecipe}
      />
    </div>
  );
}
