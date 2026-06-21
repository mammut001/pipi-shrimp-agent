import { t } from '@/i18n';
import type { AutoResearchRunPhase, AutoResearchRunRecord, AutoResearchRunStatus } from '@/services/autoresearch/history';
import type { AutoResearchConnectionTestStatus } from '@/services/autoresearch/setupFlow';
import { buildAutoResearchModelDisplayFromSnapshot } from '@/services/autoresearch/modelDisplay';

function formatMetricValue(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'N/A';
  }
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return 'N/A';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRunStatusLabel(status: AutoResearchRunStatus): string {
  return status === 'reflection_failed'
    ? t('autoresearch.statusReflectionFailed')
    : status.replace(/_/g, ' ');
}

function formatPhaseLabel(phase?: AutoResearchRunPhase): string {
  return phase ? phase.replace(/_/g, ' ') : 'N/A';
}

function formatTargetSummary(user?: string, host?: string): string {
  return `SSH ${user || '...'}@${host || '...'}`;
}

function formatMetricSummary(metric: string, direction: 'lower' | 'higher'): string {
  return `${metric || '—'} (${direction === 'lower'
    ? t('autoresearch.summaryDirectionMinimize')
    : t('autoresearch.summaryDirectionMaximize')})`;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function getStatusClasses(status: AutoResearchRunStatus): string {
  switch (status) {
    case 'failed':
    case 'reflection_failed':
      return 'bg-rose-50 text-rose-700 border border-rose-200';
    case 'completed':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    case 'waiting_rate_limit':
      return 'bg-amber-50 text-amber-700 border border-amber-200';
    case 'stopped':
    case 'interrupted':
      return 'bg-slate-100 text-slate-700 border border-slate-200';
    case 'running':
      return 'bg-teal-50 text-teal-700 border border-teal-200';
    default:
      return 'bg-gray-100 text-gray-700 border border-gray-200';
  }
}

export function AutoResearchPathSummary({
  label,
  path,
}: {
  label: string;
  path: string;
}) {
  if (!path.trim()) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50/80 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-gray-900">{basename(path)}</div>
      <div className="mt-1 break-all font-mono text-[11px] text-gray-500">{path}</div>
    </div>
  );
}

export function AutoResearchTargetSummary({
  mode,
  user,
  host,
}: {
  mode: 'local' | 'ssh';
  user?: string;
  host?: string;
}) {
  return mode === 'local' ? t('autoresearch.mode.local') : formatTargetSummary(user, host);
}

export function AutoResearchMetricSummary({
  metric,
  direction,
}: {
  metric: string;
  direction: 'lower' | 'higher';
}) {
  return formatMetricSummary(metric, direction);
}

export function AutoResearchActiveRunBanner({
  run,
  onView,
  onBrowseHistory,
}: {
  run: AutoResearchRunRecord;
  onView: () => void;
  onBrowseHistory?: () => void;
}) {
  return (
    <div className="rounded-3xl border border-teal-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.95),rgba(236,253,245,0.9))] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-teal-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700">
              {t('autoresearch.activeRun')}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${getStatusClasses(run.status)}`}>
              {formatRunStatusLabel(run.status)}
            </span>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">{run.title}</div>
            <div className="mt-1 text-xs text-gray-600">
              {t('autoresearch.labelIteration')} {run.currentIteration}/{run.config.iterations} · {t('autoresearch.labelPhase')} {formatPhaseLabel(run.currentPhase)} · {t('autoresearch.labelUpdated')} {formatTimestamp(run.updatedAt)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl bg-neutral-900 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800"
            onClick={onView}
          >
            {t('autoresearch.viewActiveRun')}
          </button>
          {onBrowseHistory && (
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              onClick={onBrowseHistory}
            >
              {t('autoresearch.browseHistory')}
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <AutoResearchPathSummary label={t('autoresearch.summaryExperimentDir')} path={run.config.experimentDir} />
        <AutoResearchPathSummary label={t('autoresearch.summaryWorkdir')} path={run.config.workdir} />
      </div>
    </div>
  );
}

export function AutoResearchRunHistoryCard({
  run,
  isSelected,
  isActive,
  isSelectMode = false,
  isChecked = false,
  onClick,
  onToggleSelect,
  onDelete,
}: {
  run: AutoResearchRunRecord;
  isSelected: boolean;
  isActive: boolean;
  isSelectMode?: boolean;
  isChecked?: boolean;
  onClick: () => void;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onDelete?: (e: React.MouseEvent) => void;
}) {
  const modelLabel = buildAutoResearchModelDisplayFromSnapshot(run.config.configSnapshot).compactLabel;
  const bestMetric = formatMetricValue(run.bestMetricValue);

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectMode) {
      onToggleSelect?.(e);
    } else {
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (isSelectMode) {
            onToggleSelect?.(e as any);
          } else {
            onClick();
          }
        }
      }}
      className={`relative group rounded-3xl border p-4 text-left shadow-sm transition-all cursor-pointer select-none outline-none ${
        isChecked
          ? 'border-neutral-900 bg-neutral-50/50 ring-2 ring-neutral-100'
          : isSelected
          ? 'border-neutral-400 bg-white ring-2 ring-neutral-100'
          : 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md'
      }`}
    >
      {/* Checkbox overlay */}
      {(isSelectMode || onToggleSelect) && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(e);
          }}
          className={`absolute -top-2 -left-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-all ${
            isChecked
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-gray-300 bg-white hover:border-gray-400 text-transparent'
          } ${
            isSelectMode ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      {/* Hover delete button */}
      {!isSelectMode && onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(e);
          }}
          className="absolute -top-2 -right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition-all hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100"
          title={t('common.delete')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${getStatusClasses(run.status)}`}>
            {formatRunStatusLabel(run.status)}
          </span>
          {isActive && (
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-700">
              {t('autoresearch.badgeActive')}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-gray-500">{run.currentIteration}/{run.config.iterations}</span>
      </div>

      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-gray-900">{run.title}</h3>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">{t('autoresearch.labelPhase')}</div>
          <div className="mt-1 truncate">{formatPhaseLabel(run.currentPhase)}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">{t('autoresearch.labelBest')}</div>
          <div className="mt-1 truncate">{run.config.metric}: {bestMetric}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">{t('autoresearch.labelExperiment')}</div>
          <div className="mt-1 truncate">{basename(run.config.experimentDir || run.config.workdir || run.title)}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">{t('autoresearch.labelUpdated')}</div>
          <div className="mt-1 truncate">{formatTimestamp(run.updatedAt)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
        <span className="truncate">{modelLabel}</span>
        {typeof run.config.gpuTemperatureC === 'number' && (
          <span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700">
            GPU {formatMetricValue(run.config.gpuTemperatureC)}C
          </span>
        )}
      </div>
    </div>
  );
}

export function AutoResearchInlineHint({ children }: { children: string }) {
  return (
    <p className="text-[11px] leading-relaxed text-gray-500">{children}</p>
  );
}

export function AutoResearchReadinessRow({
  label,
  ready,
}: {
  label: string;
  ready: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-gray-700">{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        ready
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-amber-50 text-amber-700'
      }`}>
        {ready ? t('autoresearch.readiness.filled') : t('autoresearch.readiness.check')}
      </span>
    </div>
  );
}

export function AutoResearchSummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">{label}</span>
      <span className="truncate font-medium text-gray-800">{value}</span>
    </div>
  );
}

export function AutoResearchConnectionStatusPanel({
  status,
  output,
}: {
  status: AutoResearchConnectionTestStatus;
  output: string;
}) {
  if (status === 'idle' && !output.trim()) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-amber-900">{t('autoresearch.connectionStatusNeedsTestTitle')}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-amber-800">{t('autoresearch.connectionTestRequired')}</div>
          </div>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
            {t('autoresearch.readiness.check')}
          </span>
        </div>
      </div>
    );
  }

  const tone = status === 'success'
    ? {
      border: 'border-emerald-200',
      bg: 'bg-emerald-50',
      title: 'text-emerald-900',
      body: 'text-emerald-800',
      badge: 'text-emerald-700',
      badgeLabel: t('autoresearch.readiness.filled'),
      titleText: t('autoresearch.connectionStatusSuccessTitle'),
      bodyText: t('autoresearch.connectionStatusSuccessBody'),
    }
    : status === 'error'
      ? {
        border: 'border-rose-200',
        bg: 'bg-rose-50',
        title: 'text-rose-900',
        body: 'text-rose-800',
        badge: 'text-rose-700',
        badgeLabel: t('autoresearch.readiness.missing'),
        titleText: t('autoresearch.connectionStatusErrorTitle'),
        bodyText: t('autoresearch.connectionStatusErrorBody'),
      }
      : {
        border: 'border-sky-200',
        bg: 'bg-sky-50',
        title: 'text-sky-900',
        body: 'text-sky-800',
        badge: 'text-sky-700',
        badgeLabel: t('autoresearch.connectionTesting'),
        titleText: t('autoresearch.connectionStatusTestingTitle'),
        bodyText: t('autoresearch.connectionStatusTestingBody'),
      };

  return (
    <div className={`rounded-2xl border px-3 py-2 ${tone.border} ${tone.bg}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className={`text-xs font-semibold ${tone.title}`}>{tone.titleText}</div>
          <div className={`mt-1 text-[11px] leading-relaxed ${tone.body}`}>{tone.bodyText}</div>
        </div>
        <span className={`rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${tone.badge}`}>
          {tone.badgeLabel}
        </span>
      </div>
      {output.trim() && (
        <details className="mt-2">
          <summary className={`cursor-pointer text-[11px] font-medium ${tone.body}`}>
            {t('autoresearch.connectionStatusRawOutput')}
          </summary>
          <div className={`mt-2 whitespace-pre-wrap rounded-xl border border-white/70 bg-white/70 px-3 py-2 font-mono text-[11px] ${tone.body}`}>
            {output}
          </div>
        </details>
      )}
    </div>
  );
}
