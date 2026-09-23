/**
 * Presentational helpers for AutoResearchSetupModal.
 * Behavior-preserving extract (split-soon / >800 governance).
 */

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { t } from '@/i18n';

export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">{title}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="flex items-center gap-1 text-[12px] font-semibold text-gray-700">
      {label}
      {required && <span className="text-rose-400 text-[10px]">*</span>}
    </label>
  );
}

export function InlineHint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-snug text-gray-500">{children}</p>;
}

export function ReadinessRow({ label, status, action }: { label: string; status: 'ok' | 'warn' | 'error'; action?: ReactNode }) {
  const colors = { ok: 'text-emerald-700', warn: 'text-amber-700', error: 'text-rose-600' };
  const bgColors = { ok: 'bg-emerald-50', warn: 'bg-amber-50', error: 'bg-rose-50' };
  const icons = { ok: '✓', warn: '⚠', error: '✗' };
  const statusLabel = { ok: t('autoresearch.readiness.filled'), warn: t('autoresearch.readiness.check'), error: t('autoresearch.readiness.missing') };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2 text-[12px]">
      <span className="min-w-0 text-gray-700">{label}</span>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${colors[status]} ${bgColors[status]}`}>
          <span aria-hidden="true">{icons[status]}</span>
          {statusLabel[status]}
        </span>
        {action}
      </div>
    </div>
  );
}

export function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">{label}</span>
      <span className="truncate font-medium text-gray-800">{value}</span>
    </div>
  );
}

export function PathInputRow({
  value,
  onChange,
  onKeyDown,
  placeholder,
  ariaLabel,
  onPick,
  pickLabel,
  disabled,
  invalid,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  ariaLabel: string;
  onPick?: () => void;
  pickLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-stretch gap-2 ${className ?? ''}`}>
      <input
        className={`flex-1 rounded-xl border bg-white px-3 py-2 font-mono text-[12px] text-gray-800 shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${
          invalid
            ? 'border-rose-300 focus:border-rose-400'
            : 'border-gray-200 focus:border-indigo-400'
        }`}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
      {onPick && (
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        >
          {pickLabel}
        </button>
      )}
    </div>
  );
}
