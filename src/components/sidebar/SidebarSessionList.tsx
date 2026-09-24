import React from 'react';
import { SearchInput } from '@/components/ui';
import { t } from '@/i18n';
import type { Project, Session } from '@/types/chat';
import { formatTokenCount } from '@/utils/chat';
import { formatCostCompact } from '@/utils/pricing';

const truncatePath = (path: string, maxLength: number = 20): string => {
  if (path.length <= maxLength) return path;
  const parts = path.split('/');
  if (parts.length <= 2) return '...' + path.slice(-maxLength + 3);
  return '.../' + parts.slice(-2).join('/');
};

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

interface SidebarSessionListProps {
  currentSessionId: string | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredSessions: Session[] | null;
  sessions: Session[];
  ungroupedSessions: Session[];
  isMultiSelectMode: boolean;
  selectedSessions: Set<string>;
  handleToggleSessionSelection: (sessionId: string) => void;
  handleSelectSession: (sessionId: string) => void;
  getSessionPreview: (session: Session) => string;
  renamingSessionId: string | null;
  renameInput: string;
  setRenameInput: (value: string) => void;
  handleConfirmRename: () => void | Promise<void>;
  handleCancelRename: () => void;
  handleStartRename: (sessionId: string) => void;
  tokenUsageMap: Map<string, TokenUsage>;
  sessionCostMap: Map<string, number>;
  handleOpenMoveChatModal: (sessionId: string) => void;
  handleOpenDeleteConfirm: (sessionId: string) => void;
  projects: Project[];
  expandedProjects: Set<string>;
  toggleProject: (projectId: string) => void;
  getSessionsByProject: (projectId: string) => Session[];
  handleContextMenu: (event: React.MouseEvent, type: 'session' | 'project', id: string) => void;
  setShowNewProjectModal: React.Dispatch<React.SetStateAction<boolean>>;
}

export function SidebarSessionList({
  currentSessionId,
  searchQuery,
  setSearchQuery,
  filteredSessions,
  sessions,
  ungroupedSessions,
  isMultiSelectMode,
  selectedSessions,
  handleToggleSessionSelection,
  handleSelectSession,
  getSessionPreview,
  renamingSessionId,
  renameInput,
  setRenameInput,
  handleConfirmRename,
  handleCancelRename,
  handleStartRename,
  tokenUsageMap,
  sessionCostMap,
  handleOpenMoveChatModal,
  handleOpenDeleteConfirm,
  projects,
  expandedProjects,
  toggleProject,
  getSessionsByProject,
  handleContextMenu,
  setShowNewProjectModal,
}: SidebarSessionListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-4 pb-2 pt-1">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          onClear={() => setSearchQuery('')}
          placeholder={t('sidebar.searchChats')}
        />
      </div>

      {/* Search results panel */}
      {filteredSessions !== null && (
        <ul className="py-2 space-y-1 px-2">
          {filteredSessions.length === 0 ? (
            <li className="px-3 py-4 text-xs text-gray-400 text-center">{t('sidebar.noResults')}</li>
          ) : (
            filteredSessions.map((session) => (
              <li key={session.id}>
                <button
                  onClick={() => { handleSelectSession(session.id); setSearchQuery(''); }}
                  className={`w-full px-3 py-2 text-left rounded-xl transition-all group relative ${
                    session.id === currentSessionId ? 'bg-gray-100 shadow-sm' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate text-sm">
                        {session.title || t('sidebar.chatFallback')}
                      </h3>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {getSessionPreview(session)}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {/* Sessions List - show empty state OR sessions (hidden when search is active) */}
      {filteredSessions === null && (sessions.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          <div className="mb-2 opacity-50">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p>{t('sidebar.noConversations')}</p>
        </div>
      ) : (
        <ul className="py-2 space-y-1 px-2">
          {/* Ungrouped Sessions */}
          {ungroupedSessions.length > 0 && (
            <>
              {ungroupedSessions.map((session) => (
              <li key={session.id}>
                <button
                  onClick={() => isMultiSelectMode ? handleToggleSessionSelection(session.id) : handleSelectSession(session.id)}
                  className={`w-full px-3 py-2 text-left rounded-xl transition-all group relative ${session.id === currentSessionId
                      ? 'bg-gray-100 shadow-sm'
                      : 'hover:bg-gray-50'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {/* Multi-select Checkbox - Vercel Style */}
                    {isMultiSelectMode && (
                      <div
                        className={`flex-shrink-0 w-5 h-5 rounded-md border-2 mr-2.5 flex items-center justify-center transition-all duration-200 cursor-pointer ${selectedSessions.has(session.id)
                            ? 'bg-blue-600 border-blue-600 shadow-md shadow-blue-500/20'
                            : 'border-gray-300 group-hover:border-blue-400 group-hover:shadow-sm'
                          }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSessionSelection(session.id);
                        }}
                      >
                        {selectedSessions.has(session.id) && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {renamingSessionId === session.id ? (
                        <input
                          type="text"
                          value={renameInput}
                          onChange={(e) => setRenameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleConfirmRename(); }
                            if (e.key === 'Escape') handleCancelRename();
                          }}
                          onBlur={handleConfirmRename}
                          autoFocus
                          className="w-full text-sm font-semibold text-gray-900 bg-white border border-blue-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        <h3
                          className="font-semibold text-gray-900 truncate text-sm cursor-text hover:bg-gray-100 rounded px-1 -mx-1 transition-colors"
                          onDoubleClick={() => handleStartRename(session.id)}
                          title={t('sidebar.doubleClickToRename')}
                        >
                          {session.title || t('sidebar.chatFallback')}
                          {session.workDir && (
                            <span title={session.workDir} className="inline-flex">
                              <svg
                                className="w-3 h-3 text-gray-400 flex-shrink-0 inline ml-1"
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                              </svg>
                            </span>
                          )}
                        </h3>
                      )}
                      {/* Token usage display */}
                      {(tokenUsageMap.get(session.id)?.total ?? 0) > 0 && (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5 flex items-center gap-1">
                          {sessionCostMap.has(session.id) ? (
                            <span className="text-green-600 font-medium">
                              {formatCostCompact(sessionCostMap.get(session.id) ?? 0)}
                            </span>
                          ) : null}
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                          </svg>
                          <span>{formatTokenCount(tokenUsageMap.get(session.id)?.total ?? 0)} {t('token.tokens')}</span>
                        </p>
                      )}
                      {session.cwd && (
                        <p className="text-[10px] text-blue-600 truncate mt-0.5 flex items-center gap-1" title={session.cwd}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                          </svg>
                          {truncatePath(session.cwd)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Move Chat Button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenMoveChatModal(session.id); }}
                        className={`opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-lg transition-all ${session.cwd ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500'
                          }`}
                        title={t('sidebar.moveToProjectAction')}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 7H8a1 1 0 100 2z" />
                          <path d="M3 9a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1V9z" />
                        </svg>
                      </button>

                      {/* Delete Button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenDeleteConfirm(session.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400 hover:text-red-500"
                        title={t('sidebar.deleteChatAction')}
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
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </>
        )}
        </ul>
      ))}

      {/* Projects Section - always show, even when no sessions */}
      <ul className="py-2 space-y-1 px-2 mt-auto">
          <li className="pt-4 pb-2">
            <div className="flex items-center justify-between px-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('sidebar.projects')}</h2>
              <button
                onClick={() => setShowNewProjectModal(true)}
                className="p-1 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                title={t('sidebar.newProjectAction')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </li>

          {/* Project List */}
          {projects.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-400">{t('sidebar.noProjectsYet')}</li>
          ) : (
            projects.map((project) => (
              <li key={project.id}>
                {/* Project Header */}
                <button
                  onClick={() => toggleProject(project.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'project', project.id)}
                  className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-50 rounded-xl transition-colors group"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-4 w-4 text-gray-400 transition-transform ${expandedProjects.has(project.id) ? 'rotate-90' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700 truncate flex-1">{project.name}</span>
                  <span className="text-xs text-gray-400">{getSessionsByProject(project.id).length}</span>
                </button>

                {/* Project Sessions */}
                {expandedProjects.has(project.id) && (
                  <ul className="ml-6 space-y-1 mt-1">
                    {[...getSessionsByProject(project.id)].map((session) => (
                      <li key={session.id}>
                        <button
                          onClick={() => isMultiSelectMode ? handleToggleSessionSelection(session.id) : handleSelectSession(session.id)}
                          onContextMenu={(e) => handleContextMenu(e, 'session', session.id)}
                          className={`w-full px-3 py-1.5 text-left rounded-xl transition-all group relative ${session.id === currentSessionId
                              ? 'bg-gray-100 shadow-sm'
                              : 'hover:bg-gray-50'
                            }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            {/* Multi-select Checkbox - Vercel Style */}
                            {isMultiSelectMode && (
                              <div
                                className={`flex-shrink-0 w-5 h-5 rounded-md border-2 mr-2.5 flex items-center justify-center transition-all duration-200 cursor-pointer ${selectedSessions.has(session.id)
                                    ? 'bg-blue-600 border-blue-600 shadow-md shadow-blue-500/20'
                                    : 'border-gray-300 group-hover:border-blue-400 group-hover:shadow-sm'
                                  }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleSessionSelection(session.id);
                                }}
                              >
                                {selectedSessions.has(session.id) && (
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <h3
                                className="font-semibold text-gray-900 truncate text-sm cursor-text hover:bg-gray-100 rounded px-1 -mx-1 transition-colors"
                                onDoubleClick={() => handleStartRename(session.id)}
                                title={t('sidebar.doubleClickToRename')}
                              >
                                {session.title || t('sidebar.chatFallback')}
                              </h3>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenMoveChatModal(session.id); }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400 hover:text-blue-500"
                                title={t('sidebar.moveToProjectAction')}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
  );
}
