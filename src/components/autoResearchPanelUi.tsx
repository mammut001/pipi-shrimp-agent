/**
 * Presentational helpers for AutoResearchPanel.
 * Behavior-preserving extract (split-soon / >800 governance).
 */

import type { ReactNode } from 'react';
import { t } from '@/i18n';
import type { AutoResearchRunRecord } from '@/store/autoresearchStore';
import { redactSensitiveText } from '@/services/autoresearch/runDocument';

export type LiveOutputFeedback = 'copied' | 'cleared' | null;

export function CopyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 012-2h7a2 2 0 012 2v7a2 2 0 01-2 2h-2m-7 3h7a2 2 0 002-2V10a2 2 0 00-2-2H8a2 2 0 00-2 2v7a2 2 0 002 2z" />
    </svg>
  );
}

export function DownloadIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v11m0 0l4-4m-4 4l-4-4M4 17v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
    </svg>
  );
}

export function ClearIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

export function HeaderActionButton({
  label,
  title,
  icon,
  onClick,
  className = '',
  dataCopyTarget,
}: {
  label: string;
  title?: string;
  icon: ReactNode;
  onClick: () => void;
  className?: string;
  dataCopyTarget?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title || label}
      data-copy-target={dataCopyTarget}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400/70 ${className}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function RowCopyButton({ onClick, label, dataCopyTarget }: { onClick: () => void; label: string; dataCopyTarget?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-copy-target={dataCopyTarget}
      className="rounded-md p-1 text-gray-400 opacity-0 transition-[opacity,color,background-color] hover:bg-gray-200 hover:text-gray-700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/70 group-hover:opacity-100"
    >
      <CopyIcon className="h-3 w-3" />
    </button>
  );
}

export function formatRunStatusLabel(status: AutoResearchRunRecord['status']): string {
  return status === 'reflection_failed'
    ? t('autoresearch.statusReflectionFailed')
    : status.replace(/_/g, ' ');
}

export function formatEventPhaseLabel(phase: AutoResearchRunRecord['events'][number]['phase']): string {
  return phase === 'reflection_parse_failed'
    ? t('autoresearch.reflectionParseFailed')
    : phase.replace(/_/g, ' ');
}

export function RunStatusBadge({ status }: { status: AutoResearchRunRecord['status'] }) {
  const styles: Record<AutoResearchRunRecord['status'], string> = {
    draft: 'bg-gray-100 text-gray-700',
    running: 'bg-green-100 text-green-700',
    waiting_rate_limit: 'bg-yellow-100 text-yellow-700',
    paused: 'bg-amber-100 text-amber-700',
    reflection_failed: 'bg-red-100 text-red-700',
    stopped: 'bg-gray-100 text-gray-700',
    failed: 'bg-red-100 text-red-700',
    completed: 'bg-blue-100 text-blue-700',
    interrupted: 'bg-orange-100 text-orange-700',
  };

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${styles[status]}`}>
      {formatRunStatusLabel(status)}
    </span>
  );
}

export function IterationStatusBadge({ status }: { status: 'pending' | 'running' | 'failed' | 'completed' | 'skipped' }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    completed: 'bg-green-100 text-green-700',
    skipped: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export function IterationDetail({ run, index }: { run: AutoResearchRunRecord; index: number }) {
  const iteration = run.iterations[index];
  if (!iteration) {
    return null;
  }

  return (
    <div className="px-3 pb-3 pt-1 space-y-2 text-[10px] bg-gray-50/80 border-t border-gray-100">
      <div className="flex items-center gap-2">
        <IterationStatusBadge status={iteration.status} />
        {typeof iteration.metricValue === 'number' && (
          <span className="text-gray-500 font-mono">{run.config.metric}={iteration.metricValue}</span>
        )}
      </div>
      {iteration.hypothesis && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Hypothesis</span>
          <p className="text-gray-700 mt-0.5">{redactSensitiveText(iteration.hypothesis)}</p>
        </div>
      )}
      {iteration.change && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Change</span>
          <p className="text-gray-600 mt-0.5 font-mono text-[9px] whitespace-pre-wrap">{redactSensitiveText(iteration.change)}</p>
        </div>
      )}
      {iteration.reasoning && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Reasoning</span>
          <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">{redactSensitiveText(iteration.reasoning)}</p>
        </div>
      )}
      {iteration.error && (
        <p className="text-red-500 text-[9px]">Error: {redactSensitiveText(iteration.error)}</p>
      )}
      {iteration.artifactPaths && iteration.artifactPaths.length > 0 && (
        <div>
          <span className="text-gray-400 font-bold uppercase tracking-wider">Artifacts</span>
          <div className="mt-1 space-y-0.5">
            {iteration.artifactPaths.slice(0, 6).map((artifactPath) => (
              <p key={artifactPath} className="text-[9px] text-gray-500 break-all font-mono">{artifactPath}</p>
            ))}
          </div>
        </div>
      )}
      <p className="text-gray-300 text-[9px]">
        {[iteration.startedAt, iteration.endedAt].filter(Boolean).join(' → ')}
      </p>
    </div>
  );
}
