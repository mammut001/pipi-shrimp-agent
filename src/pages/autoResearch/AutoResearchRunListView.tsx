/**
 * Run history list view for AutoResearch.
 * Moved verbatim out of src/pages/AutoResearch.tsx (AG-27); state and handlers stay in the page.
 */

import type { Dispatch, SetStateAction } from 'react';
import { t } from '@/i18n';
import { AutoResearchRunHistoryCard } from '@/components/autoresearch/AutoResearchSetupHelpers';
import type { AutoResearchRunRecord, AutoResearchSelectedRunContext } from '@/store/autoresearchStore';

export interface AutoResearchRunListViewProps {
  isSelectMode: boolean;
  batchSelectedIds: string[];
  handleBatchDelete: () => void;
  handleExitSelection: () => void;
  activeRun: AutoResearchRunRecord | null;
  handleViewActiveRun: () => void;
  handleShowSetup: () => Promise<void>;
  sortedRuns: AutoResearchRunRecord[];
  displayRun: AutoResearchSelectedRunContext['run'];
  activeRunId: string | null;
  handleToggleSelectRun: (runId: string) => void;
  handleSingleDelete: (runId: string) => void;
  selectRun: (id: string) => void;
  setSelectedExperiment: (idx: number) => void;
  setShowSetup: Dispatch<SetStateAction<boolean>>;
  setShowRunList: Dispatch<SetStateAction<boolean>>;
}

export function AutoResearchRunListView({
  isSelectMode,
  batchSelectedIds,
  handleBatchDelete,
  handleExitSelection,
  activeRun,
  handleViewActiveRun,
  handleShowSetup,
  sortedRuns,
  displayRun,
  activeRunId,
  handleToggleSelectRun,
  handleSingleDelete,
  selectRun,
  setSelectedExperiment,
  setShowSetup,
  setShowRunList,
}: AutoResearchRunListViewProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        {isSelectMode ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-all">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-neutral-900 animate-pulse" />
              <span className="text-sm font-medium text-gray-700">
                {t('autoresearch.selectedCount', { count: batchSelectedIds.length })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBatchDelete}
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-100"
              >
                {t('autoresearch.batchDelete')}
              </button>
              <button
                type="button"
                onClick={handleExitSelection}
                className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              >
                {t('autoresearch.exitSelect')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-600" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">AutoResearch Lab</span>
              </div>
              <h2 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900">{t('autoresearch.runHistoryTitle')}</h2>
            </div>
            <div className="flex items-center gap-2">
              {activeRun && (
                <button
                  type="button"
                  onClick={handleViewActiveRun}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  {t('autoresearch.viewActiveRun')}
                </button>
              )}
              <button
                type="button"
                onClick={() => { void handleShowSetup(); }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.98]"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {t('autoresearch.newRun')}
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedRuns.map((run) => (
            <AutoResearchRunHistoryCard
              key={run.id}
              run={run}
              isSelected={displayRun?.id === run.id}
              isActive={activeRunId === run.id}
              isSelectMode={isSelectMode}
              isChecked={batchSelectedIds.includes(run.id)}
              onToggleSelect={() => handleToggleSelectRun(run.id)}
              onDelete={() => handleSingleDelete(run.id)}
              onClick={() => {
                selectRun(run.id);
                setSelectedExperiment(-1);
                setShowSetup(false);
                setShowRunList(false);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
