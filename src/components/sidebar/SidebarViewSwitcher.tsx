import React, { type Dispatch, type SetStateAction } from 'react';
import type { useUIStore } from '@/store';

type CurrentView = ReturnType<typeof useUIStore.getState>['currentView'];
type SetCurrentView = ReturnType<typeof useUIStore.getState>['setCurrentView'];

interface SidebarViewSwitcherProps {
  currentView: CurrentView;
  setCurrentView: SetCurrentView;
  sessionCount: number;
  workflowCount: number;
  isMultiSelectMode: boolean;
  setIsMultiSelectMode: Dispatch<SetStateAction<boolean>>;
  setSelectedSessions: Dispatch<SetStateAction<Set<string>>>;
  isWorkflowMultiSelectMode: boolean;
  setIsWorkflowMultiSelectMode: Dispatch<SetStateAction<boolean>>;
  setSelectedWorkflows: Dispatch<SetStateAction<Set<string>>>;
}

export function SidebarViewSwitcher({
  currentView,
  setCurrentView,
  sessionCount,
  workflowCount,
  isMultiSelectMode,
  setIsMultiSelectMode,
  setSelectedSessions,
  isWorkflowMultiSelectMode,
  setIsWorkflowMultiSelectMode,
  setSelectedWorkflows,
}: SidebarViewSwitcherProps) {
  return (
    <>
        {/* View Toggle - Modern Pill Style with Better Spacing */}
        <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl mt-2 mb-4">
          <button
            onClick={() => setCurrentView('chat')}
            className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${currentView === 'chat'
                ? 'bg-white text-gray-900 shadow-md'
                : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            {t('nav.chat')}
          </button>
          <button
            onClick={() => setCurrentView('workflow')}
            className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${currentView === 'workflow'
                ? 'bg-white text-gray-900 shadow-md'
                : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            {t('nav.workflow')}
          </button>
          <button
            onClick={() => setCurrentView('diagnostics')}
            className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${currentView === 'diagnostics'
                ? 'bg-white text-gray-900 shadow-md'
                : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            {t('nav.diagnostics')}
          </button>
          {/* Chat Multi-select Button */}
          {currentView === 'chat' && (
            <button
              onClick={() => {
                if (sessionCount === 0) return;
                setIsMultiSelectMode(!isMultiSelectMode);
                if (isMultiSelectMode) {
                  setSelectedSessions(new Set());
                }
              }}
              disabled={sessionCount === 0}
              className={`ml-auto px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${isMultiSelectMode
                  ? 'bg-blue-100 text-blue-700 shadow-sm ring-1 ring-blue-300'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-200/50 active:bg-gray-200'
                }`}
              title={isMultiSelectMode ? t('sidebar.exitSelection') : t('sidebar.select')}
            >
              {isMultiSelectMode ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {t('sidebar.selecting')}
                </span>
              ) : (
                t('sidebar.select')
              )}
            </button>
          )}
          {/* Workflow Multi-select Button */}
          {currentView === 'workflow' && (
            <button
              onClick={() => {
                if (workflowCount === 0) return;
                setIsWorkflowMultiSelectMode(!isWorkflowMultiSelectMode);
                if (isWorkflowMultiSelectMode) {
                  setSelectedWorkflows(new Set());
                }
              }}
              disabled={workflowCount === 0}
              className={`ml-auto px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${isWorkflowMultiSelectMode
                  ? 'bg-blue-100 text-blue-700 shadow-sm ring-1 ring-blue-300'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-200/50 active:bg-gray-200'
                }`}
              title={isWorkflowMultiSelectMode ? t('sidebar.exitSelection') : t('sidebar.select')}
            >
              {isWorkflowMultiSelectMode ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {t('sidebar.selecting')}
                </span>
              ) : (
                t('sidebar.select')
              )}
            </button>
          )}
        </div>

    </>
  );
}
