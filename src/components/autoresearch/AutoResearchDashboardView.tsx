import { useCallback, useMemo, useState } from 'react';
import { t } from '@/i18n';
import {
  buildAutoResearchLiveOutputFilename,
  formatAutoResearchEventDump,
} from '@/services/autoresearch/eventPresentation';
import { isDemoRun } from '@/services/autoresearch/demoRun';
import { buildAutoResearchModelDisplayFromSnapshot } from '@/services/autoresearch/modelDisplay';
import { AutoResearchRunChips } from './AutoResearchRunChips';
import { AutoResearchDashboardMetricCard } from './AutoResearchDashboardMetricCard';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import { buildAutoResearchRecoverySummary } from '@/services/autoresearch/recoverySummary';
import { handleAutoResearchRecoveryAction } from '@/services/autoresearch/recoveryActions';
import {
  DocumentContentCard,
  DocumentDetailShell,
  DocumentMetadataSidebar,
  type DocumentMetadataSection,
} from '@/components/document';
import { toAgentConfigSnapshot } from '@/services/autoresearch/errors';
import { downloadTextFile, writeClipboardText } from '@/utils/clipboard';
import {
  buildAutoResearchIterationViewModels,
  buildAutoResearchStructuredEvents,
  formatDurationMs,
  formatElapsedTime,
  matchesTimelineFilter,
  type AutoResearchTimelineFilter,
} from '@/services/autoresearch/structuredEvents';
import {
  TIMELINE_FILTERS,
  safeString,
  formatDate,
  shortenRunId,
  formatPhaseLabel,
  formatMetricValue,
  formatGpuTemperature,
  formatRepoStatusLabel,
  basename,
  getPhaseToneClasses,
  getStatusToneClasses,
  getRecoveryToneClasses,
  SectionHeading,
  getRunTitle,
  KeyValueList,
  OverviewStatCard,
  DebugCopyButton,
  TabButton,
  TimelineFilterButton,
  TimelineEventCard,
  PhaseStepPill,
} from './AutoResearchDashboardParts';
import type { DetailTab, AutoResearchDashboardViewProps } from './AutoResearchDashboardParts';

export function AutoResearchDashboardView({
  run,
  liveOutput,
  onBack,
  onClose,
  onOpen,
  onOpenFullReport,
  headerActions,
  className = '',
}: AutoResearchDashboardViewProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('summary');
  const [timelineFilter, setTimelineFilter] = useState<AutoResearchTimelineFilter>('summary');
  const demo = isDemoRun(run);
  const displayedLiveOutput = liveOutput || run.liveOutputExcerpt || '';
  const allEventLines = formatAutoResearchEventDump(run.events);
  const statusLabel = run.status === 'reflection_failed'
    ? t('autoresearch.statusReflectionFailed')
    : run.status.replace(/_/g, ' ');
  const modelDisplay = buildAutoResearchModelDisplayFromSnapshot(toAgentConfigSnapshot(run.config.configSnapshot));
  const structuredEvents = useMemo(() => buildAutoResearchStructuredEvents(run), [run]);
  const filteredEvents = useMemo(
    () => structuredEvents.filter((event) => matchesTimelineFilter(event, timelineFilter)),
    [structuredEvents, timelineFilter],
  );
  const iterationCards = useMemo(() => buildAutoResearchIterationViewModels(run), [run]);
  const currentIterationCard = iterationCards.find((item) => item.iteration === run.currentIteration) || iterationCards[iterationCards.length - 1] || null;
  const recoverySummary = useMemo(() => buildAutoResearchRecoverySummary(run), [run]);
  const handleRecoveryAction = useCallback((action: Parameters<typeof handleAutoResearchRecoveryAction>[0]) => {
    // Dynamic import keeps DashboardView mountable in light UI tests without
    // pulling the full loopEngine dependency graph at module load time.
    void import('@/services/autoresearch/loopEngine').then(({ resumeExperimentLoop, stopExperimentLoop }) => {
      const result = handleAutoResearchRecoveryAction(action, run.id, {
        resumeExperimentLoop,
        stopExperimentLoop,
      });
      if (result.kind === 'inspect') {
        setActiveTab('debug');
      }
    });
  }, [run.id]);
  const gpuTemperatureTone = typeof run.config.gpuTemperatureC === 'number'
    ? run.config.gpuTemperatureC >= 85
      ? 'error'
      : run.config.gpuTemperatureC >= 75
        ? 'warn'
        : 'good'
    : run.config.gpuTelemetryAvailable === false
      ? 'neutral'
      : 'warn';
  const currentPhaseLabel = formatPhaseLabel(run.currentPhase || currentIterationCard?.phase);
  const subtitle = [
    shortenRunId(run.id),
    statusLabel,
    formatDate(run.createdAt),
    safeString(run.config.metric),
    run.config.direction === 'lower' ? t('autoresearch.lowerIsBetter') : t('autoresearch.higherIsBetter'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ');
  const sidebarSections: DocumentMetadataSection[] = [
    {
      label: 'Run',
      content: (
        <KeyValueList items={[
          ['Status', statusLabel],
          ['Run ID', run.id],
          ['Iterations', `${run.currentIteration}/${run.config.iterations}`],
          ['Current Phase', currentPhaseLabel],
          ['Metric', run.config.metric || 'N/A'],
          ['Direction', run.config.direction === 'lower' ? t('autoresearch.lowerIsBetter') : t('autoresearch.higherIsBetter')],
        ]} />
      ),
    },
    {
      label: 'Config',
      content: (
        <KeyValueList items={[
          ['Name', run.config.configSnapshot.configName || 'N/A'],
          ['Provider', modelDisplay.providerLabel],
          ['Model', modelDisplay.modelLabel],
          ['Workdir', run.config.workdir],
          ['Experiment Dir', run.config.experimentDir],
        ]} />
      ),
    },
  ];

  // Centralize redaction so every copy/download path strips secrets once.
  const handleCopy = (text: string) => {
    void writeClipboardText(redactSensitiveText(text)).catch(() => undefined);
  };

  const handleDownload = () => {
    if (!displayedLiveOutput) {
      return;
    }
    downloadTextFile(
      buildAutoResearchLiveOutputFilename(run),
      redactSensitiveText(displayedLiveOutput),
    );
  };

  return (
    <DocumentDetailShell
      title={getRunTitle(run)}
      subtitle={subtitle}
      badge={demo ? t('autoresearch.detail.demo') : t('autoresearch.detail.autoResearch')}
      filename={run.id}
      backLabel={t('autoresearch.detail.backToRuns')}
      onBack={onBack}
      onOpen={onOpen}
      openLabel={t('autoresearch.detail.open')}
      onClose={onClose}
      headerActions={(
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          {headerActions}
          {onOpenFullReport && (
            <button
              type="button"
              onClick={onOpenFullReport}
              className="rounded-xl border border-gray-200 bg-white/90 px-3 py-2 text-[12px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
            >
              {t('autoresearch.detail.fullReport')}
            </button>
          )}
        </div>
      )}
      className={className}
      sidebar={(
        <DocumentMetadataSidebar
          createdAt={run.createdAt}
          updatedAt={run.updatedAt}
          path={run.config.experimentDir}
          tags={[
            statusLabel,
            run.config.metric || 'metric',
            modelDisplay.providerLabel,
            modelDisplay.modelLabel,
          ]}
          sections={sidebarSections}
        />
      )}
    >
      <DocumentContentCard>
        <div className="space-y-6">
          {demo && (
            <div className="rounded-2xl border border-[#e9e7e2] bg-[#faf9f6] px-4 py-3 text-sm leading-6 text-[#37352f]">
              {t('autoresearch.detail.demoNotice')}
            </div>
          )}

          {recoverySummary && (
            <section data-recovery-card="run" className={`rounded-2xl border px-4 py-4 ${getRecoveryToneClasses(recoverySummary.tone)}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">{recoverySummary.title}</p>
                  <p className="mt-2 text-sm leading-6">{redactSensitiveText(recoverySummary.message)}</p>
                  {recoverySummary.hint && (
                    <p className="mt-2 text-sm leading-6 opacity-90">{redactSensitiveText(recoverySummary.hint)}</p>
                  )}
                  {typeof recoverySummary.iteration === 'number' && recoverySummary.iteration > 0 && (
                    <p className="mt-2 text-[11px] uppercase tracking-[0.16em] opacity-70">Iteration {recoverySummary.iteration}</p>
                  )}
                </div>
                <span className="rounded-full border border-current/20 bg-white/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                  {recoverySummary.mode === 'inspect_only'
                    ? 'Inspect only'
                    : recoverySummary.mode === 'cooldown'
                      ? 'Auto retry'
                      : recoverySummary.mode === 'manual_ack'
                        ? 'Manual ack'
                        : 'Recovery'}
                </span>
              </div>
              {recoverySummary.actions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {recoverySummary.actions.map((action) => (
                    <button
                      key={`run-recovery-${action.type}-${action.label || 'label'}`}
                      type="button"
                      disabled={action.supported === false}
                      title={action.reason || action.label || action.type}
                      onClick={() => handleRecoveryAction(action)}
                      className="rounded-full border border-current/20 bg-white/70 px-3 py-1 text-[11px] font-medium transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {action.label || action.type}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionHeading subtitle="Summary is the primary AutoResearch view. Raw execution details stay in Debug.">Run Detail</SectionHeading>
              <div className="flex flex-wrap gap-2">
                <TabButton active={activeTab === 'summary'} onClick={() => setActiveTab('summary')}>Summary</TabButton>
                <TabButton active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')}>Timeline</TabButton>
                <TabButton active={activeTab === 'debug'} onClick={() => setActiveTab('debug')}>Debug</TabButton>
              </div>
            </div>
          </section>

          {activeTab === 'summary' && (
            <>
              <section className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <SectionHeading subtitle="Understand the run status before reading raw execution logs.">Run Overview</SectionHeading>
                  {headerActions && <div className="flex flex-wrap gap-2">{headerActions}</div>}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <OverviewStatCard label="Target metric" value={`${run.config.metric} (${run.config.direction === 'lower' ? t('autoresearch.lowerIsBetter') : t('autoresearch.higherIsBetter')})`} />
                  <OverviewStatCard label="Status" value={statusLabel} tone={run.status === 'failed' || run.status === 'reflection_failed' ? 'error' : run.status === 'completed' ? 'good' : 'warn'} />
                  <OverviewStatCard label="Current iteration" value={`${run.currentIteration}/${run.config.iterations}`} />
                  <OverviewStatCard label="Current phase" value={currentPhaseLabel} tone={run.currentPhase === 'FAILED' ? 'error' : run.currentPhase === 'DONE' ? 'good' : 'warn'} />
                  <OverviewStatCard label="Provider" value={modelDisplay.providerLabel} />
                  <OverviewStatCard label="Model" value={modelDisplay.modelLabel} />
                  <OverviewStatCard label="Elapsed" value={formatElapsedTime(run)} />
                  <OverviewStatCard label="Best metric" value={formatMetricValue(run.bestMetricValue)} tone={typeof run.bestMetricValue === 'number' ? 'good' : 'neutral'} />
                  <OverviewStatCard label="Best iteration" value={run.bestIteration ?? 'N/A'} />
                  <OverviewStatCard label="Failures" value={run.failureCount} tone={run.failureCount > 0 ? 'warn' : 'neutral'} />
                  <OverviewStatCard label="Python" value={run.config.preferredPythonCommand || 'N/A'} tone={run.config.preferredPythonCommand ? 'good' : 'neutral'} />
                  <OverviewStatCard label="Git state" value={formatRepoStatusLabel(run)} tone={run.config.repoStatus === 'clean' ? 'good' : run.config.repoStatus === 'dirty' ? 'warn' : 'neutral'} />
                  <OverviewStatCard label="GPU temperature" value={formatGpuTemperature(run.config.gpuTemperatureC)} tone={gpuTemperatureTone} />
                  <OverviewStatCard
                    label="GPU telemetry"
                    value={run.config.gpuSummary || (run.config.gpuTelemetryAvailable === false ? 'Unavailable' : 'N/A')}
                    tone={run.config.gpuSummary ? 'good' : 'neutral'}
                  />
                </div>
              </section>

              <div>
                <SectionHeading subtitle="High-level run chips remain available, but they are no longer the primary source of detail.">Run Snapshot</SectionHeading>
                <AutoResearchRunChips run={run} className="mt-3" />
              </div>

              {run.summary && !recoverySummary && (
                <div className="rounded-2xl border border-[#e9e7e2] bg-[#faf9f6] px-4 py-3 text-sm leading-6 text-[#37352f]">
                  {redactSensitiveText(run.summary)}
                </div>
              )}

              <AutoResearchDashboardMetricCard run={run} />

              <section className="rounded-2xl border border-gray-200 bg-white p-4">
                <SectionHeading subtitle="Each iteration shows the hypothesis, changes, execution result, metrics, artifacts, reflection, and recovery actions.">
                  Iterations
                </SectionHeading>
                {iterationCards.length === 0 ? (
                  <p className="mt-4 text-sm text-gray-500">No iterations recorded yet.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {iterationCards.map((iteration) => (
                      <article key={iteration.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-gray-500">
                              <span>Iteration {iteration.iteration}</span>
                              <span className={`rounded-full border px-2 py-0.5 ${getStatusToneClasses(iteration.status)}`}>{iteration.status}</span>
                              <span className={`rounded-full border px-2 py-0.5 ${getPhaseToneClasses(iteration.phase)}`}>{iteration.phase}</span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-gray-900">{iteration.narrative}</p>
                          </div>
                          <div className="text-right text-[12px] text-gray-600">
                            <p>{formatDurationMs(iteration.durationMs)}</p>
                            <p className="mt-1">exit={iteration.exitCode ?? 'N/A'}</p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {iteration.phaseSteps.map((step) => (
                            <PhaseStepPill key={`${iteration.id}-${step.phase}`} phase={step.phase} state={step.state} />
                          ))}
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <div className="space-y-3 text-sm text-gray-800">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Hypothesis</p>
                              <p className="mt-1">{iteration.hypothesis || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Code changes</p>
                              <p className="mt-1">{iteration.codeChangesSummary || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Execution command</p>
                              <p className="mt-1 font-mono text-[12px] break-all">{iteration.executionCommand || 'Not recorded'}</p>
                            </div>
                          </div>

                          <div className="space-y-3 text-sm text-gray-800">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Parsed metrics</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {Object.entries(iteration.parsedMetrics).map(([key, value]) => (
                                  <span key={`${iteration.id}-${key}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-800">
                                    {key}={formatMetricValue(value)}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Reflection</p>
                              <p className="mt-1">{iteration.reflectionSummary || 'N/A'}</p>
                            </div>
                            {iteration.failureReason && (
                              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-red-800">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-600">Failure reason</p>
                                <p className="mt-1">{iteration.failureReason}</p>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 space-y-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Artifacts</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {iteration.artifacts.length > 0 ? iteration.artifacts.map((artifact) => (
                                <span key={artifact} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600">
                                  {basename(artifact)}
                                </span>
                              )) : <span className="text-sm text-gray-500">No artifacts recorded.</span>}
                            </div>
                          </div>

                          {iteration.recoveryActions.length > 0 && (
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Recovery actions</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {iteration.recoveryActions.map((action) => (
                                  <button
                                    key={`${iteration.id}-${action.type}`}
                                    type="button"
                                    disabled={action.supported === false}
                                    title={action.reason || action.label || action.type}
                                    onClick={() => handleRecoveryAction(action)}
                                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {action.label || action.type}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'timeline' && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionHeading subtitle="Filter the execution timeline by summary signals, tools, errors, metrics, or raw events.">Timeline</SectionHeading>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(allEventLines)}
                    data-copy-target="recent-events-all"
                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-900"
                  >
                    {t('autoresearch.recentEvents.copyAll')}
                  </button>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{filteredEvents.length}</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {TIMELINE_FILTERS.map((filter) => (
                  <TimelineFilterButton
                    key={filter.id}
                    active={timelineFilter === filter.id}
                    label={filter.label}
                    onClick={() => setTimelineFilter(filter.id)}
                  />
                ))}
              </div>
              {filteredEvents.length === 0 ? (
                <p className="mt-6 text-sm text-gray-500">No events match the current filter.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {filteredEvents.map((event) => (
                    <TimelineEventCard
                      key={event.id}
                      event={event}
                      onCopy={handleCopy}
                      fallbackProvider={modelDisplay.providerLabel}
                      fallbackModel={modelDisplay.modelLabel}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'debug' && (
            <section className="rounded-2xl border border-[#e9e7e2] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SectionHeading subtitle="Raw terminal output and unfiltered event dump remain available for recovery and deep debugging.">Debug</SectionHeading>
                </div>
                <button
                  type="button"
                  onClick={handleDownload}
                  data-copy-target="live-output-download"
                  className="rounded-full border border-[#e7e5e1] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6f6e69] transition-colors hover:border-[#ded9d1] hover:text-[#37352f]"
                >
                  {t('autoresearch.liveOutput.download')}
                </button>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9a97]">Raw Events</p>
                    <DebugCopyButton
                      label={t('autoresearch.debug.copyRawEvents')}
                      onClick={() => handleCopy(allEventLines)}
                      dataCopyTarget="debug-raw-events"
                    />
                  </div>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-2xl border border-[#e9e7e2] bg-[#faf9f6] p-4 text-xs leading-5 text-[#37352f] whitespace-pre-wrap shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]">
                    {allEventLines || 'No events recorded.'}
                  </pre>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9a97]">Raw Conversation</p>
                    <DebugCopyButton
                      label={t('autoresearch.debug.copyRawConversation')}
                      onClick={() => handleCopy(displayedLiveOutput)}
                      dataCopyTarget="debug-raw-conversation"
                    />
                  </div>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-2xl border border-[#e9e7e2] bg-[#faf9f6] p-4 text-xs leading-5 text-[#37352f] whitespace-pre-wrap shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]">
                    {redactSensitiveText(displayedLiveOutput) || 'No live output recorded.'}
                  </pre>
                </div>
              </div>
            </section>
          )}
        </div>
      </DocumentContentCard>
    </DocumentDetailShell>
  );
}

export default AutoResearchDashboardView;
