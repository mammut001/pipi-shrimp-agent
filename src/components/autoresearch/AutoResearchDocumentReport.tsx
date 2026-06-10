import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { t } from '@/i18n';
import {
  buildAutoResearchLiveOutputFilename,
  formatAutoResearchEventDump,
  formatAutoResearchEventLine,
  getAutoResearchEventMetadataBadges,
} from '@/services/autoresearch/eventPresentation';
import type { AutoResearchIterationRecord, AutoResearchRunRecord } from '@/services/autoresearch/history';
import { formatError as formatAutoResearchError } from '@/services/autoresearch/errors';
import { buildAutoResearchRunDocument, redactSensitiveText } from '@/services/autoresearch/runDocument';
import {
  buildIterationSummaries,
  buildMetricTimeline,
  formatMetricValue,
  getBestMetricPoint,
  type AutoResearchIterationSummary,
} from '@/services/autoresearch/metricTimeline';
import {
  DocumentContentCard,
  DocumentDetailShell,
  DocumentMetadataSidebar,
  MarkdownDocumentPreview,
} from '@/components/document';
import { downloadTextFile, writeClipboardText } from '@/utils/clipboard';
import { AutoResearchMetricChart } from './AutoResearchMetricChart';
import { AutoResearchIterationTable } from './AutoResearchIterationTable';

interface AutoResearchDocumentReportProps {
  run: AutoResearchRunRecord;
  liveOutput?: string;
  onBack?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  headerActions?: ReactNode;
  className?: string;
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return 'N/A';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed || 'artifact';
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatSafeError(error: unknown): string {
  return formatAutoResearchError(error);
}

function StatCard({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: 'neutral' | 'good' | 'warn' }) {
  const toneClassName = tone === 'good'
    ? 'border-green-100 bg-green-50/70 text-green-900'
    : tone === 'warn'
      ? 'border-amber-100 bg-amber-50/70 text-amber-900'
      : 'border-gray-200 bg-white text-gray-900';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClassName}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-65">{label}</p>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
      {children}
    </h4>
  );
}

function KeyValueList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <div className="space-y-2 text-[12px] leading-5">
      {items.map(([label, value]) => (
        <div key={label}>
          <p className="font-bold uppercase tracking-[0.14em] text-gray-500">{label}</p>
          <div className="mt-0.5 break-words text-gray-800">{value ?? 'N/A'}</div>
        </div>
      ))}
    </div>
  );
}

function SelectedIterationDetail({
  summary,
  iteration,
}: {
  summary: AutoResearchIterationSummary | null;
  iteration?: AutoResearchIterationRecord;
}) {
  if (!summary) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionTitle>{summary.iteration === 0 ? 'Baseline Detail' : `Iteration ${summary.iteration}`}</SectionTitle>
          <p className="mt-1 font-mono text-sm text-gray-900">
            {summary.metricName}={formatMetricValue(summary.metricValue)} · {summary.impactLabel}
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
          {summary.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Change</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-800">{redactSensitiveText(iteration?.change || summary.changeSummary)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Hypothesis</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-800">{redactSensitiveText(iteration?.hypothesis || summary.hypothesis || 'N/A')}</p>
        </div>
      </div>

      {iteration?.reasoning && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Reasoning</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-800">{redactSensitiveText(iteration.reasoning)}</p>
        </div>
      )}

      {summary.error && (
        <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          {redactSensitiveText(summary.error)}
        </div>
      )}

      {summary.artifactPaths && summary.artifactPaths.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Artifacts</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {summary.artifactPaths.slice(0, 8).map((artifactPath) => (
              <div key={artifactPath} className="rounded-xl bg-white px-3 py-2 text-[11px] text-gray-600 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" title={artifactPath}>
                <span className="font-mono">{basename(artifactPath)}</span>
                <p className="mt-1 truncate text-gray-500">{artifactPath}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] text-gray-500">
        {[formatDateTime(summary.startedAt), formatDateTime(summary.endedAt)].filter((value) => value !== 'N/A').join(' → ') || 'N/A'}
      </p>
    </div>
  );
}

export function AutoResearchDocumentReport({
  run,
  liveOutput,
  onBack,
  onOpen,
  onClose,
  headerActions,
  className = '',
}: AutoResearchDocumentReportProps) {
  const { document, documentError } = useMemo(() => {
    try {
      return { document: buildAutoResearchRunDocument(run), documentError: null as string | null };
    } catch (error) {
      return { document: null, documentError: formatSafeError(error) };
    }
  }, [run]);

  const { timeline, timelineError } = useMemo(() => {
    try {
      return { timeline: buildMetricTimeline(run), timelineError: null as string | null };
    } catch (error) {
      return { timeline: [] as ReturnType<typeof buildMetricTimeline>, timelineError: formatSafeError(error) };
    }
  }, [run]);

  const { summaries, summariesError } = useMemo(() => {
    try {
      return { summaries: buildIterationSummaries(run), summariesError: null as string | null };
    } catch (error) {
      return { summaries: [] as AutoResearchIterationSummary[], summariesError: formatSafeError(error) };
    }
  }, [run]);

  const bestPoint = useMemo(() => getBestMetricPoint(timeline), [timeline]);
  const lastSummary = summaries.length > 0 ? summaries[summaries.length - 1] : null;
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null);

  useEffect(() => {
    setSelectedIteration(lastSummary?.iteration ?? null);
  }, [lastSummary?.iteration, run.id]);

  const selectedSummary = summaries.find((summary) => summary.iteration === selectedIteration) ?? lastSummary;
  const selectedRecord = selectedSummary && selectedSummary.iteration > 0
    ? run.iterations.find((iteration) => iteration.index === selectedSummary.iteration)
    : undefined;
  const artifacts = uniqueValues(run.iterations.flatMap((iteration) => iteration.artifactPaths ?? []));
  const displayedLiveOutput = liveOutput || run.liveOutputExcerpt || '';
  const allEventLines = useMemo(() => formatAutoResearchEventDump(run.events), [run.events]);

  const handleCopy = (text: string) => {
    void writeClipboardText(text).catch(() => undefined);
  };

  const handleDownload = () => {
    if (!displayedLiveOutput) {
      return;
    }
    downloadTextFile(buildAutoResearchLiveOutputFilename(run), displayedLiveOutput);
  };
  const baseline = typeof run.config.baseline === 'number' ? run.config.baseline : null;
  const bestValue = typeof run.bestMetricValue === 'number' ? run.bestMetricValue : bestPoint?.value ?? null;
  const bestIteration = typeof run.bestIteration === 'number' ? run.bestIteration : bestPoint?.iteration ?? null;
  const config = run.config.configSnapshot;
  const renderError = documentError ?? timelineError ?? summariesError;

  if (renderError || !document) {
    return (
      <DocumentDetailShell
        title="AutoResearch Document"
        subtitle="The report view hit a recoverable render error."
        backLabel={t('autoresearch.detail.backToDashboard')}
        onBack={onBack}
        onClose={onClose}
        headerActions={headerActions}
        className={className}
      >
        <DocumentContentCard>
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {renderError || 'Unknown error'}
          </div>
        </DocumentContentCard>
      </DocumentDetailShell>
    );
  }

  return (
    <DocumentDetailShell
      title={document.title}
      subtitle={document.subtitle}
      badge={document.badge}
      filename={document.filename}
      backLabel={t('autoresearch.detail.backToDashboard')}
      onBack={onBack}
      onOpen={onOpen}
      openLabel={t('autoresearch.detail.open')}
      onClose={onClose}
      headerActions={headerActions}
      className={className}
      sidebar={(
        <DocumentMetadataSidebar
          createdAt={document.createdAt}
          updatedAt={document.updatedAt}
          path={document.path}
          tags={document.tags}
          sections={[
            {
              label: 'Run',
              content: (
                <KeyValueList items={[
                  ['Status', run.status.replace(/_/g, ' ')],
                  ['Started', formatDateTime(run.startedAt)],
                  ['Ended', formatDateTime(run.endedAt)],
                  ['Iterations', `${run.currentIteration}/${run.config.iterations}`],
                ]} />
              ),
            },
            {
              label: 'Target',
              content: (
                <KeyValueList items={[
                  ['Experiment', run.config.experimentDir || 'N/A'],
                  ['Workdir', run.config.workdir || 'N/A'],
                ]} />
              ),
            },
            {
              label: 'Metric',
              content: (
                <KeyValueList items={[
                  ['Name', run.config.metric || 'N/A'],
                  ['Direction', run.config.direction === 'higher' ? 'higher is better' : 'lower is better'],
                  ['Baseline', formatMetricValue(baseline)],
                  ['Best', bestValue === null ? 'N/A' : `${formatMetricValue(bestValue)} @ ${bestIteration ?? 'N/A'}`],
                ]} />
              ),
            },
            {
              label: 'Config',
              content: (
                <KeyValueList items={[
                  ['Name', config.configName],
                  ['Provider', config.provider],
                  ['Model', config.model || 'N/A'],
                  ['API', config.apiFormat || 'N/A'],
                  ['Key', config.keyPresent ? config.keyPreview || 'present' : 'not configured'],
                ]} />
              ),
            },
          ]}
        />
      )}
    >
      <DocumentContentCard>
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <StatCard label="Status" value={run.status.replace(/_/g, ' ')} />
            <StatCard label="Baseline" value={formatMetricValue(baseline)} />
            <StatCard label="Best Score" value={bestValue === null ? 'N/A' : formatMetricValue(bestValue)} tone={bestValue !== null ? 'good' : 'neutral'} />
            <StatCard label="Best Iteration" value={bestIteration ?? 'N/A'} tone={bestIteration !== null ? 'good' : 'neutral'} />
          </div>

          {run.summary && (
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-900">
              {redactSensitiveText(run.summary)}
            </div>
          )}

          <AutoResearchMetricChart run={run} points={timeline} />

          <AutoResearchIterationTable
            run={run}
            summaries={summaries}
            selectedIteration={selectedSummary?.iteration ?? null}
            onSelectIteration={setSelectedIteration}
          />

          <SelectedIterationDetail summary={selectedSummary} iteration={selectedRecord} />

          {artifacts.length > 0 && (
            <section className="space-y-3">
              <SectionTitle>Artifacts</SectionTitle>
              <div className="grid gap-2 md:grid-cols-2">
                {artifacts.slice(0, 16).map((artifactPath) => (
                  <div key={artifactPath} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600" title={artifactPath}>
                    <p className="font-mono font-semibold text-gray-900">{basename(artifactPath)}</p>
                    <p className="mt-1 truncate">{artifactPath}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {run.events.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <SectionTitle>Recent Events</SectionTitle>
                <button
                  type="button"
                  onClick={() => handleCopy(allEventLines)}
                  data-copy-target="recent-events-all"
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                >
                  {t('autoresearch.recentEvents.copyAll')}
                </button>
              </div>
              <div className="space-y-2">
                {run.events.slice(-10).reverse().map((event) => {
                  const metadataBadges = getAutoResearchEventMetadataBadges(event);
                  return (
                    <div key={event.id} className="group rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-gray-900">{event.phase}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500">{event.level}</span>
                            <span className="text-gray-500">{formatDateTime(event.timestamp)}</span>
                          </div>
                          <p className="mt-1 leading-5">{redactSensitiveText(event.message)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(formatAutoResearchEventLine(event))}
                          data-copy-target="recent-event-line"
                          className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500 opacity-0 transition-opacity hover:bg-gray-50 group-hover:opacity-100"
                          aria-label={t('autoresearch.recentEvents.copyOne')}
                          title={t('autoresearch.recentEvents.copyOne')}
                        >
                          {t('autoresearch.recentEvents.copyOne')}
                        </button>
                      </div>
                      {metadataBadges.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {metadataBadges.map((badge) => (
                            <span key={`${event.id}-${badge}`} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
                              {badge}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {displayedLiveOutput && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <SectionTitle>Live Output Excerpt</SectionTitle>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(displayedLiveOutput)}
                    data-copy-target="live-output-copy"
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    {t('autoresearch.liveOutput.copy')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    data-copy-target="live-output-download"
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    {t('autoresearch.liveOutput.download')}
                  </button>
                </div>
              </div>
              <pre className="max-h-72 overflow-auto rounded-2xl border border-[#2c303a] bg-[#111827] p-4 text-xs leading-5 text-green-300 whitespace-pre-wrap">
                {redactSensitiveText(displayedLiveOutput)}
              </pre>
            </section>
          )}

          <section className="space-y-3">
            <SectionTitle>Generated Run Report</SectionTitle>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <MarkdownDocumentPreview body={document.markdown} />
            </div>
          </section>
        </div>
      </DocumentContentCard>
    </DocumentDetailShell>
  );
}

export default AutoResearchDocumentReport;
