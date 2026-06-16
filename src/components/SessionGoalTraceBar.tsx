import { useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { buildContinueGoalMessage } from '@/services/sessionGoal/goalPrompt';
import { useChatStore } from '@/store';
import { useSessionGoalStore } from '@/store/sessionGoalStore';
import type { SessionGoalStatus } from '@/types/sessionGoal';

function statusMeta(status: SessionGoalStatus) {
  switch (status) {
    case 'active':
      return { label: t('goal.status.active'), className: 'bg-emerald-100 text-emerald-800' };
    case 'paused':
      return { label: t('goal.status.paused'), className: 'bg-amber-100 text-amber-800' };
    case 'completed':
      return { label: t('goal.status.completed'), className: 'bg-slate-100 text-slate-700' };
    case 'restricted':
      return { label: t('goal.status.restricted'), className: 'bg-blue-100 text-blue-800' };
    case 'budget_limited':
      return { label: t('goal.status.budgetLimited'), className: 'bg-orange-100 text-orange-800' };
    default:
      return { label: t('goal.status.idle'), className: 'bg-gray-100 text-gray-600' };
  }
}

export interface SessionGoalTraceBarProps {
  onEdit?: () => void;
  onExpandPanel?: () => void;
}

export function SessionGoalTraceBar({ onEdit, onExpandPanel }: SessionGoalTraceBarProps) {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const hydrate = useSessionGoalStore((s) => s.hydrate);
  const bindSession = useSessionGoalStore((s) => s.bindSession);
  const syncRestricted = useSessionGoalStore((s) => s.syncRestricted);
  const pauseGoal = useSessionGoalStore((s) => s.pauseGoal);
  const resumeGoal = useSessionGoalStore((s) => s.resumeGoal);
  const clearGoal = useSessionGoalStore((s) => s.clearGoal);
  const goal = useSessionGoalStore((s) => (
    currentSessionId ? s.goalsBySession[currentSessionId] ?? null : null
  ));

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    bindSession(currentSessionId);
  }, [bindSession, currentSessionId]);

  useEffect(() => {
    if (!currentSessionId) return;
    syncRestricted(currentSessionId, isStreaming);
  }, [currentSessionId, isStreaming, syncRestricted]);

  const status = useMemo(
    () => statusMeta(goal?.status ?? 'idle'),
    [goal?.status],
  );

  if (!goal?.objective?.trim()) {
    return null;
  }

  const canContinue = !isStreaming && goal.status !== 'completed';
  const latestTraces = goal.traces.slice(-5).reverse();

  const handleContinue = () => {
    if (!canContinue) return;
    if (goal.status === 'paused') {
      resumeGoal(currentSessionId!);
    }
    void sendMessage(buildContinueGoalMessage(goal.objective, goal.successCriteria));
  };

  return (
    <div className="border-b border-emerald-100/80 bg-emerald-50/60 flex-shrink-0">
      <div className="px-3 py-2 flex items-center gap-2 min-w-0">
        <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-semibold inline-flex items-center gap-1 ${status.className}`}>
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 016 6h-2a4 4 0 00-4-4V4z" />
          </svg>
          {status.label}
        </span>

        <p className="min-w-0 flex-1 text-xs text-gray-700 truncate font-medium" title={goal.objective}>
          {goal.objective}
        </p>

        <span className="text-[10px] text-gray-400 flex-shrink-0">{goal.traces.length}</span>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="p-1 rounded-md text-gray-500 hover:bg-white/80 hover:text-gray-800 transition-colors"
            title={t('goal.edit')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue}
            className="p-1 rounded-md text-gray-500 hover:bg-white/80 hover:text-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('goal.continue')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!currentSessionId) return;
              if (goal.status === 'paused') {
                resumeGoal(currentSessionId);
              } else {
                pauseGoal(currentSessionId);
              }
            }}
            className="p-1 rounded-md text-gray-500 hover:bg-white/80 hover:text-amber-700 transition-colors"
            title={goal.status === 'paused' ? t('goal.resume') : t('goal.pause')}
          >
            {goal.status === 'paused' ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={() => currentSessionId && clearGoal(currentSessionId)}
            className="p-1 rounded-md text-gray-500 hover:bg-white/80 hover:text-rose-600 transition-colors"
            title={t('goal.clear')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => {
              setExpanded((value) => !value);
              onExpandPanel?.();
            }}
            className="p-1 rounded-md text-gray-500 hover:bg-white/80 hover:text-gray-800 transition-colors"
            title={t('goal.trace')}
          >
            <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-emerald-100/60">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 pt-2 pb-1">
            {t('goal.trace')}
          </p>
          {latestTraces.length > 0 ? (
            <ul className="space-y-1.5">
              {latestTraces.map((entry) => (
                <li key={entry.id} className="text-[11px] text-gray-600 leading-snug">
                  <span className="text-gray-400 mr-1">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {entry.summary}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-gray-400">{t('goal.traceEmpty')}</p>
          )}
        </div>
      )}
    </div>
  );
}
