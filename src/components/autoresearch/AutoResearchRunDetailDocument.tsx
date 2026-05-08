import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AutoResearchIterationRecord, AutoResearchRunRecord } from '@/services/autoresearch/history';
import { createAutoResearchDemoRun } from '@/services/autoresearch/demoRun';
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
import { AutoResearchDashboardView } from './AutoResearchDashboardView';
import { AutoResearchMetricChart } from './AutoResearchMetricChart';
import { AutoResearchIterationTable } from './AutoResearchIterationTable';

export type DetailViewMode = 'dashboard' | 'document';

interface AutoResearchRunDetailDocumentProps {
  run?: AutoResearchRunRecord | null;
  liveOutput?: string;
  onBack?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  headerActions?: ReactNode;
  className?: string;
  defaultViewMode?: DetailViewMode;
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

function SelectedIterationDetail({ summary, iteration }: { summary: AutoResearchIterationSummary | null; iteration?: AutoResearchIterationRecord }) {
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

function composeHeaderActions(toggleLabel: string, onToggle: () => void, headerActions?: ReactNode): ReactNode {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="rounded-xl border border-[#e7ded1] bg-white/90 px-3 py-2 text-[12px] font-medium text-[#6f665c] transition-colors hover:border-[#d8cfc1] hover:text-[#2f251a]"
      >
        {toggleLabel}
      </button>
      {headerActions}
    </>
  );
}

function EmptyDocumentState({
  onBack,
  onClose,
  headerActions,
  onSwitchToDashboard,
  className,
}: {
  onBack?: () => void;
  onClose?: () => void;
  headerActions?: ReactNode;
  onSwitchToDashboard: () => void;
  className?: string;
}) {
  return (
    <DocumentDetailShell
      title="No AutoResearch run selected"
      subtitle="Document mode only renders real run data. Switch to dashboard view to preview the demo benchmark layout."
      backLabel="Back to Runs"
      onBack={onBack}
      onClose={onClose}
      headerActions={composeHeaderActions('Dashboard view', onSwitchToDashboard, headerActions)}
      className={className}
    >
      <DocumentContentCard>
        <div className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] px-4 py-6 text-sm text-[#6f665c]">
          No run is available for the report-style detail view yet.
        </div>
      </DocumentContentCard>
    </DocumentDetailShell>
  );
}

function AutoResearchDocumentView({
  run,
  liveOutput,
  onBack,
  onOpen,
  onClose,
  headerActions,
  className = '',
  onSwitchToDashboard,
}: {
  run: AutoResearchRunRecord;
  liveOutput?: string;
  onBack?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  headerActions?: ReactNode;
  className?: string;
  onSwitchToDashboard: () => void;
}) {
  const document = useMemo(() => buildAutoResearchRunDocument(run), [run]);
  const timeline = useMemo(() => buildMetricTimeline(run), [run]);
  const summaries = useMemo(() => buildIterationSummaries(run), [run]);
  const bestPoint = useMemo(() => getBestMetricPoint(timeline), [timeline]);
  const lastSummary = summaries.length > 0 ? summaries[summaries.length - 1] : null;
  const initialSelectedIteration = lastSummary?.iteration ?? null;
  const [selectedIteration, setSelectedIteration] = useState<number | null>(initialSelectedIteration);

  useEffect(() => {
    setSelectedIteration(initialSelectedIteration);
  }, [initialSelectedIteration, run.id]);

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

  return (
    <DocumentDetailShell
      title={document.title}
      subtitle={document.subtitle}
      badge={document.badge}
      filename={document.filename}
      backLabel="Back to Runs"
      onBack={onBack}
      onOpen={onOpen}
      onClose={onClose}
      headerActions={composeHeaderActions('Dashboard view', onSwitchToDashboard, headerActions)}
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

export function AutoResearchRunDetailDocument({
  run,
  liveOutput,
  onBack,
  onOpen,
  onClose,
  headerActions,
  className = '',
  defaultViewMode,
}: AutoResearchRunDetailDocumentProps) {
  const effectiveRun = useMemo(() => run ?? createAutoResearchDemoRun(), [run]);
  const resolvedDefaultViewMode = defaultViewMode ?? 'dashboard';
  const [viewMode, setViewMode] = useState<DetailViewMode>(resolvedDefaultViewMode);

  useEffect(() => {
    setViewMode(resolvedDefaultViewMode);
  }, [resolvedDefaultViewMode, run?.id]);

  if (viewMode === 'dashboard') {
    try {
      return (
        <AutoResearchDashboardView
          run={effectiveRun}
          onBack={onBack}
          onClose={onClose}
          onOpen={run ? onOpen : undefined}
          onSwitchToDocument={() => setViewMode('document')}
          headerActions={headerActions}
          className={className}
        />
      );
    } catch (error) {
      return (
        <DocumentDetailShell
          title="AutoResearch Dashboard"
          subtitle="The dashboard view hit a recoverable render error."
          backLabel="Back to Runs"
          onBack={onBack}
          onClose={onClose}
          headerActions={composeHeaderActions('Document view', () => setViewMode('document'), headerActions)}
          className={className}
        >
          <DocumentContentCard>
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formatSafeError(error)}
            </div>
          </DocumentContentCard>
        </DocumentDetailShell>
      );
    }
  }

  if (!run) {
    return (
      <EmptyDocumentState
        onBack={onBack}
        onClose={onClose}
        headerActions={headerActions}
        onSwitchToDashboard={() => setViewMode('dashboard')}
        className={className}
      />
    );
  }

  try {
    return (
      <AutoResearchDocumentView
        run={run}
        liveOutput={liveOutput}
        onBack={onBack}
        onOpen={onOpen}
        onClose={onClose}
        headerActions={headerActions}
        className={className}
        onSwitchToDashboard={() => setViewMode('dashboard')}
      />
    );
  } catch (error) {
    return (
      <DocumentDetailShell
        title="AutoResearch Document"
        subtitle="The report view hit a recoverable render error."
        backLabel="Back to Runs"
        onBack={onBack}
        onClose={onClose}
        headerActions={composeHeaderActions('Dashboard view', () => setViewMode('dashboard'), headerActions)}
        className={className}
      >
        <DocumentContentCard>
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formatSafeError(error)}
          </div>
        </DocumentContentCard>
      </DocumentDetailShell>
    );
  }
}

export default AutoResearchRunDetailDocument;