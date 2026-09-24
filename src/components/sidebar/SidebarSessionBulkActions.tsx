import React from 'react';
import type { Session } from '@/types/chat';
import { t } from '@/i18n';

interface SidebarSessionBulkActionsProps {
  isMultiSelectMode: boolean;
  setIsMultiSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedSessions: Set<string>;
  setSelectedSessions: React.Dispatch<React.SetStateAction<Set<string>>>;
  ungroupedSessions: Session[];
  handleSelectAll: () => void;
  handleBatchDelete: () => void;
  showBatchDeleteConfirm: boolean;
  setShowBatchDeleteConfirm: (show: boolean) => void;
  handleConfirmBatchDelete: () => void | Promise<void>;
  renderSidebarModal: (isOpen: boolean, content: React.ReactNode) => React.ReactNode;
}

export function SidebarSessionBulkActions({
  isMultiSelectMode,
  setIsMultiSelectMode,
  selectedSessions,
  setSelectedSessions,
  ungroupedSessions,
  handleSelectAll,
  handleBatchDelete,
  showBatchDeleteConfirm,
  setShowBatchDeleteConfirm,
  handleConfirmBatchDelete,
  renderSidebarModal,
}: SidebarSessionBulkActionsProps) {
  return (
    <>
      {/* Multi-select Toolbar - Premium Vercel Style */}
        {isMultiSelectMode && (
          <div className="transition-all duration-200 ease-out">
            {/* Multi-select toolbar — single compact row */}
            <div className="mx-2 px-2.5 py-2 rounded-xl
                            bg-white border border-gray-200
                            shadow-sm overflow-hidden
                            flex items-center gap-2"
            >
              {/* Cancel / exit multi-select */}
              <button
                onClick={() => { setIsMultiSelectMode(false); setSelectedSessions(new Set()); }}
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center
                           rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100
                           active:scale-95 transition-all duration-150"
                title={t('sidebar.exitSelection')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Count */}
              <span className="text-xs font-semibold text-gray-700 tabular-nums whitespace-nowrap">
                {selectedSessions.size} {t('sidebar.selected')}
              </span>

              {/* Right-side actions — ml-auto keeps them in-container */}
              <div className="ml-auto flex-shrink-0 flex items-center gap-1.5">
                {/* Select All / Deselect All */}
                <button
                  onClick={handleSelectAll}
                  className="px-2 py-1 text-[11px] font-semibold text-gray-600
                             bg-gray-100 hover:bg-gray-200
                             active:scale-95 rounded-lg transition-all duration-150 whitespace-nowrap"
                >
                  {ungroupedSessions.every(s => selectedSessions.has(s.id)) && selectedSessions.size > 0
                    ? t('common.none') : t('common.all')}
                </button>

                {/* Delete */}
                <button
                  onClick={handleBatchDelete}
                  disabled={selectedSessions.size === 0}
                  className="px-2 py-1 text-[11px] font-bold
                             flex items-center gap-1 rounded-lg
                             transition-all duration-150 active:scale-95
                             disabled:opacity-40 disabled:cursor-not-allowed
                             text-red-600 bg-red-50 hover:bg-red-100 border border-red-100/80"
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

      {/* Batch Delete Confirmation Modal */}
      {renderSidebarModal(showBatchDeleteConfirm, (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={() => setShowBatchDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('sidebar.deleteChats')}</h3>
            <p className="text-sm text-gray-600 mb-4">
              {t('sidebar.deleteConversationsConfirm')} ({selectedSessions.size})
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmBatchDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
