import { useEffect, useMemo, useState } from 'react';

import { SessionGoalClarifyPanel } from '@/components/SessionGoalClarifyPanel';
import { AsciiPreviewBlock } from '@/components/workflow/AsciiPreviewBlock';
import { t } from '@/i18n';
import { buildContinueGoalMessage } from '@/services/sessionGoal/goalPrompt';
import { useChatStore, useUIStore } from '@/store';
import { useSessionGoalStore } from '@/store/sessionGoalStore';
import type { SessionGoalStatus } from '@/types/sessionGoal';

function statusMeta(status: SessionGoalStatus) {
  switch (status) {
    case 'active':
      return { label: t('goal.status.active'), className: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
    case 'paused':
      return { label: t('goal.status.paused'), className: 'text-amber-700 bg-amber-50 border-amber-200' };
    case 'completed':
      return { label: t('goal.status.completed'), className: 'text-slate-700 bg-slate-50 border-slate-200' };
    case 'restricted':
      return { label: t('goal.status.restricted'), className: 'text-blue-700 bg-blue-50 border-blue-200' };
    case 'budget_limited':
      return { label: t('goal.status.budgetLimited'), className: 'text-orange-700 bg-orange-50 border-orange-200' };
    default:
      return { label: t('goal.status.idle'), className: 'text-gray-600 bg-gray-50 border-gray-200' };
  }
}

export function SessionGoalPanel() {
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const addNotification = useUIStore((s) => s.addNotification);

  const hydrate = useSessionGoalStore((s) => s.hydrate);
  const bindSession = useSessionGoalStore((s) => s.bindSession);
  const setObjective = useSessionGoalStore((s) => s.setObjective);
  const applyPreflightResult = useSessionGoalStore((s) => s.applyPreflightResult);
  const clearGoal = useSessionGoalStore((s) => s.clearGoal);
  const pauseGoal = useSessionGoalStore((s) => s.pauseGoal);
  const resumeGoal = useSessionGoalStore((s) => s.resumeGoal);
  const completeGoal = useSessionGoalStore((s) => s.completeGoal);
  const setAutoContinue = useSessionGoalStore((s) => s.setAutoContinue);
  const setBudget = useSessionGoalStore((s) => s.setBudget);
  const syncRestricted = useSessionGoalStore((s) => s.syncRestricted);
  const goal = useSessionGoalStore((s) => (
    currentSessionId ? s.goalsBySession[currentSessionId] ?? null : null
  ));

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState(false);

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

  useEffect(() => {
    setDraft(goal?.objective ?? '');
    setEditing(false);
  }, [currentSessionId, goal?.objective]);

  const status = useMemo(() => statusMeta(goal?.status ?? 'idle'), [goal?.status]);
  const traces = [...(goal?.traces ?? [])].reverse();

  const handleSave = () => {
    if (!currentSessionId) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      addNotification('warning', t('goal.emptyWarning'));
      return;
    }
    setObjective(currentSessionId, trimmed);
    addNotification('success', t('goal.saveSuccess'));
    setEditing(false);
  };

  const handleContinue = () => {
    if (!currentSessionId || !goal?.objective || isStreaming) return;
    if (goal.status === 'paused' || goal.status === 'budget_limited') {
      resumeGoal(currentSessionId);
    }
    void sendMessage(buildContinueGoalMessage(goal.objective, goal.successCriteria));
  };

  if (clarifyOpen) {
    return (
      <SessionGoalClarifyPanel
        initialGoal={goal?.objective || draft}
        onClose={() => setClarifyOpen(false)}
        onApply={(result) => {
          if (!currentSessionId) return;
          applyPreflightResult(currentSessionId, result);
          setClarifyOpen(false);
          addNotification('success', t('goal.clarify.applied'));
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200/70 bg-white/80">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-tight text-gray-800">{t('goal.panelTitle')}</h2>
          {goal?.objective && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${status.className}`}>
              {status.label}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">{t('goal.panelDescription')}</p>
        <button
          type="button"
          onClick={() => setClarifyOpen(true)}
          className="mt-2 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50"
        >
          {t('goal.clarify.open')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {editing || !goal?.objective ? (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {t('goal.title')}
            </label>
            <textarea
              rows={4}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('goal.inputPlaceholder')}
              className="w-full text-xs border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleSave}
                disabled={!draft.trim()}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('goal.save')}
              </button>
              <button
                type="button"
                onClick={() => setClarifyOpen(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-sky-200 text-sky-700"
              >
                {t('goal.clarify.open')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
              <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">{goal.objective}</p>

              {goal.successCriteria.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    {t('workflow.goalPreflight.successCriteria')}
                  </p>
                  <ul className="list-disc pl-4 text-[11px] text-gray-700 space-y-0.5">
                    {goal.successCriteria.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {goal.asciiPreview.trim() && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    {t('workflow.goalPreflight.asciiPreview')}
                  </p>
                  <AsciiPreviewBlock text={goal.asciiPreview} />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing(true)} className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-gray-200 hover:bg-gray-50">
                  {t('goal.edit')}
                </button>
                <button type="button" onClick={handleContinue} disabled={isStreaming || goal.status === 'completed'} className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
                  {t('goal.continue')}
                </button>
                {goal.status === 'paused' || goal.status === 'budget_limited' ? (
                  <button type="button" onClick={() => currentSessionId && resumeGoal(currentSessionId)} className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50">
                    {t('goal.resume')}
                  </button>
                ) : (
                  <button type="button" onClick={() => currentSessionId && pauseGoal(currentSessionId)} className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50">
                    {t('goal.pause')}
                  </button>
                )}
                <button type="button" onClick={() => currentSessionId && completeGoal(currentSessionId, goal.lastEvaluation?.evidence)} className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
                  {t('goal.markComplete')}
                </button>
                <button type="button" onClick={() => { if (currentSessionId) clearGoal(currentSessionId); addNotification('success', t('goal.clearSuccess')); }} className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50">
                  {t('goal.clear')}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{t('goal.autoContinue')}</p>
                <label className="inline-flex items-center gap-2 text-[11px] text-gray-700">
                  <input
                    type="checkbox"
                    checked={goal.autoContinue}
                    onChange={(event) => currentSessionId && setAutoContinue(currentSessionId, event.target.checked)}
                  />
                  {goal.autoContinue ? t('goal.autoContinueOn') : t('goal.autoContinueOff')}
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-600">
                  {t('goal.maxTurns')}
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={goal.budget.maxTurns}
                    onChange={(event) => {
                      if (!currentSessionId) return;
                      setBudget(currentSessionId, { maxTurns: Number(event.target.value) || 1 });
                    }}
                    className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                </label>
                <label className="text-[11px] text-gray-600">
                  {t('goal.maxTokens')}
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={goal.budget.maxTokens}
                    onChange={(event) => {
                      if (!currentSessionId) return;
                      setBudget(currentSessionId, { maxTokens: Number(event.target.value) || 1000 });
                    }}
                    className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                </label>
              </div>
              <p className="text-[10px] text-gray-500">
                {t('goal.budgetUsage')
                  .replace('{turns}', String(goal.budget.turnsUsed))
                  .replace('{maxTurns}', String(goal.budget.maxTurns))
                  .replace('{tokens}', String(goal.budget.tokensUsed))
                  .replace('{maxTokens}', String(goal.budget.maxTokens))}
              </p>
            </div>

            {goal.lastEvaluation && (
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{t('goal.lastEvaluation')}</p>
                <p className="mt-1 text-[11px] text-gray-700">{goal.lastEvaluation.reasoning}</p>
                {goal.lastEvaluation.evidence.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-[10px] text-gray-500 space-y-0.5">
                    {goal.lastEvaluation.evidence.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{t('goal.trace')}</h3>
            <span className="text-[10px] text-gray-400">{traces.length}</span>
          </div>
          {traces.length > 0 ? (
            <div className="space-y-2">
              {traces.map((entry, index) => (
                <div key={entry.id} className="flex gap-2 items-start">
                  <div className="mt-0.5 h-4 w-4 rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 flex items-center justify-center flex-shrink-0">
                    {traces.length - index}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-gray-700 leading-snug">{entry.summary}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{new Date(entry.timestamp).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">{t('goal.traceEmpty')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
