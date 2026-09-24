import React, { type Dispatch, type SetStateAction } from 'react';
import { SearchInput } from '@/components/ui';
import { t } from '@/i18n';
import type { useWorkflowStore } from '@/store';

type WorkflowInstance = ReturnType<typeof useWorkflowStore.getState>['instances'][number];

interface SidebarWorkflowListProps {
  workflowInstances: WorkflowInstance[];
  currentInstanceId: string | null;
  filteredWorkflows: WorkflowInstance[] | null;
  workflowSearchQuery: string;
  setWorkflowSearchQuery: (query: string) => void;
  isWorkflowMultiSelectMode: boolean;
  selectedWorkflows: Set<string>;
  handleToggleWorkflowSelection: (instanceId: string) => void;
  handleSelectInstance: (instanceId: string) => void;
  renamingWorkflowInstanceId: string | null;
  workflowRenameInput: string;
  setWorkflowRenameInput: Dispatch<SetStateAction<string>>;
  handleConfirmWorkflowRename: () => void;
  handleCancelWorkflowRename: () => void;
  handleStartWorkflowRename: (instanceId: string) => void;
  handleOpenWorkflowDeleteConfirm: (instanceId: string) => void;
}

export function SidebarWorkflowList({
  workflowInstances,
  currentInstanceId,
  filteredWorkflows,
  workflowSearchQuery,
  setWorkflowSearchQuery,
  isWorkflowMultiSelectMode,
  selectedWorkflows,
  handleToggleWorkflowSelection,
  handleSelectInstance,
  renamingWorkflowInstanceId,
  workflowRenameInput,
  setWorkflowRenameInput,
  handleConfirmWorkflowRename,
  handleCancelWorkflowRename,
  handleStartWorkflowRename,
  handleOpenWorkflowDeleteConfirm,
}: SidebarWorkflowListProps) {
  const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t('sidebar.justNow');
  if (diffMins < 60) return `${diffMins}${t('sidebar.minutesAgo')}`;
  if (diffHours < 24) return `${diffHours}${t('sidebar.hoursAgo')}`;
  if (diffDays < 7) return `${diffDays}${t('sidebar.daysAgo')}`;
  return date.toLocaleDateString();
};
  return (
    <>

            {/* Workflow Search */}
            <div className="px-4 pb-2 pt-1">
              <SearchInput
                value={workflowSearchQuery}
                onChange={setWorkflowSearchQuery}
                onClear={() => setWorkflowSearchQuery('')}
                placeholder={t('sidebar.searchWorkflows')}
              />
            </div>

            {filteredWorkflows !== null ? (
              // Search results
              <ul className="py-2 space-y-1 px-2">
                {filteredWorkflows.length === 0 ? (
                  <li className="px-3 py-4 text-xs text-gray-400 text-center">{t('sidebar.noResults')}</li>
                ) : (
                  filteredWorkflows.map((instance) => (
                    <li key={instance.id}>
                      <button
                        onClick={() => { handleSelectInstance(instance.id); setWorkflowSearchQuery(''); }}
                        className={`w-full px-3 py-3 text-left rounded-xl transition-all group ${instance.id === currentInstanceId
                            ? 'bg-gray-100 shadow-sm'
                            : 'hover:bg-gray-50'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-900 truncate text-sm">
                              {instance.name || t('sidebar.untitledWorkflow')}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-400">
                                {instance.agents.length} {t('sidebar.agentsLabel')}
                              </span>
                              <span className="text-xs text-gray-400">·</span>
                              <span className="text-xs text-gray-400">
                                {instance.workflowRuns.length} {t('sidebar.runsLabel')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : workflowInstances.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                <div className="mb-2 opacity-50">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  </svg>
                </div>
                <p>{t('sidebar.noWorkflows')}</p>
              </div>
            ) : (
              <ul className="py-2 space-y-1 px-2">
                {workflowInstances.map((instance) => (
                  <li key={instance.id}>
                    <button
                      onClick={() => isWorkflowMultiSelectMode ? handleToggleWorkflowSelection(instance.id) : handleSelectInstance(instance.id)}
                      className={`w-full px-3 py-3 text-left rounded-xl transition-all group ${instance.id === currentInstanceId
                          ? 'bg-gray-100 shadow-sm'
                          : 'hover:bg-gray-50'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        {/* Multi-select Checkbox */}
                        {isWorkflowMultiSelectMode && (
                          <div
                            className={`flex-shrink-0 w-5 h-5 rounded-md border-2 mr-2.5 flex items-center justify-center transition-all duration-200 cursor-pointer ${selectedWorkflows.has(instance.id)
                                ? 'bg-blue-600 border-blue-600 shadow-md shadow-blue-500/20'
                                : 'border-gray-300 group-hover:border-blue-400 group-hover:shadow-sm'
                              }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleWorkflowSelection(instance.id);
                            }}
                          >
                            {selectedWorkflows.has(instance.id) && (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          {renamingWorkflowInstanceId === instance.id ? (
                            <input
                              type="text"
                              value={workflowRenameInput}
                              onChange={(e) => setWorkflowRenameInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); handleConfirmWorkflowRename(); }
                                if (e.key === 'Escape') handleCancelWorkflowRename();
                              }}
                              onBlur={handleConfirmWorkflowRename}
                              autoFocus
                              className="w-full text-sm font-semibold text-gray-900 bg-white border border-blue-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          ) : (
                            <h3
                              className="font-semibold text-gray-900 truncate text-sm cursor-text hover:bg-gray-100 rounded px-1 -mx-1 transition-colors"
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                handleStartWorkflowRename(instance.id);
                              }}
                              title={t('sidebar.doubleClickToRename')}
                            >
                              {instance.name || t('sidebar.untitledWorkflow')}
                            </h3>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">
                              {instance.agents.length} {t('sidebar.agentsLabel')}
                            </span>
                            <span className="text-xs text-gray-400">·</span>
                            <span className="text-xs text-gray-400">
                              {instance.workflowRuns.length} {t('sidebar.runsLabel')}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDate(instance.updatedAt)}
                          </p>
                        </div>

                        {/* Actions + Status Icon */}
                        {!isWorkflowMultiSelectMode && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenWorkflowDeleteConfirm(instance.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400 hover:text-red-500"
                              title={t('sidebar.deleteWorkflow')}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </button>
                            {instance.activeRunId ? (
                              <svg className="h-4 w-4 text-blue-500 animate-pulse" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
                                <circle cx="10" cy="10" r="4" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

    </>
  );
}
