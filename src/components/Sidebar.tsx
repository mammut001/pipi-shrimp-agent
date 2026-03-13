/**
 * Sidebar - Session list and navigation sidebar
 *
 * Features:
 * - Display all chat sessions
 * - Highlight active session
 * - Create new session
 * - Delete sessions
 */

import React, { useState } from 'react';
import { useChatStore, useUIStore } from '@/store';
import type { Session } from '@/types/chat';

/**
 * Helper to truncate path for display
 */
const truncatePath = (path: string, maxLength: number = 20): string => {
  if (path.length <= maxLength) return path;
  const parts = path.split('/');
  if (parts.length <= 2) return '...' + path.slice(-maxLength + 3);
  return '.../' + parts.slice(-2).join('/');
};

/**
 * Sidebar component
 */
export function Sidebar() {
  const { sessions, currentSessionId, selectSession, startSession, deleteSession, updateSessionCwd } = useChatStore();
  const { toggleSettings } = useUIStore();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [tempCwd, setTempCwd] = useState('');

  /**
   * Handle creating a new chat session
   */
  const handleNewChat = async () => {
    await startSession();
  };

  /**
   * Handle session selection
   */
  const handleSelectSession = (sessionId: string) => {
    selectSession(sessionId);
  };

  /**
   * Handle session deletion
   */
  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this conversation?')) {
      await deleteSession(sessionId);
    }
  };

  /**
   * Handle directory icon click - start editing cwd
   */
  const handleDirectoryClick = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setTempCwd(session.cwd || '');
  };

  /**
   * Handle directory input confirm
   */
  const handleDirectoryConfirm = async (sessionId: string) => {
    await updateSessionCwd(sessionId, tempCwd.trim());
    setEditingSessionId(null);
    setTempCwd('');
  };

  /**
   * Handle directory input cancel
   */
  const handleDirectoryCancel = () => {
    setEditingSessionId(null);
    setTempCwd('');
  };



  /**
   * Get session preview text
   */
  const getSessionPreview = (session: Session): string => {
    if (session.messages.length === 0) {
      return 'New conversation';
    }
    const lastMessage = session.messages[session.messages.length - 1];
    const preview = lastMessage.content.substring(0, 50);
    return preview + (lastMessage.content.length > 50 ? '...' : '');
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">AI Agent</h1>
          <div className="flex items-center gap-2">
            {/* Status Indicator or other top-right actions can go here */}
          </div>
        </div>

        {/* New Chat Button */}
        <button
          onClick={handleNewChat}
          className="w-full px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-all flex items-center justify-center gap-2 font-medium shadow-sm active:scale-[0.98]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
              clipRule="evenodd"
            />
          </svg>
          New Chat
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            <div className="mb-2 opacity-50">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p>No conversations yet</p>
          </div>
        ) : (
          <ul className="py-2 space-y-1 px-2">
            {sessions.map((session) => (
              <li key={session.id}>
                {editingSessionId === session.id ? (
                  // Directory input mode
                  <div className="px-3 py-2 bg-gray-100 rounded-xl" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 mb-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                      <span className="text-xs text-gray-500 font-medium">Working Directory</span>
                    </div>
                    <input
                      type="text"
                      value={tempCwd}
                      onChange={(e) => setTempCwd(e.target.value)}
                      placeholder="/path/to/workspace"
                      className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleDirectoryConfirm(session.id);
                        if (e.key === 'Escape') handleDirectoryCancel();
                      }}
                    />
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={() => handleDirectoryConfirm(session.id)}
                        className="flex-1 px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleDirectoryCancel}
                        className="flex-1 px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // Normal session display
                  <button
                    onClick={() => handleSelectSession(session.id)}
                    className={`w-full px-3 py-3 text-left rounded-xl transition-all group relative ${
                      session.id === currentSessionId
                        ? 'bg-gray-100 shadow-sm'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate text-sm">
                          {session.title || 'New Conversation'}
                        </h3>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {getSessionPreview(session)}
                        </p>
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
                        {/* Directory Button */}
                        <button
                          onClick={(e) => handleDirectoryClick(e, session)}
                          className={`opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-lg transition-all ${
                            session.cwd ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500'
                          }`}
                          title={session.cwd || 'Set working directory'}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                          </svg>
                        </button>

                        {/* Delete Button */}
                        <button
                          onClick={(e) => handleDeleteSession(e, session.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400 hover:text-red-500"
                          title="Delete conversation"
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
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer / User Profile & Settings */}
      <div className="p-4 border-t border-gray-100 bg-gray-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-sm ring-2 ring-white">
              <span className="font-bold text-sm">D</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate leading-none mb-1">Doge User</p>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider opacity-60">Personal Account</p>
            </div>
          </div>
          
          <button
            onClick={toggleSettings}
            className="p-2 rounded-xl hover:bg-white hover:shadow-md text-gray-500 hover:text-gray-900 transition-all active:scale-95"
            title="Settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default Sidebar;
