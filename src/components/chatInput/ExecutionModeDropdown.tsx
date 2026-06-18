/**
 * Chat execution mode dropdown.
 *
 * Cursor-style compact trigger: icon + label + chevron. Clicking opens a
 * menu listing all 6 modes. Each item shows an icon, label, short
 * description, and a check mark for the active mode. Advanced (Bypass) is
 * pushed under a separator + "Advanced" section header. Bypass requires an
 * explicit one-time warning before the selection is committed.
 *
 * Keyboard: ↓/↑ moves focus between items, Enter/Space selects, Escape
 * closes. Menu items use role="menuitem" with aria-checked.
 *
 * State: reads selected mode from the session via props; calls
 * `onSelect(modeId)` to commit. The store integration lives in the parent
 * (ChatInput) so the dropdown stays a dumb presentational component.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EXECUTION_MODES,
  type ExecutionModeId,
  type ExecutionModeProfile,
} from '@/services/executionMode';
import { t } from '@/i18n';

export interface ExecutionModeDropdownProps {
  selectedModeId: ExecutionModeId | string;
  onSelect: (modeId: ExecutionModeId) => void;
  disabled?: boolean;
  /** Optional id used by tests / labels. */
  testId?: string;
}

const VISIBLE_MODES = EXECUTION_MODES;

export function ExecutionModeDropdown({
  selectedModeId,
  onSelect,
  disabled = false,
  testId = 'execution-mode-dropdown',
}: ExecutionModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pendingBypass, setPendingBypass] = useState<ExecutionModeProfile | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const selected = useMemo<ExecutionModeProfile>(() => {
    return (
      EXECUTION_MODES.find((profile) => profile.id === selectedModeId) ??
      EXECUTION_MODES.find((profile) => profile.isDefault) ??
      EXECUTION_MODES[0]!
    );
  }, [selectedModeId]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !rootRef.current) return;
      if (!rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
    };
  }, [open]);

  // When the menu opens, focus the active item.
  useEffect(() => {
    if (!open) return;
    const selectedIdx = VISIBLE_MODES.findIndex((p) => p.id === selected.id);
    if (selectedIdx >= 0) {
      setActiveIndex(selectedIdx);
    }
  }, [open, selected.id]);

  const commit = useCallback(
    (profile: ExecutionModeProfile) => {
      onSelect(profile.id);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onSelect],
  );

  const requestSelect = useCallback(
    (profile: ExecutionModeProfile) => {
      // If the mode is already selected, just close.
      if (profile.id === selected.id) {
        setOpen(false);
        return;
      }
      if (profile.requiresWarning) {
        setPendingBypass(profile);
        return;
      }
      commit(profile);
    },
    [commit, selected.id],
  );

  const handleTriggerClick = useCallback(() => {
    if (disabled) return;
    setOpen((current) => !current);
  }, [disabled]);

  const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  }, []);

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
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
        if (profile) {
          requestSelect(profile);
        }
      }
    },
    [activeIndex, requestSelect],
  );

  const riskColor = RISK_COLOR_MAP[selected.riskLevel] ?? RISK_COLOR_MAP.safe!;
  const TriggerIcon = ICONS[selected.icon] ?? ICONS.plan!;

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
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className={`inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium transition-colors hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed ${riskColor}`}
      >
        <TriggerIcon className="h-3 w-3" />
        <span>{t(selected.labelKey)}</span>
        <svg className="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('executionMode.label')}
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          data-testid={`${testId}-menu`}
          className="absolute bottom-full left-0 mb-2 w-72 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none z-50 max-w-none"
        >
          {VISIBLE_MODES.map((profile, index) => {
            const isSelected = profile.id === selected.id;
            const isActive = index === activeIndex;
            const Icon = ICONS[profile.icon] ?? ICONS.plan!;
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
                  if (isActive && node) {
                    node.focus();
                  }
                }}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] transition-colors ${
                  isActive ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'
                } ${profile.isAdvanced ? 'border-t border-gray-100' : ''}`}
              >
                <Icon className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${RISK_COLOR_MAP[profile.riskLevel]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-semibold ${RISK_COLOR_MAP[profile.riskLevel]}`}>{t(profile.labelKey)}</span>
                    {profile.experimentalNoteKey && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                        Limited
                      </span>
                    )}
                    {profile.requiresWarning && (
                      <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-700">
                        DANGER
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 leading-snug">{t(profile.descriptionKey)}</div>
                  {profile.experimentalNoteKey && (
                    <div className="mt-0.5 text-[10px] italic text-amber-600">
                      {t(profile.experimentalNoteKey)}
                    </div>
                  )}
                </div>
                <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {isSelected ? (
                    <svg className="h-3 w-3 text-gray-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42L8.5 12.08l6.79-6.79a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : null}
                </div>
              </button>
            );
          })}
          {VISIBLE_MODES.some((p) => p.isAdvanced) && (
            <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              {t('executionMode.advancedSection')}
            </div>
          )}
        </div>
      )}

      {pendingBypass && (
        <BypassWarningDialog
          profile={pendingBypass}
          onCancel={() => {
            setPendingBypass(null);
            setOpen(false);
            triggerRef.current?.focus();
          }}
          onConfirm={() => {
            const profile = pendingBypass;
            setPendingBypass(null);
            if (profile) commit(profile);
          }}
        />
      )}
    </div>
  );
}

function BypassWarningDialog({
  profile,
  onCancel,
  onConfirm,
}: {
  profile: ExecutionModeProfile;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Trap Escape to cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="execution-mode-bypass-warning-title"
      aria-describedby="execution-mode-bypass-warning-body"
      data-testid="execution-mode-bypass-warning"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-rose-200 bg-white p-5 shadow-2xl">
        <h3
          id="execution-mode-bypass-warning-title"
          className="text-sm font-semibold text-rose-700"
        >
          {t('executionMode.bypass.warningTitle')}
        </h3>
        <p
          id="execution-mode-bypass-warning-body"
          className="mt-2 text-[12px] leading-relaxed text-gray-700"
        >
          {t('executionMode.bypass.warningBody')}
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="execution-mode-bypass-warning-cancel"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {t('executionMode.bypass.warningCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="execution-mode-bypass-warning-confirm"
            className="rounded-md bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-rose-700"
          >
            {t('executionMode.bypass.warningConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Icons (inline SVGs to keep this component self-contained) ---

interface IconProps {
  className?: string;
}

const ICONS: Record<ExecutionModeProfile['icon'], React.FC<IconProps>> = {
  ask: ({ className }) => (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
        clipRule="evenodd"
      />
    </svg>
  ),
  plan: ({ className }) => (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M5 3a2 2 0 00-2 2v12l4-2h8a2 2 0 002-2V5a2 2 0 00-2-2H5z" />
    </svg>
  ),
  bug: ({ className }) => (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2a3 3 0 00-3 3v1H6a3 3 0 00-3 3v6a3 3 0 003 3h8a3 3 0 003-3V9a3 3 0 00-3-3h-1V5a3 3 0 00-3-3zm-5 8h2m6 0h2M7 14h6" />
    </svg>
  ),
  agent: ({ className }) => (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2a1 1 0 011 1v1.07A4 4 0 0114 8h2a1 1 0 110 2h-2a4 4 0 01-3 3.93V15a1 1 0 11-2 0v-1.07A4 4 0 016 10H4a1 1 0 110-2h2a4 4 0 013-3.93V3a1 1 0 011-1z" />
    </svg>
  ),
  bypass: ({ className }) => (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2L2 18h16L10 2zm0 5l4.5 9h-9L10 7z" />
    </svg>
  ),
};

const RISK_COLOR_MAP: Record<ExecutionModeProfile['riskLevel'], string> = {
  safe: 'text-gray-700',
  moderate: 'text-blue-700',
  elevated: 'text-amber-700',
  dangerous: 'text-rose-700',
};
