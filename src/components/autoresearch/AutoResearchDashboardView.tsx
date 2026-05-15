import { useMemo, useState, type ReactNode } from 'react';
import { t } from '@/i18n';
import {
  buildAutoResearchLiveOutputFilename,
  formatAutoResearchEventDump,
  formatAutoResearchEventLine,
} from '@/services/autoresearch/eventPresentation';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { isDemoRun } from '@/services/autoresearch/demoRun';
import { buildAutoResearchModelDisplayFromSnapshot } from '@/services/autoresearch/modelDisplay';
import { AutoResearchRunChips } from './AutoResearchRunChips';
import { AutoResearchDashboardMetricCard } from './AutoResearchDashboardMetricCard';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';
import { buildAutoResearchRecoverySummary } from '@/services/autoresearch/recoverySummary';
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
  type AutoResearchEvent,
  type AutoResearchTimelineFilter,
} from '@/services/autoresearch/structuredEvents';

type DetailTab = 'summary' | 'timeline' | 'debug';

const TIMELINE_FILTERS: Array<{ id: AutoResearchTimelineFilter; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'all', label: 'All' },
  { id: 'tool_calls', label: 'Tool calls' },
  { id: 'errors', label: 'Errors' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'raw', label: 'Raw' },
];

interface AutoResearchDashboardViewProps {
  run: AutoResearchRunRecord;
  liveOutput?: string;
  onBack?: () => void;
  onClose?: () => void;
  onOpen?: () => void;
  onOpenFullReport?: () => void;
  headerActions?: ReactNode;
  className?: string;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function formatDate(value?: string | null): string | null {
  if (!value) {
    return null;
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

function shortenRunId(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function formatPhaseLabel(value?: string | null): string {
  if (!value) {
    return 'Unknown';
  }
  return value === 'reflection_parse_failed'
    ? t('autoresearch.reflectionParseFailed')
    : value.replace(/_/g, ' ');
}

function formatMetricValue(value: number | string | boolean | null | undefined): string {
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (value === null || value === undefined) {
    return 'N/A';
  }
  return String(value);
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function previewLines(value: string, count = 10): string {
  return value
    .split('\n')
    .slice(0, count)
    .join('\n')
    .trim();
}

function getPhaseToneClasses(phase?: string | null): string {
  if (phase === 'FAILED') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (phase === 'DONE') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function getStatusToneClasses(status: string): string {
  if (status === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (status === 'completed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'running') {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  return 'border-[#ded3c5] bg-[#f5efe6] text-[#6f665c]';
}

function getRecoveryToneClasses(tone: 'info' | 'warn' | 'error'): string {
  if (tone === 'error') {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  if (tone === 'warn') {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  return 'border-blue-200 bg-blue-50 text-blue-900';
}

function SectionHeading({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8f8375]">{children}</h4>
      {subtitle && <p className="mt-1 text-sm text-[#655a4f]">{subtitle}</p>}
    </div>
  );
}

function getRunTitle(run: AutoResearchRunRecord): string {
  const candidateRecord = run as AutoResearchRunRecord & {
    task?: unknown;
    config?: AutoResearchRunRecord['config'] & { title?: unknown };
  };

  return safeString(run.title)
    ?? safeString(candidateRecord.task)
    ?? safeString(candidateRecord.config?.title)
    ?? 'Auto Research Run';
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

function OverviewStatCard({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'error' }) {
  const toneClasses = tone === 'good'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-900'
        : 'border-[#ebe4d9] bg-[#fbfaf7] text-[#2f251a]';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClasses}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active
          ? 'bg-[#2f251a] text-white'
          : 'bg-white text-[#6f665c] hover:bg-[#f5efe6]'
      }`}
    >
      {children}
    </button>
  );
}

function TimelineFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'border-[#2f251a] bg-[#2f251a] text-white'
          : 'border-[#ded3c5] bg-white text-[#6f665c] hover:border-[#cbbca7] hover:text-[#2f251a]'
      }`}
    >
      {label}
    </button>
  );
}

function RawDetails({
  title,
  value,
  kind,
}: {
  title: string;
  value: string;
  kind: 'thinking' | 'tool-result';
}) {
  return (
    <details data-event-kind={kind} className="rounded-xl border border-[#e8ded2] bg-white/80 p-3">
      <summary className="cursor-pointer list-none text-[12px] font-medium text-[#5c5247]">
        {title}
      </summary>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-xl bg-[#f7f3ec] p-3 text-[11px] leading-5 text-[#3d352d]">
        {value}
      </pre>
    </details>
  );
}

function EventMetadataChips({ event }: { event: AutoResearchEvent }) {
  const metadata = event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail)
    ? Object.entries(event.detail as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        .slice(0, 4)
    : [];

  if (metadata.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {metadata.map(([key, value]) => (
        <span key={`${event.id}-${key}`} className="rounded-full bg-[#f1eadf] px-2 py-0.5 text-[10px] text-[#7c7064]">
          {key}={String(value)}
        </span>
      ))}
    </div>
  );
}

function TimelineEventCard({
  event,
  onCopy,
  fallbackProvider,
  fallbackModel,
}: {
  event: AutoResearchEvent;
  onCopy: (text: string) => void;
  fallbackProvider: string;
  fallbackModel: string;
}) {
  const levelTone = event.level === 'error'
    ? 'border-red-200 bg-red-50/90'
    : event.level === 'warning'
      ? 'border-amber-200 bg-amber-50/90'
      : event.kind === 'metrics'
        ? 'border-emerald-200 bg-emerald-50/90'
        : 'border-[#ebe4d9] bg-white';
  const detailText = typeof event.detail === 'string'
    ? event.detail
    : event.rawMessage;
  const metadata = event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail)
    ? event.detail as Record<string, unknown>
    : {};
  const provider = typeof metadata.provider === 'string' ? metadata.provider : fallbackProvider;
  const model = typeof metadata.model === 'string' ? metadata.model : fallbackModel;

  return (
    <article data-event-kind={event.kind === 'provider_error' ? 'provider-error' : event.kind} className={`rounded-2xl border px-4 py-4 shadow-[0_6px_16px_rgba(15,23,42,0.04)] ${levelTone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[#8f8375]">
            <span>{formatPhaseLabel(event.phase ?? event.rawPhase)}</span>
            <span>{event.timestamp}</span>
            {event.iteration !== null && <span>Iteration {event.iteration}</span>}
            {event.toolName && <span>{event.toolName}</span>}
          </div>
          {event.kind === 'provider_error' ? (
            <div className="mt-2 space-y-1 text-sm text-red-800">
              <p className="font-semibold">{event.summary}</p>
              <p>Provider: {provider} · Model: {model}</p>
            </div>
          ) : event.kind === 'metrics' ? (
            <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
              <p className="font-semibold">{event.summary}</p>
              {EventMetadataChips({ event })}
            </div>
          ) : event.kind === 'reflection' ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p className="font-semibold">Reflection</p>
              <p className="mt-1">{event.summary}</p>
            </div>
          ) : event.kind === 'plan' ? (
            <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-900">
              <p className="font-semibold">Agent plan</p>
              <p className="mt-1 whitespace-pre-wrap">{event.summary}</p>
            </div>
          ) : event.kind === 'file_change' ? (
            <div className="mt-2 rounded-xl border border-[#ded3c5] bg-[#f8f4ed] px-3 py-3 text-sm text-[#2f251a]">
              <p className="font-semibold">File change</p>
              <p className="mt-1">{event.summary}</p>
            </div>
          ) : event.kind === 'thinking' ? (
            <div className="mt-2">
              <RawDetails title="Thinking" value={detailText} kind="thinking" />
            </div>
          ) : event.kind === 'tool_result' ? (
            <div className="mt-2 rounded-xl border border-[#ded3c5] bg-[#f8f4ed] px-3 py-3 text-sm text-[#2f251a]">
              <p className="font-semibold">Tool result</p>
              <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[#5c5247]">{previewLines(detailText, 10)}</pre>
              <div className="mt-2">
                <RawDetails title="Expand full output" value={detailText} kind="tool-result" />
              </div>
            </div>
          ) : event.kind === 'tool_call' ? (
            <div className="mt-2 rounded-xl border border-[#ded3c5] bg-[#f8f4ed] px-3 py-3 text-sm text-[#2f251a]">
              <p className="font-semibold">Tool call</p>
              <p className="mt-1">{event.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#6f665c]">
                {event.toolName && <span>tool={event.toolName}</span>}
                {typeof event.durationMs === 'number' && <span>duration={formatDurationMs(event.durationMs)}</span>}
                {event.status && <span>status={event.status}</span>}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-[#5c5247]">{event.summary}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onCopy(`[${event.timestamp}] [${event.phase ?? event.rawPhase}] ${event.rawMessage}`)}
          data-copy-target="recent-event-line"
          className="rounded-full border border-[#ded3c5] bg-white px-2 py-0.5 text-[10px] font-medium text-[#7c7064] hover:text-[#2f251a]"
        >
          {t('autoresearch.recentEvents.copyOne')}
        </button>
      </div>
      {event.kind !== 'metrics' && <EventMetadataChips event={event} />}
    </article>
  );
}

function PhaseStepPill({ phase, state }: { phase: string; state: 'completed' | 'current' | 'pending' | 'failed' }) {
  const tone = state === 'completed'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : state === 'current'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : state === 'failed'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-[#ded3c5] bg-[#f8f4ed] text-[#8f8375]';

  return <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${tone}`}>{phase}</span>;
}

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

  const handleCopy = (text: string) => {
    void writeClipboardText(text).catch(() => undefined);
  };

  const handleDownload = () => {
    if (!displayedLiveOutput) {
      return;
    }
    downloadTextFile(buildAutoResearchLiveOutputFilename(run), displayedLiveOutput);
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
        <>
          {onOpenFullReport && (
            <button
              type="button"
              onClick={onOpenFullReport}
              className="rounded-xl border border-[#e7ded1] bg-white/90 px-3 py-2 text-[12px] font-medium text-[#6f665c] transition-colors hover:border-[#d8cfc1] hover:text-[#2f251a]"
            >
              {t('autoresearch.detail.fullReport')}
            </button>
          )}
        </>
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
            <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-900">
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
                      onClick={() => setActiveTab('debug')}
                      className="rounded-full border border-current/20 bg-white/70 px-3 py-1 text-[11px] font-medium transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {action.label || action.type}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
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
              <section className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
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
                </div>
              </section>

              <div>
                <SectionHeading subtitle="High-level run chips remain available, but they are no longer the primary source of detail.">Run Snapshot</SectionHeading>
                <AutoResearchRunChips run={run} className="mt-3" />
              </div>

              {run.summary && !recoverySummary && (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-900">
                  {redactSensitiveText(run.summary)}
                </div>
              )}

              <AutoResearchDashboardMetricCard run={run} />

              <section className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
                <SectionHeading subtitle="Each iteration shows the hypothesis, changes, execution result, metrics, artifacts, reflection, and recovery actions.">
                  Iterations
                </SectionHeading>
                {iterationCards.length === 0 ? (
                  <p className="mt-4 text-sm text-[#8f8375]">No iterations recorded yet.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {iterationCards.map((iteration) => (
                      <article key={iteration.id} className="rounded-2xl border border-[#e7ded1] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[#8f8375]">
                              <span>Iteration {iteration.iteration}</span>
                              <span className={`rounded-full border px-2 py-0.5 ${getStatusToneClasses(iteration.status)}`}>{iteration.status}</span>
                              <span className={`rounded-full border px-2 py-0.5 ${getPhaseToneClasses(iteration.phase)}`}>{iteration.phase}</span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-[#2f251a]">{iteration.narrative}</p>
                          </div>
                          <div className="text-right text-[12px] text-[#6f665c]">
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
                          <div className="space-y-3 text-sm text-[#4f463d]">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#998c7e]">Hypothesis</p>
                              <p className="mt-1">{iteration.hypothesis || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#998c7e]">Code changes</p>
                              <p className="mt-1">{iteration.codeChangesSummary || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#998c7e]">Execution command</p>
                              <p className="mt-1 font-mono text-[12px] break-all">{iteration.executionCommand || 'Not recorded'}</p>
                            </div>
                          </div>

                          <div className="space-y-3 text-sm text-[#4f463d]">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#998c7e]">Parsed metrics</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {Object.entries(iteration.parsedMetrics).map(([key, value]) => (
                                  <span key={`${iteration.id}-${key}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-800">
                                    {key}={formatMetricValue(value)}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#998c7e]">Reflection</p>
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
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#998c7e]">Artifacts</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {iteration.artifacts.length > 0 ? iteration.artifacts.map((artifact) => (
                                <span key={artifact} className="rounded-full border border-[#ded3c5] bg-[#f8f4ed] px-2.5 py-1 text-[11px] text-[#6f665c]">
                                  {basename(artifact)}
                                </span>
                              )) : <span className="text-sm text-[#8f8375]">No artifacts recorded.</span>}
                            </div>
                          </div>

                          {iteration.recoveryActions.length > 0 && (
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#998c7e]">Recovery actions</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {iteration.recoveryActions.map((action) => (
                                  <button
                                    key={`${iteration.id}-${action.type}`}
                                    type="button"
                                    onClick={() => setActiveTab('debug')}
                                    className="rounded-full border border-[#ded3c5] bg-white px-3 py-1 text-[11px] font-medium text-[#6f665c] hover:border-[#cbbca7] hover:text-[#2f251a]"
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
            <section className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionHeading subtitle="Filter the execution timeline by summary signals, tools, errors, metrics, or raw events.">Timeline</SectionHeading>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(allEventLines)}
                    data-copy-target="recent-events-all"
                    className="rounded-full border border-[#e3d8cb] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b5f52] transition-colors hover:border-[#d4c7b8] hover:text-[#2f251a]"
                  >
                    {t('autoresearch.recentEvents.copyAll')}
                  </button>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[#998c7e]">{filteredEvents.length}</span>
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
                <p className="mt-6 text-sm text-[#8f8375]">No events match the current filter.</p>
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
            <section className="rounded-2xl border border-[#ebe4d9] bg-[#fbfaf7] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SectionHeading subtitle="Raw terminal output and unfiltered event dump remain available for recovery and deep debugging.">Debug</SectionHeading>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(displayedLiveOutput)}
                    data-copy-target="live-output-copy"
                    className="rounded-full border border-[#e3d8cb] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b5f52] transition-colors hover:border-[#d4c7b8] hover:text-[#2f251a]"
                  >
                    {t('autoresearch.liveOutput.copy')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    data-copy-target="live-output-download"
                    className="rounded-full border border-[#e3d8cb] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b5f52] transition-colors hover:border-[#d4c7b8] hover:text-[#2f251a]"
                  >
                    {t('autoresearch.liveOutput.download')}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f8375]">Raw Events</p>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-2xl border border-[#ebe4d9] bg-white p-4 text-xs leading-5 text-[#2f251a] whitespace-pre-wrap shadow-[inset_0_0_0_1px_rgba(241,237,230,0.9)]">
                    {allEventLines || 'No events recorded.'}
                  </pre>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f8375]">Raw Conversation</p>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-2xl border border-[#ebe4d9] bg-white p-4 text-xs leading-5 text-[#2f251a] whitespace-pre-wrap shadow-[inset_0_0_0_1px_rgba(241,237,230,0.9)]">
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
