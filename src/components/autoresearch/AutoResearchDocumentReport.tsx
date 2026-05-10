import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { t } from '@/i18n';
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
      : 'border-[#ebe4d9] bg-[#fbfaf7] text-[#2f251a]';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClassName}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-65">{label}</p>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8f8375]">
      {children}
    </h4>
  );
}

function KeyValueList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <div className="space-y-2 text-[12px] leading-5">
      {items.map(([label, value]) => (
        <div key={label}>
          <p className="font-bold uppercase tracking-[0.14em] text-[#998c7e]">{label}</p>
          <div className="mt-0.5 break-words text-[#4f463d]">{value ?? 'N/A'}</div>
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
    <div className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionTitle>{summary.iteration === 0 ? 'Baseline Detail' : `Iteration ${summary.iteration}`}</SectionTitle>
          <p className="mt-1 font-mono text-sm text-[#2f251a]">
            {summary.metricName}={formatMetricValue(summary.metricValue)} · {summary.impactLabel}
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#6f665c] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
          {summary.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#998c7e]">Change</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#4f463d]">{redactSensitiveText(iteration?.change || summary.changeSummary)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#998c7e]">Hypothesis</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#4f463d]">{redactSensitiveText(iteration?.hypothesis || summary.hypothesis || 'N/A')}</p>
        </div>
      </div>

      {iteration?.reasoning && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#998c7e]">Reasoning</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#4f463d]">{redactSensitiveText(iteration.reasoning)}</p>
        </div>
      )}

      {summary.error && (
        <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          {redactSensitiveText(summary.error)}
        </div>
      )}

      {summary.artifactPaths && summary.artifactPaths.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#998c7e]">Artifacts</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {summary.artifactPaths.slice(0, 8).map((artifactPath) => (
              <div key={artifactPath} className="rounded-xl bg-white px-3 py-2 text-[11px] text-[#6f665c] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]" title={artifactPath}>
                <span className="font-mono">{basename(artifactPath)}</span>
                <p className="mt-1 truncate text-[#998c7e]">{artifactPath}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] text-[#8a7f72]">
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
                  <div key={artifactPath} className="rounded-xl border border-[#ebe4d9] bg-[#fbfaf7] px-3 py-2 text-xs text-[#6f665c]" title={artifactPath}>
                    <p className="font-mono font-semibold text-[#2f251a]">{basename(artifactPath)}</p>
                    <p className="mt-1 truncate">{artifactPath}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {run.events.length > 0 && (
            <section className="space-y-3">
              <SectionTitle>Recent Events</SectionTitle>
              <div className="space-y-2">
                {run.events.slice(-10).reverse().map((event) => (
                  <div key={event.id} className="rounded-xl border border-[#ebe4d9] bg-[#fbfaf7] px-3 py-2 text-xs text-[#6f665c]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[#2f251a]">{event.phase}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase text-[#8a7f72]">{event.level}</span>
                      <span className="text-[#998c7e]">{formatDateTime(event.timestamp)}</span>
                    </div>
                    <p className="mt-1 leading-5">{redactSensitiveText(event.message)}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {displayedLiveOutput && (
            <section className="space-y-3">
              <SectionTitle>Live Output Excerpt</SectionTitle>
              <pre className="max-h-72 overflow-auto rounded-2xl border border-[#2c303a] bg-[#111827] p-4 text-xs leading-5 text-green-300 whitespace-pre-wrap">
                {redactSensitiveText(displayedLiveOutput)}
              </pre>
            </section>
          )}

          <section className="space-y-3">
            <SectionTitle>Generated Run Report</SectionTitle>
            <div className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
              <MarkdownDocumentPreview body={document.markdown} />
            </div>
          </section>
        </div>
      </DocumentContentCard>
    </DocumentDetailShell>
  );
}

export default AutoResearchDocumentReport;
