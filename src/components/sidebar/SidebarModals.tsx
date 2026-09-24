import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Session } from '@/types/chat';
import type { useChatStore } from '@/store';
import { t } from '@/i18n';

type Project = ReturnType<typeof useChatStore.getState>['projects'][number];
type ContextMenu = { type: 'session' | 'project'; id: string; x: number; y: number } | null;

interface SidebarModalsProps {
  showNewProjectModal: boolean;
  setShowNewProjectModal: Dispatch<SetStateAction<boolean>>;
  newProjectName: string;
  setNewProjectName: Dispatch<SetStateAction<string>>;
  handleCreateProject: () => void | Promise<void>;
  showMoveChatModal: boolean;
  setShowMoveChatModal: Dispatch<SetStateAction<boolean>>;
  sessionToMove: string | null;
  setSessionToMove: Dispatch<SetStateAction<string | null>>;
  sessions: Session[];
  targetProjectForMove: string | null;
  setTargetProjectForMove: Dispatch<SetStateAction<string | null>>;
  projects: Project[];
  handleMoveSession: () => void | Promise<void>;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: Dispatch<SetStateAction<boolean>>;
  setSessionToDelete: Dispatch<SetStateAction<string | null>>;
  handleConfirmDelete: () => void | Promise<void>;
  showWorkflowDeleteConfirm: boolean;
  setShowWorkflowDeleteConfirm: Dispatch<SetStateAction<boolean>>;
  isWorkflowMultiSelectMode: boolean;
  selectedWorkflows: Set<string>;
  setSelectedWorkflows: Dispatch<SetStateAction<Set<string>>>;
  setIsWorkflowMultiSelectMode: Dispatch<SetStateAction<boolean>>;
  setWorkflowInstanceToDelete: Dispatch<SetStateAction<string | null>>;
  handleConfirmBatchDeleteWorkflows: () => void | Promise<void>;
  handleConfirmWorkflowDelete: () => void;
  contextMenu: ContextMenu;
  handleDeleteProject: (projectId: string) => void | Promise<void>;
  renderSidebarModal: (isOpen: boolean, content: React.ReactNode) => React.ReactNode;
}

export function SidebarModals({
  showNewProjectModal,
  setShowNewProjectModal,
  newProjectName,
  setNewProjectName,
  handleCreateProject,
  showMoveChatModal,
  setShowMoveChatModal,
  sessionToMove,
  setSessionToMove,
  sessions,
  targetProjectForMove,
  setTargetProjectForMove,
  projects,
  handleMoveSession,
  showDeleteConfirm,
  setShowDeleteConfirm,
  setSessionToDelete,
  handleConfirmDelete,
  showWorkflowDeleteConfirm,
  setShowWorkflowDeleteConfirm,
  isWorkflowMultiSelectMode,
  selectedWorkflows,
  setSelectedWorkflows,
  setIsWorkflowMultiSelectMode,
  setWorkflowInstanceToDelete,
  handleConfirmBatchDeleteWorkflows,
  handleConfirmWorkflowDelete,
  contextMenu,
  handleDeleteProject,
  renderSidebarModal,
}: SidebarModalsProps) {
  return (
    <>
      {/* New Project Modal */}
      {renderSidebarModal(showNewProjectModal, (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={() => setShowNewProjectModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('sidebar.newProjectTitle')}</h3>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t('sidebar.projectName')}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateProject();
                if (e.key === 'Escape') setShowNewProjectModal(false);
              }}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowNewProjectModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreateProject}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
              >
                {t('common.create')}
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Move Chat Modal */}
      {renderSidebarModal(showMoveChatModal, (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={() => setShowMoveChatModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('sidebar.moveChat')}</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('sidebar.selectChat')}</label>
              <select
                value={sessionToMove || ''}
                onChange={(e) => setSessionToMove(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">{t('sidebar.selectChatPlaceholder')}</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title || t('sidebar.chatFallback')}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('sidebar.moveToProject')}</label>
              <select
                value={targetProjectForMove || ''}
                onChange={(e) => setTargetProjectForMove(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">{t('chat.noProjectRoot')}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowMoveChatModal(false);
                  setSessionToMove(null);
                  setTargetProjectForMove(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleMoveSession}
                disabled={!sessionToMove}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('common.move')}
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Delete Confirmation Modal */}
      {renderSidebarModal(showDeleteConfirm, (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('sidebar.deleteChat')}</h3>
            <p className="text-sm text-gray-600 mb-4">{t('sidebar.deleteConversationConfirm')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setSessionToDelete(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Workflow Delete Confirmation Modal */}
      {renderSidebarModal(showWorkflowDeleteConfirm, (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={() => setShowWorkflowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {isWorkflowMultiSelectMode
                ? `${t('sidebar.deleteWorkflows')} (${selectedWorkflows.size})`
                : t('sidebar.deleteWorkflow')}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {isWorkflowMultiSelectMode
                ? `${t('sidebar.deleteWorkflowsConfirm')} (${selectedWorkflows.size})`
                : t('sidebar.deleteWorkflowConfirm')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowWorkflowDeleteConfirm(false);
                  setWorkflowInstanceToDelete(null);
                  setSelectedWorkflows(new Set());
                  setIsWorkflowMultiSelectMode(false);
                }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={isWorkflowMultiSelectMode ? handleConfirmBatchDeleteWorkflows : handleConfirmWorkflowDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'project' && (
            <button
              onClick={() => handleDeleteProject(contextMenu.id)}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100"
            >
              {t('sidebar.deleteProject')}
            </button>
          )}
        </div>
      )}


    </>
  );
}
