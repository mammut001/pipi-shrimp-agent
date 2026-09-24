import React, { type Dispatch, type SetStateAction } from 'react';
import { t } from '@/i18n';

interface SidebarWorkflowBulkActionsProps {
  isWorkflowMultiSelectMode: boolean;
  setIsWorkflowMultiSelectMode: Dispatch<SetStateAction<boolean>>;
  selectedWorkflows: Set<string>;
  setSelectedWorkflows: Dispatch<SetStateAction<Set<string>>>;
  workflowInstances: Array<{ id: string }>;
  handleWorkflowSelectAll: () => void;
  handleBatchDeleteWorkflows: () => void;
}

export function SidebarWorkflowBulkActions({
  isWorkflowMultiSelectMode,
  setIsWorkflowMultiSelectMode,
  selectedWorkflows,
  setSelectedWorkflows,
  workflowInstances,
  handleWorkflowSelectAll,
  handleBatchDeleteWorkflows,
}: SidebarWorkflowBulkActionsProps) {
  return (
    <>
        {isWorkflowMultiSelectMode && (
          <div className="transition-all duration-200 ease-out">
            <div className="mx-2 px-2.5 py-2 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden flex items-center gap-2">
              {/* Cancel / exit multi-select */}
              <button
                onClick={() => { setIsWorkflowMultiSelectMode(false); setSelectedWorkflows(new Set()); }}
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:scale-95 transition-all duration-150"
                title={t('sidebar.exitSelection')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Count */}
              <span className="text-xs font-semibold text-gray-700 tabular-nums whitespace-nowrap">
                {selectedWorkflows.size} {t('sidebar.selected')}
              </span>

              {/* Right-side actions */}
              <div className="ml-auto flex-shrink-0 flex items-center gap-1.5">
                {/* Select All / None */}
                <button
                  onClick={handleWorkflowSelectAll}
                  className="px-2 py-1 text-[11px] font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 rounded-lg transition-all duration-150 whitespace-nowrap"
                >
                  {workflowInstances.every(i => selectedWorkflows.has(i.id)) && selectedWorkflows.size > 0
                    ? t('common.none') : t('common.all')}
                </button>

                {/* Delete */}
                <button
                  onClick={handleBatchDeleteWorkflows}
                  disabled={selectedWorkflows.size === 0}
                  className="px-2 py-1 text-[11px] font-bold flex items-center gap-1 rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-red-600 bg-red-50 hover:bg-red-100 border border-red-100/80"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </div>
        )}
    </>
  );
}
