/**
 * SessionGoalPopover — goal button + popover for ChatInput (AG-13 extract).
 *
 * Owns click-outside dismiss. Parent owns session-goal store wiring and
 * notification toasts so hydrate/bind lifecycle stays in ChatInput.
 */

import { useEffect, useRef } from 'react';
import { t } from '@/i18n';

export interface SessionGoalPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Saved objective for the active session (empty when unset). */
  sessionGoal: string;
  goalInputText: string;
  onGoalInputChange: (value: string) => void;
  disabled?: boolean;
  /** False when no session is selected — save/clear become no-ops. */
  hasSession: boolean;
  onSave: (trimmedObjective: string) => void;
  onClear: () => void;
}

export function SessionGoalPopover({
  open,
  onOpenChange,
  sessionGoal,
  goalInputText,
  onGoalInputChange,
  disabled = false,
  hasSession,
  onSave,
  onClear,
}: SessionGoalPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hasActiveGoal = Boolean(sessionGoal.trim());

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onOpenChange]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        data-testid="goal-button"
        data-goal-trigger="true"
        onClick={() => {
          const next = !open;
          onOpenChange(next);
          if (next) {
            onGoalInputChange(sessionGoal);
          }
        }}
        disabled={disabled}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          hasActiveGoal
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100/70'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
        title={hasActiveGoal ? `${t('goal.active')}: ${sessionGoal}` : t('goal.setTooltip')}
      >
        {hasActiveGoal ? (
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        ) : (
          <svg
            className="h-3 w-3 text-gray-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 016 6h-2a4 4 0 00-4-4V4z" />
          </svg>
        )}
        <span>{t('goal.label')}</span>
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4 max-w-none flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2">
            <h3 className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 016 6h-2a4 4 0 00-4-4V4z" />
              </svg>
              {t('goal.title')}
            </h3>
            {hasActiveGoal && (
              <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-medium">
                {t('goal.active')}
              </span>
            )}
          </div>

          <p className="text-[11px] text-gray-500 leading-normal">
            {t('goal.description')}
          </p>

          <textarea
            rows={3}
            className="w-full text-xs border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 resize-none placeholder-gray-400"
            placeholder={t('goal.inputPlaceholder')}
            value={goalInputText}
            onChange={(e) => onGoalInputChange(e.target.value)}
          />

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                if (!hasSession) return;
                onClear();
              }}
              className="px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
            >
              {t('goal.clear')}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg transition-colors font-medium"
              >
                {t('workflow.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!hasSession) return;
                  onSave(goalInputText.trim());
                }}
                className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors font-medium shadow-sm"
              >
                {t('goal.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
