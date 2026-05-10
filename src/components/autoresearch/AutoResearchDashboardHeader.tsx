import type { ReactNode } from 'react';
import { t } from '@/i18n';
import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import { isDemoRun } from '@/services/autoresearch/demoRun';

interface AutoResearchDashboardHeaderProps {
  run: AutoResearchRunRecord;
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

function formatDate(value?: string): string | null {
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

export function AutoResearchDashboardHeader({
  run,
  onBack,
  onClose,
  onOpen,
  onOpenFullReport,
  headerActions,
  className = '',
}: AutoResearchDashboardHeaderProps) {
  const statusLabel = run.status.replace(/_/g, ' ');
  const demo = isDemoRun(run);
  const subtitleParts = [
    shortenRunId(run.id),
    statusLabel,
    formatDate(run.createdAt),
    safeString(run.config.metric),
    run.config.direction === 'lower' ? t('autoresearch.lowerIsBetter') : t('autoresearch.higherIsBetter'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return (
    <header className={`flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between ${className}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
            {t('autoresearch.detail.autoResearch')}
          </span>
          {demo && (
            <span className="rounded-full border border-[#d9c078]/35 bg-[#d9c078]/10 px-2.5 py-1 text-[11px] font-medium text-[#f3deb0]">
              {t('autoresearch.detail.demo')}
            </span>
          )}
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/70">
            {statusLabel}
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#f4f4f4] sm:text-[2.4rem]">
          {getRunTitle(run)}
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
          {subtitleParts.join(' · ')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {headerActions}

        {onOpenFullReport && (
          <button
            type="button"
            onClick={onOpenFullReport}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/[0.07]"
          >
            {t('autoresearch.detail.fullReport')}
          </button>
        )}

        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            {t('autoresearch.detail.open')}
          </button>
        )}

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            {t('autoresearch.detail.backToRuns')}
          </button>
        )}

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            {t('autoresearch.detail.close')}
          </button>
        )}
      </div>
    </header>
  );
}

export default AutoResearchDashboardHeader;
