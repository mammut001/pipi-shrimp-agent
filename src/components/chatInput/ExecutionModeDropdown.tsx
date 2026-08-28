import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EXECUTION_MODES,
  getExecutionMode,
  type ExecutionModeId,
  type ExecutionModeProfile,
} from '@/services/executionMode';
import { t } from '@/i18n';
import { coerceRenderableText } from '@/utils/coerceRenderableText';

export interface ExecutionModeDropdownProps {
  selectedModeId: ExecutionModeId | string;
  onSelect: (modeId: ExecutionModeId) => void;
  disabled?: boolean;
  testId?: string;
}

const VISIBLE_MODES = EXECUTION_MODES;

function modeLabel(profile: ExecutionModeProfile): string {
  return profile.id === 'danger'
    ? 'Danger'
    : coerceRenderableText(t(profile.labelKey));
}

function modeDescription(profile: ExecutionModeProfile): string {
  if (profile.id === 'danger') {
    return 'Full tool access with risky-action approvals and destructive-operation double-checks.';
  }
  return coerceRenderableText(t(profile.descriptionKey));
}

export function ExecutionModeDropdown({
  selectedModeId,
  onSelect,
  disabled = false,
  testId = 'execution-mode-dropdown',
}: ExecutionModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pendingDanger, setPendingDanger] = useState<ExecutionModeProfile | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // getExecutionMode performs conservative legacy migration:
  // debug/agent -> Plan, bypass -> Danger.
  const selected = useMemo(
    () => getExecutionMode(selectedModeId),
    [selectedModeId],
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = VISIBLE_MODES.findIndex((profile) => profile.id === selected.id);
    if (index >= 0) setActiveIndex(index);
  }, [open, selected.id]);

  const commit = useCallback((profile: ExecutionModeProfile) => {
    onSelect(profile.id);
    setOpen(false);
    triggerRef.current?.focus();
  }, [onSelect]);

  const requestSelect = useCallback((profile: ExecutionModeProfile) => {
    if (profile.id === selected.id) {
      setOpen(false);
      return;
    }
    if (profile.requiresWarning) {
      setPendingDanger(profile);
      return;
    }
    commit(profile);
  }, [commit, selected.id]);

  const handleMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(VISIBLE_MODES.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(VISIBLE_MODES.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const profile = VISIBLE_MODES[activeIndex];
      if (profile) requestSelect(profile);
    }
  }, [activeIndex, requestSelect]);

  return (
    <div ref={rootRef} className="relative inline-block" data-testid={testId}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('executionMode.label')}
        data-testid={`${testId}-trigger`}
        onClick={() => !disabled && setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!disabled) setOpen(true);
          }
        }}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          selected.id === 'danger'
            ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${selected.id === 'danger' ? 'bg-rose-600' : selected.id === 'plan' ? 'bg-blue-500' : 'bg-gray-400'}`}
        />
        <span>{modeLabel(selected)}</span>
        <svg className="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('executionMode.label')}
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          data-testid={`${testId}-menu`}
          className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          {VISIBLE_MODES.map((profile, index) => {
            const isSelected = profile.id === selected.id;
            const isActive = index === activeIndex;
            return (
              <button
                key={profile.id}
                role="menuitem"
                type="button"
                tabIndex={-1}
                aria-checked={isSelected}
                data-testid={`${testId}-item-${profile.id}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => requestSelect(profile)}
                ref={(node) => {
                  if (isActive && node) node.focus();
                }}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left text-[12px] transition-colors ${isActive ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${profile.id === 'danger' ? 'bg-rose-600' : profile.id === 'plan' ? 'bg-blue-500' : 'bg-gray-400'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={profile.id === 'danger' ? 'font-semibold text-rose-700' : 'font-semibold text-gray-800'}>
                      {modeLabel(profile)}
                    </span>
                    {profile.id === 'danger' && (
                      <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-700">
                        DANGER
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
                    {modeDescription(profile)}
                  </div>
                </div>
                <div className="mt-0.5 h-4 w-4 shrink-0 text-gray-700">
                  {isSelected ? '✓' : null}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {pendingDanger && (
        <DangerWarningDialog
          profile={pendingDanger}
          onCancel={() => {
            setPendingDanger(null);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          onConfirm={() => {
            const profile = pendingDanger;
            setPendingDanger(null);
            commit(profile);
          }}
        />
      )}
    </div>
  );
}

export function DangerWarningDialog({
  profile,
  onCancel,
  onConfirm,
}: {
  profile: ExecutionModeProfile;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="execution-mode-danger-warning-title"
      aria-describedby="execution-mode-danger-warning-body"
      data-testid="execution-mode-danger-warning"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-rose-200 bg-white p-5 shadow-2xl">
        <h3 id="execution-mode-danger-warning-title" className="text-sm font-semibold text-rose-700">
          Danger mode
        </h3>
        <p id="execution-mode-danger-warning-body" className="mt-2 text-[12px] leading-relaxed text-gray-700">
          {modeLabel(profile)} can use the full tool surface. Risky operations still keep approval gates, and destructive actions must be double-checked before execution.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="execution-mode-danger-warning-cancel"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('executionMode.bypass.warningCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="execution-mode-danger-warning-confirm"
            className="rounded-md bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-700"
          >
            {t('executionMode.bypass.warningConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Temporary export so any out-of-tree callers compiled against the old name
// keep working during the three-mode migration window.
export const BypassWarningDialog = DangerWarningDialog;
