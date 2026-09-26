import { type ReactNode } from 'react';
import { t } from '@/i18n';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import {
  formatDurationMs,
  type AutoResearchEvent,
  type AutoResearchTimelineFilter,
} from '@/services/autoresearch/structuredEvents';

export type DetailTab = 'summary' | 'timeline' | 'debug';

export const TIMELINE_FILTERS: Array<{ id: AutoResearchTimelineFilter; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'all', label: 'All' },
  { id: 'tool_calls', label: 'Tool calls' },
  { id: 'errors', label: 'Errors' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'raw', label: 'Raw' },
];

export interface AutoResearchDashboardViewProps {
  run: AutoResearchRunRecord;
  liveOutput?: string;
  onBack?: () => void;
  onClose?: () => void;
  onOpen?: () => void;
  onOpenFullReport?: () => void;
  headerActions?: ReactNode;
  className?: string;
}

export function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function formatDate(value?: string | null): string | null {
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

export function shortenRunId(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

export function formatPhaseLabel(value?: string | null): string {
  if (!value) {
    return 'Unknown';
  }
  return value === 'reflection_parse_failed'
    ? t('autoresearch.reflectionParseFailed')
    : value.replace(/_/g, ' ');
}

export function formatMetricValue(value: number | string | boolean | null | undefined): string {
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

export function formatGpuTemperature(value: number | null | undefined): string {
  return typeof value === 'number' ? `${formatMetricValue(value)}C` : 'N/A';
}

export function formatRepoStatusLabel(run: AutoResearchRunRecord): string {
  if (!run.config.repoStatus) {
    return 'N/A';
  }
  const dirtyFileCount = typeof run.config.dirtyFileCount === 'number'
    ? run.config.dirtyFileCount
    : null;
  return dirtyFileCount === null
    ? run.config.repoStatus
    : `${run.config.repoStatus} (${dirtyFileCount} dirty)`;
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function previewLines(value: string, count = 10): string {
  return value
    .split('\n')
    .slice(0, count)
    .join('\n')
    .trim();
}

export function getPhaseToneClasses(phase?: string | null): string {
  if (phase === 'FAILED') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (phase === 'DONE') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return 'border-[#e9e7e2] bg-[#faf9f6] text-[#6f6e69]';
}

export function getStatusToneClasses(status: string): string {
  if (status === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (status === 'completed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'running') {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  return 'border-gray-200 bg-gray-100 text-gray-600';
}

export function getRecoveryToneClasses(tone: 'info' | 'warn' | 'error'): string {
  if (tone === 'error') {
    return 'border-red-200 bg-red-50 text-red-800';
  }
  if (tone === 'warn') {
    return 'border-[#ece9e2] bg-[#faf9f6] text-[#5f5a52]';
  }
  return 'border-[#e3e2de] bg-[#f7f6f3] text-[#37352f]';
}

export function SectionHeading({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">{children}</h4>
      {subtitle && <p className="mt-1 text-sm text-gray-700">{subtitle}</p>}
    </div>
  );
}

export function getRunTitle(run: AutoResearchRunRecord): string {
  const candidateRecord = run as AutoResearchRunRecord & {
    task?: unknown;
    config?: AutoResearchRunRecord['config'] & { title?: unknown };
  };

  return safeString(run.title)
    ?? safeString(candidateRecord.task)
    ?? safeString(candidateRecord.config?.title)
    ?? 'Auto Research Run';
}

export function KeyValueList({ items }: { items: Array<[string, ReactNode]> }) {
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

export function OverviewStatCard({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'error' }) {
  const toneClasses = tone === 'good'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : tone === 'warn'
      ? 'border-[#ece9e2] bg-[#faf9f6] text-[#5f5a52]'
      : tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-900'
        : 'border-[#e9e7e2] bg-white text-[#37352f]';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClasses}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </div>
  );
}

export function DebugCopyButton({
  label,
  onClick,
  dataCopyTarget,
}: {
  label: string;
  onClick: () => void;
  dataCopyTarget: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-copy-target={dataCopyTarget}
      className="rounded-full border border-[#e7e5e1] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6f6e69] transition-colors hover:border-[#ded9d1] hover:text-[#37352f]"
    >
      {label}
    </button>
  );
}

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active
          ? 'bg-gray-900 text-white'
          : 'bg-white text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

export function TimelineFilterButton({
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
          ? 'border-gray-900 bg-gray-900 text-white'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
      }`}
    >
      {label}
    </button>
  );
}

export function RawDetails({
  title,
  value,
  kind,
}: {
  title: string;
  value: string;
  kind: 'thinking' | 'tool-result';
}) {
  return (
    <details data-event-kind={kind} className="rounded-xl border border-gray-200 bg-white/80 p-3">
      <summary className="cursor-pointer list-none text-[12px] font-medium text-gray-700">
        {title}
      </summary>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-[11px] leading-5 text-gray-800">
        {value}
      </pre>
    </details>
  );
}

export function EventMetadataChips({ event }: { event: AutoResearchEvent }) {
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
        <span key={`${event.id}-${key}`} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
          {key}={String(value)}
        </span>
      ))}
    </div>
  );
}

export function TimelineEventCard({
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
      ? 'border-[#ece9e2] bg-[#faf9f6]'
      : event.kind === 'metrics'
        ? 'border-emerald-200 bg-emerald-50/90'
        : 'border-[#e9e7e2] bg-white';
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
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-gray-500">
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
            <div className="mt-2 rounded-xl border border-[#e9e7e2] bg-[#faf9f6] px-3 py-3 text-sm text-[#37352f]">
              <p className="font-semibold">Reflection</p>
              <p className="mt-1">{event.summary}</p>
            </div>
          ) : event.kind === 'plan' ? (
            <div className="mt-2 rounded-xl border border-[#e3e2de] bg-[#f7f6f3] px-3 py-3 text-sm text-[#37352f]">
              <p className="font-semibold">Agent plan</p>
              <p className="mt-1 whitespace-pre-wrap">{event.summary}</p>
            </div>
          ) : event.kind === 'file_change' ? (
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-900">
              <p className="font-semibold">File change</p>
              <p className="mt-1">{event.summary}</p>
            </div>
          ) : event.kind === 'thinking' ? (
            <div className="mt-2">
              <RawDetails title="Thinking" value={detailText} kind="thinking" />
            </div>
          ) : event.kind === 'tool_result' ? (
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-900">
              <p className="font-semibold">Tool result</p>
              <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-gray-700">{previewLines(detailText, 10)}</pre>
              <div className="mt-2">
                <RawDetails title="Expand full output" value={detailText} kind="tool-result" />
              </div>
            </div>
          ) : event.kind === 'tool_call' ? (
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-900">
              <p className="font-semibold">Tool call</p>
              <p className="mt-1">{event.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-600">
                {event.toolName && <span>tool={event.toolName}</span>}
                {typeof event.durationMs === 'number' && <span>duration={formatDurationMs(event.durationMs)}</span>}
                {event.status && <span>status={event.status}</span>}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-gray-700">{event.summary}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onCopy(`[${event.timestamp}] [${event.phase ?? event.rawPhase}] ${event.rawMessage}`)}
          data-copy-target="recent-event-line"
          className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:text-gray-900"
        >
          {t('autoresearch.recentEvents.copyOne')}
        </button>
      </div>
      {event.kind !== 'metrics' && <EventMetadataChips event={event} />}
    </article>
  );
}

export function PhaseStepPill({ phase, state }: { phase: string; state: 'completed' | 'current' | 'pending' | 'failed' }) {
  const tone = state === 'completed'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : state === 'current'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : state === 'failed'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-gray-200 bg-gray-50 text-gray-500';

  return <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${tone}`}>{phase}</span>;
}
