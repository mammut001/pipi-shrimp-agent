/**
 * AutoResearch Page - Experiment monitoring & control dashboard.
 *
 * Layout: MainLayout with experiment timeline in center and detail panel on right.
 */

import { useEffect } from 'react';
import { t } from '@/i18n';
import { TerminalPanel } from '@/components';
import {
  AutoResearchActiveRunBanner,
  AutoResearchInlineHint,
  AutoResearchMetricSummary,
  AutoResearchConnectionStatusPanel,
  AutoResearchReadinessRow,
  AutoResearchSummaryItem,
  AutoResearchTargetSummary,
} from '@/components/autoresearch/AutoResearchSetupHelpers';
import { AutoResearchTabs } from '@/components/autoresearch/AutoResearchTabs';
import { AutoResearchRunDetailDocument } from '@/components/autoresearch/AutoResearchRunDetailDocument';
import { MainLayout } from '@/layout';
import { useAutoResearchStore, getSelectedAutoResearchRun } from '@/store/autoresearchStore';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import { suspendExperimentLoopOnUnmount } from '@/services/autoresearch';
import { ExperimentDetailPanel } from './autoResearch/ExperimentDetailPanel';
import { AutoResearchRunControls } from './autoResearch/AutoResearchRunControls';
import { AutoResearchSetupFields } from './autoResearch/AutoResearchSetupFields';
import { AutoResearchEmptyState } from './autoResearch/AutoResearchEmptyState';
import { AutoResearchRunListView } from './autoResearch/AutoResearchRunListView';
import { useAutoResearchViewController } from './autoResearch/useAutoResearchViewController';

// ============== Main View ==============

function AutoResearchView() {
  const {
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
  } = useAutoResearchViewController();
  const isPersistedPausedRun = !selectedRunContext.isActive
    && Boolean(displayRun?.resumeToken?.resumable)
    && (displayRun?.status === 'paused' || displayRun?.resumeToken?.status === 'paused');

  const runControls = (selectedRunContext.isActive || isPersistedPausedRun) ? (
    <AutoResearchRunControls
      selectedRunContext={selectedRunContext}
      loopState={loopState}
      isPersistedPausedRun={isPersistedPausedRun}
      displayRun={displayRun}
      handlePause={handlePause}
      handleResume={handleResume}
      handleStop={handleStop}
    />
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
              <AutoResearchSetupFields
                setupForm={setupForm}
                setSetupForm={setSetupForm}
                handlePickLocalWorkDir={handlePickLocalWorkDir}
                experimentDir={experimentDir}
                setExperimentDir={setExperimentDir}
                handlePickExperimentDir={handlePickExperimentDir}
                metric={metric}
                setMetric={setMetric}
                direction={direction}
                setDirection={setDirection}
                baselineInput={baselineInput}
                setBaselineInput={setBaselineInput}
                baselineInvalid={baselineInvalid}
                maxIter={maxIter}
                setMaxIter={setMaxIter}
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
      <AutoResearchEmptyState handleShowSetup={handleShowSetup} />
    );
  }

  if (showRunList) {
    return (
      <AutoResearchRunListView
        isSelectMode={isSelectMode}
        batchSelectedIds={batchSelectedIds}
        handleBatchDelete={handleBatchDelete}
        handleExitSelection={handleExitSelection}
        activeRun={activeRun}
        handleViewActiveRun={handleViewActiveRun}
        handleShowSetup={handleShowSetup}
        sortedRuns={sortedRuns}
        displayRun={displayRun}
        activeRunId={activeRunId}
        handleToggleSelectRun={handleToggleSelectRun}
        handleSingleDelete={handleSingleDelete}
        selectRun={selectRun}
        setSelectedExperiment={setSelectedExperiment}
        setShowSetup={setShowSetup}
        setShowRunList={setShowRunList}
      />
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
          {terminalVisible && (
            <div style={{ height: 260 }}>
              <TerminalPanel
                sessionId={terminalSessionId}
                cwd={terminalCwd || undefined}
                onClose={handleTerminalClose}
                onSessionReady={handleTerminalReady}
                onSessionExit={handleTerminalExit}
              />
            </div>
          )}
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

  useEffect(() => {
    return () => {
      suspendExperimentLoopOnUnmount();
    };
  }, []);

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
