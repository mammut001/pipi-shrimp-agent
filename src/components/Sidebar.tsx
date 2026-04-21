/**
 * Sidebar - Session list and navigation sidebar
 *
 * Features:
 * - Display all chat sessions
 * - Highlight active session
 * - Create new session
 * - Delete sessions
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useChatStore, useUIStore, useWorkflowStore, useSettingsStore } from '@/store';
import type { Session } from '@/types/chat';
import { t } from '@/i18n';
import { getProvider } from '@/shared/providers';
import { calculateRequestCost, formatCostCompact } from '@/utils/pricing';
import { getSessionTokenUsage, formatTokenCount } from '@/utils/chat';
import { invoke } from '@tauri-apps/api/core';
import { workflowEngine } from '@/services/workflowEngine';
import { SearchInput } from '@/components/ui';


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
  // Zustand selectors for data (prevents re-renders on unrelated state changes)
  const sessions = useChatStore((s) => s.sessions);
  const projects = useChatStore((s) => s.projects);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  // Functions are stable references, safe to destructure
  const { selectSession, deleteSession, deleteSessions, createProject, deleteProject, getSessionsByProject, updateSessionProject, startSession, renameSession } = useChatStore();
  const { toggleSettings, currentView, setCurrentView } = useUIStore();
  const workflowInstances = useWorkflowStore((s) => s.instances);
  const currentInstanceId = useWorkflowStore((s) => s.currentInstanceId);
  const { renameInstance, deleteInstance, deleteInstances, selectInstance } = useWorkflowStore();

  // Pricing helpers
  const getModelPricing = useSettingsStore((s) => s.getModelPricing);
  const apiConfigs = useSettingsStore((s) => s.apiConfigs);
  const activeConfigId = useSettingsStore((s) => s.activeConfigId);

  // Footer profile info (derived from active API config; fallback to first config)
  const activeApiConfig = useMemo(
    () => apiConfigs.find((c) => c.id === activeConfigId) || apiConfigs[0] || null,
    [apiConfigs, activeConfigId],
  );
  const profileName = activeApiConfig?.name?.trim() || 'Local User';
  const providerLabel = activeApiConfig
    ? (getProvider(activeApiConfig.provider)?.label ?? activeApiConfig.provider)
    : null;
  const profileSubtitle = providerLabel ? `${providerLabel} Account` : 'No API Config';
  const profileInitial = (profileName.charAt(0) || 'U').toUpperCase();

  // Projects state
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('sidebar_expanded_projects');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ type: 'session' | 'project'; id: string; x: number; y: number } | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Workflow search state
  const [workflowSearchQuery, setWorkflowSearchQuery] = useState('');

  // Move session modal state
  const [showMoveChatModal, setShowMoveChatModal] = useState(false);
  const [sessionToMove, setSessionToMove] = useState<string | null>(null);
  const [targetProjectForMove, setTargetProjectForMove] = useState<string | null>(null);

  // Delete session confirm state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showWorkflowDeleteConfirm, setShowWorkflowDeleteConfirm] = useState(false);
  const [workflowInstanceToDelete, setWorkflowInstanceToDelete] = useState<string | null>(null);

  // Rename session state
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [renamingWorkflowInstanceId, setRenamingWorkflowInstanceId] = useState<string | null>(null);
  const [workflowRenameInput, setWorkflowRenameInput] = useState('');

  // New Chat modal state
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [selectedProjectForNewChat, setSelectedProjectForNewChat] = useState<string | null>(null);

  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());

  // Workflow multi-select state
  const [isWorkflowMultiSelectMode, setIsWorkflowMultiSelectMode] = useState(false);
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());

  // Get sessions without a project (show in original store order, which is typically newest first)
  const ungroupedSessions = useMemo(
    () => [...getSessionsByProject(null)].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, getSessionsByProject]
  );

  // Filtered sessions (all sessions) for search results
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return null; // null = no filter active
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [sessions, searchQuery]);

  // Filtered workflow instances for search results
  const filteredWorkflows = useMemo(() => {
    if (!workflowSearchQuery.trim()) return null;
    const q = workflowSearchQuery.toLowerCase();
    return workflowInstances.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.agents.some((a) => a.name.toLowerCase().includes(q)),
    );
  }, [workflowInstances, workflowSearchQuery]);

  // Memoized token usage map for all sessions
  const tokenUsageMap = useMemo(() => {
    const map = new Map<string, { input: number; output: number; total: number }>();
    for (const session of sessions) {
      map.set(session.id, getSessionTokenUsage(session));
    }
    return map;
  }, [sessions]);

  // Memoized cost map for all sessions
  const sessionCostMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      const usage = tokenUsageMap.get(session.id);
      if (!usage || usage.total === 0) continue;

      // Get pricing for session's model (prefer the matching config, then active config, then first config)
      const matchingConfig = session.model
        ? apiConfigs.find((c) => c.model === session.model)
        : null;
      const fallbackConfig = matchingConfig || activeApiConfig || apiConfigs[0] || null;
      const model = session.model || fallbackConfig?.model;
      const provider = fallbackConfig?.modelProviderId || fallbackConfig?.provider;

      if (model && provider) {
        const pricing = getModelPricing(model, provider);
        if (pricing) {
          const cost = calculateRequestCost(usage.input, usage.output, pricing);
          map.set(session.id, cost);
        }
      }
    }
    return map;
  }, [sessions, tokenUsageMap, apiConfigs, activeApiConfig, getModelPricing]);

  /**
   * Handle creating a new project
   */
  const handleCreateProject = async () => {
    if (newProjectName.trim()) {
      await createProject(newProjectName.trim());
      setNewProjectName('');
      setShowNewProjectModal(false);
    }
  };

  /**
   * Handle creating a new chat with project selection
   */
  const handleNewChat = () => {
    startSession(selectedProjectForNewChat || undefined);
    setShowNewChatModal(false);
    setSelectedProjectForNewChat(null);
  };

  /**
   * Open new chat modal
   */
  const openNewChatModal = useCallback(() => {
    setSelectedProjectForNewChat(null);
    setShowNewChatModal(true);
  }, []);

  /**
   * Create a new blank workflow with a pre-assigned working directory.
   * Stops any in-progress execution first to avoid stale state.
   */
  const handleNewWorkflow = useCallback(async () => {
    const { clearCanvas, addWorkflowRun, setRunning } = useWorkflowStore.getState();
    // Stop any in-progress run first so we don't leave isRunning/currentRunningAgentId stale
    if (workflowEngine.getIsRunning()) {
      await workflowEngine.stop();
    }
    clearCanvas();
    setRunning(false, null);
    workflowEngine.reset();
    const runId = crypto.randomUUID();
    try {
      const dir = await invoke<string>('create_workflow_run_directory', { runId });
      workflowEngine.setWorkingDirectory(dir);
      // Add an idle run entry so it appears in the history list
      addWorkflowRun({
        id: runId,
        title: '新工作流',
        projectGoal: '',
        status: 'idle',
        startTime: Date.now(),
        agents: [],
        runDirectory: dir,
      });
      useUIStore.getState().addNotification('success', `新工作流已创建`);
    } catch (e) {
      console.warn('Failed to create workflow directory:', e);
    }
  }, []);

  /**
   * Toggle project expansion
   */
  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      try {
        localStorage.setItem('sidebar_expanded_projects', JSON.stringify([...newSet]));
      } catch (err) {
        console.warn('Failed to persist sidebar expanded projects:', err);
      }
      return newSet;
    });
  }, []);

  /**
   * Handle delete project
   */
  const handleDeleteProject = useCallback(async (projectId: string) => {
    if (confirm('Are you sure you want to delete this project and all its conversations?')) {
      await deleteProject(projectId);
    }
    setContextMenu(null);
  }, [deleteProject]);

  /**
   * Handle opening move chat modal
   */
  const handleOpenMoveChatModal = useCallback((sessionId: string) => {
    setSessionToMove(sessionId);
    setTargetProjectForMove(null);
    setShowMoveChatModal(true);
  }, []);

  /**
   * Handle moving session to a project
   */
  const handleMoveSession = useCallback(async () => {
    if (sessionToMove) {
      await updateSessionProject(sessionToMove, targetProjectForMove || null);
      setShowMoveChatModal(false);
      setSessionToMove(null);
      setTargetProjectForMove(null);
    }
  }, [sessionToMove, targetProjectForMove, updateSessionProject]);

  /**
   * Handle opening delete confirmation
   */
  const handleOpenDeleteConfirm = useCallback((sessionId: string) => {
    setSessionToDelete(sessionId);
    setShowDeleteConfirm(true);
  }, []);

  /**
   * Handle confirming delete
   */
  const handleConfirmDelete = useCallback(async () => {
    if (sessionToDelete) {
      try {
        await deleteSession(sessionToDelete);
        setShowDeleteConfirm(false);
        setSessionToDelete(null);
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
  }, [sessionToDelete, deleteSession]);

  /**
   * Handle toggle session selection in multi-select mode
   */
  const handleToggleSessionSelection = useCallback((sessionId: string) => {
    setSelectedSessions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  }, []);

  /**
   * Handle select all sessions - only selects ungrouped sessions (not in any project)
   */
  const handleSelectAll = useCallback(() => {
    const ungroupedIds = ungroupedSessions.map(s => s.id);
    const allUngroupedSelected = ungroupedIds.every(id => selectedSessions.has(id));
    if (allUngroupedSelected && selectedSessions.size > 0) {
      setSelectedSessions(new Set());
    } else {
      setSelectedSessions(new Set(ungroupedIds));
    }
  }, [ungroupedSessions, selectedSessions]);

  /**
   * Handle batch delete selected sessions
   */
  const handleBatchDelete = useCallback(() => {
    if (selectedSessions.size > 0) {
      setShowBatchDeleteConfirm(true);
    }
  }, [selectedSessions]);

  /**
   * Confirm batch delete
   */
  const handleConfirmBatchDelete = useCallback(async () => {
    try {
      await deleteSessions(Array.from(selectedSessions));
      setSelectedSessions(new Set());
      setIsMultiSelectMode(false);
      setShowBatchDeleteConfirm(false);
    } catch (error) {
      console.error('Failed to batch delete sessions:', error);
    }
  }, [selectedSessions, deleteSessions]);

  /**
   * Handle toggle workflow selection in multi-select mode
   */
  const handleToggleWorkflowSelection = useCallback((instanceId: string) => {
    setSelectedWorkflows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(instanceId)) {
        newSet.delete(instanceId);
      } else {
        newSet.add(instanceId);
      }
      return newSet;
    });
  }, []);

  /**
   * Handle select all / deselect all workflows
   */
  const handleWorkflowSelectAll = useCallback(() => {
    const workflowIds = workflowInstances.map(i => i.id);
    const allSelected = workflowIds.every(id => selectedWorkflows.has(id));
    if (allSelected && selectedWorkflows.size > 0) {
      setSelectedWorkflows(new Set());
    } else {
      setSelectedWorkflows(new Set(workflowIds));
    }
  }, [workflowInstances, selectedWorkflows]);

  /**
   * Handle batch delete selected workflows
   */
  const handleBatchDeleteWorkflows = useCallback(() => {
    if (selectedWorkflows.size > 0) {
      setShowWorkflowDeleteConfirm(true);
    }
  }, [selectedWorkflows]);

  /**
   * Confirm batch delete workflows
   */
  const handleConfirmBatchDeleteWorkflows = useCallback(() => {
    deleteInstances(Array.from(selectedWorkflows));
    setSelectedWorkflows(new Set());
    setIsWorkflowMultiSelectMode(false);
    setShowWorkflowDeleteConfirm(false);
  }, [selectedWorkflows, deleteInstances]);

  /**
   * Handle context menu
   */
  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'session' | 'project', id: string) => {
    e.preventDefault();
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  }, []);

  /**
   * Close context menu
   */
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  /**
   * Start renaming a session
   */
  const handleStartRename = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setRenamingSessionId(sessionId);
      setRenameInput(session.title);
      setContextMenu(null);
    }
  }, [sessions]);

  /**
   * Confirm rename
   */
  const handleConfirmRename = useCallback(async () => {
    if (renamingSessionId && renameInput.trim()) {
      await renameSession(renamingSessionId, renameInput.trim());
    }
    setRenamingSessionId(null);
    setRenameInput('');
  }, [renamingSessionId, renameInput, renameSession]);

  /**
   * Cancel rename
   */
  const handleCancelRename = useCallback(() => {
    setRenamingSessionId(null);
    setRenameInput('');
  }, []);

  /**
   * Handle workflow instance selection
   */
  const handleSelectInstance = useCallback((instanceId: string) => {
    selectInstance(instanceId);
  }, [selectInstance]);

  const handleStartWorkflowRename = useCallback((instanceId: string) => {
    const instance = workflowInstances.find((i) => i.id === instanceId);
    if (instance) {
      setRenamingWorkflowInstanceId(instanceId);
      setWorkflowRenameInput(instance.name || 'Untitled Workflow');
    }
  }, [workflowInstances]);

  const handleConfirmWorkflowRename = useCallback(() => {
    if (renamingWorkflowInstanceId && workflowRenameInput.trim()) {
      renameInstance(renamingWorkflowInstanceId, workflowRenameInput.trim());
    }
    setRenamingWorkflowInstanceId(null);
    setWorkflowRenameInput('');
  }, [renamingWorkflowInstanceId, workflowRenameInput, renameInstance]);

  const handleCancelWorkflowRename = useCallback(() => {
    setRenamingWorkflowInstanceId(null);
    setWorkflowRenameInput('');
  }, []);

  const handleOpenWorkflowDeleteConfirm = useCallback((instanceId: string) => {
    setWorkflowInstanceToDelete(instanceId);
    setShowWorkflowDeleteConfirm(true);
  }, []);

  const handleConfirmWorkflowDelete = useCallback(() => {
    if (!workflowInstanceToDelete) return;

    deleteInstance(workflowInstanceToDelete);
    setShowWorkflowDeleteConfirm(false);
    setWorkflowInstanceToDelete(null);
  }, [deleteInstance, workflowInstanceToDelete]);

  /**
   * Format date for display
   */
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  /**
   * Handle session selection
   */
  const handleSelectSession = (sessionId: string) => {
    selectSession(sessionId);
  };

  /**
   * Get session preview text
   */
  const getSessionPreview = (session: Session): string => {
    if (session.messages.length === 0) {
      return 'Chat';
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
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">🦐 PiPi Shrimp Agent</h1>
          <div className="flex items-center gap-2">
            {/* Status Indicator or other top-right actions can go here */}
          </div>
        </div>

        {/* New Chat / New Workflow Button (context-aware) */}
        <button
          onClick={currentView === 'workflow' ? handleNewWorkflow : openNewChatModal}
          className="w-full px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-all flex items-center justify-center gap-2 font-medium shadow-sm active:scale-[0.98]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          {currentView === 'workflow' ? '新工作流' : t('nav.newChat')}
        </button>

        {/* Skill Button - Opens Skill Market */}
        <button
          onClick={() => setCurrentView('skill')}
          className="w-full px-4 py-2 mt-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-all flex items-center justify-center gap-2 font-medium shadow-sm active:scale-[0.98]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
          </svg>
          {t('nav.skill')}
        </button>

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
          {/* Chat Multi-select Button */}
          {currentView === 'chat' && (
            <button
              onClick={() => {
                if (sessions.length === 0) return;
                setIsMultiSelectMode(!isMultiSelectMode);
                if (isMultiSelectMode) {
                  setSelectedSessions(new Set());
                }
              }}
              disabled={sessions.length === 0}
              className={`ml-auto px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${isMultiSelectMode
                  ? 'bg-blue-100 text-blue-700 shadow-sm ring-1 ring-blue-300'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-200/50 active:bg-gray-200'
                }`}
              title={isMultiSelectMode ? 'Exit multi-select' : 'Multi-select'}
            >
              {isMultiSelectMode ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Selecting
                </span>
              ) : (
                'Select'
              )}
            </button>
          )}
          {/* Workflow Multi-select Button */}
          {currentView === 'workflow' && (
            <button
              onClick={() => {
                if (workflowInstances.length === 0) return;
                setIsWorkflowMultiSelectMode(!isWorkflowMultiSelectMode);
                if (isWorkflowMultiSelectMode) {
                  setSelectedWorkflows(new Set());
                }
              }}
              disabled={workflowInstances.length === 0}
              className={`ml-auto px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${isWorkflowMultiSelectMode
                  ? 'bg-blue-100 text-blue-700 shadow-sm ring-1 ring-blue-300'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-200/50 active:bg-gray-200'
                }`}
              title={isWorkflowMultiSelectMode ? 'Exit multi-select' : 'Multi-select'}
            >
              {isWorkflowMultiSelectMode ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Selecting
                </span>
              ) : (
                'Select'
              )}
            </button>
          )}
        </div>

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
                title="Exit selection"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Count */}
              <span className="text-xs font-semibold text-gray-700 tabular-nums whitespace-nowrap">
                {selectedSessions.size} selected
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
                    ? 'None' : 'All'}
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
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Workflow Multi-select Toolbar */}
        {isWorkflowMultiSelectMode && (
          <div className="transition-all duration-200 ease-out">
            <div className="mx-2 px-2.5 py-2 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden flex items-center gap-2">
              {/* Cancel / exit multi-select */}
              <button
                onClick={() => { setIsWorkflowMultiSelectMode(false); setSelectedWorkflows(new Set()); }}
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:scale-95 transition-all duration-150"
                title="Exit selection"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Count */}
              <span className="text-xs font-semibold text-gray-700 tabular-nums whitespace-nowrap">
                {selectedWorkflows.size} selected
              </span>

              {/* Right-side actions */}
              <div className="ml-auto flex-shrink-0 flex items-center gap-1.5">
                {/* Select All / None */}
                <button
                  onClick={handleWorkflowSelectAll}
                  className="px-2 py-1 text-[11px] font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 active:scale-95 rounded-lg transition-all duration-150 whitespace-nowrap"
                >
                  {workflowInstances.every(i => selectedWorkflows.has(i.id)) && selectedWorkflows.size > 0
                    ? 'None' : 'All'}
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
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Session/Run List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" onClick={closeContextMenu}>
        {currentView === 'chat' ? (
          // Chat Sessions - wrap everything in Fragment
          <div className="flex flex-col h-full">
            {/* Search */}
            <div className="px-4 pb-2 pt-1">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                onClear={() => setSearchQuery('')}
                placeholder="Search chats..."
              />
            </div>

            {/* Search results panel */}
            {filteredSessions !== null && (
              <ul className="py-2 space-y-1 px-2">
                {filteredSessions.length === 0 ? (
                  <li className="px-3 py-4 text-xs text-gray-400 text-center">No results</li>
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
                              {session.title || 'Chat'}
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
                <p>No conversations yet</p>
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
                                title="Double-click to rename"
                              >
                                {session.title || 'Chat'}
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
                                <span>{formatTokenCount(tokenUsageMap.get(session.id)?.total ?? 0)} tokens</span>
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
                              title="Move to project"
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
                              title="Delete chat"
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
                    <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Projects</h2>
                    <button
                      onClick={() => setShowNewProjectModal(true)}
                      className="p-1 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                      title="New Project"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </li>

                {/* Project List */}
                {projects.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-gray-400">No projects yet</li>
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
                                      title="Double-click to rename"
                                    >
                                      {session.title || 'Chat'}
                                    </h3>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleOpenMoveChatModal(session.id); }}
                                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-lg transition-all text-gray-400 hover:text-blue-500"
                                      title="Move to project"
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
          )
        : (
          // Workflow Instances
          <>
            {/* Workflow Search */}
            <div className="px-4 pb-2 pt-1">
              <SearchInput
                value={workflowSearchQuery}
                onChange={setWorkflowSearchQuery}
                onClear={() => setWorkflowSearchQuery('')}
                placeholder="Search workflows..."
              />
            </div>

            {filteredWorkflows !== null ? (
              // Search results
              <ul className="py-2 space-y-1 px-2">
                {filteredWorkflows.length === 0 ? (
                  <li className="px-3 py-4 text-xs text-gray-400 text-center">No results</li>
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
                              {instance.name || 'Untitled Workflow'}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-400">
                                {instance.agents.length} agents
                              </span>
                              <span className="text-xs text-gray-400">·</span>
                              <span className="text-xs text-gray-400">
                                {instance.workflowRuns.length} runs
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
                <p>No workflows yet</p>
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
                              title="Double-click to rename"
                            >
                              {instance.name || 'Untitled Workflow'}
                            </h3>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">
                              {instance.agents.length} agents
                            </span>
                            <span className="text-xs text-gray-400">·</span>
                            <span className="text-xs text-gray-400">
                              {instance.workflowRuns.length} runs
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
                              title="Delete workflow"
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
        )}
      </div>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewProjectModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New Project</h3>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
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
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal - Select Project */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewChatModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New Chat</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Project</label>
              <select
                value={selectedProjectForNewChat || ''}
                onChange={(e) => setSelectedProjectForNewChat(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">No project (root)</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowNewChatModal(false);
                  setSelectedProjectForNewChat(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNewChat}
                className="flex-1 px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Chat Modal */}
      {showMoveChatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowMoveChatModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Move Chat</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Chat</label>
              <select
                value={sessionToMove || ''}
                onChange={(e) => setSessionToMove(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a chat...</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title || 'Chat'}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Move to Project</label>
              <select
                value={targetProjectForMove || ''}
                onChange={(e) => setTargetProjectForMove(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">No project (root)</option>
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
                Cancel
              </button>
              <button
                onClick={handleMoveSession}
                disabled={!sessionToMove}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Chat</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete this conversation? This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setSessionToDelete(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowBatchDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Chats</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete {selectedSessions.size} conversation(s)? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBatchDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workflow Delete Confirmation Modal */}
      {showWorkflowDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowWorkflowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {isWorkflowMultiSelectMode
                ? `Delete ${selectedWorkflows.size} Workflows`
                : 'Delete Workflow'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {isWorkflowMultiSelectMode
                ? `Are you sure you want to delete ${selectedWorkflows.size} workflows? All agents, connections, and run history will be lost. This action cannot be undone.`
                : 'Are you sure you want to delete this workflow? All agents, connections, and run history will be lost. This action cannot be undone.'}
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
                Cancel
              </button>
              <button
                onClick={isWorkflowMultiSelectMode ? handleConfirmBatchDeleteWorkflows : handleConfirmWorkflowDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

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
              Delete Project
            </button>
          )}
        </div>
      )}

      {/* Footer / User Profile & Settings */}
      <div className="p-4 border-t border-gray-100 bg-gray-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-sm ring-2 ring-white select-none">
              <span className="font-bold text-sm">{profileInitial}</span>
            </div>
            <div className="min-w-0 select-none">
              <p className="text-sm font-semibold text-gray-900 truncate leading-none mb-1">{profileName}</p>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider opacity-60">{profileSubtitle}</p>
            </div>
          </div>

          <button
            onClick={toggleSettings}
            className="p-2 rounded-xl hover:bg-white hover:shadow-md text-gray-500 hover:text-gray-900 transition-all active:scale-95"
            title={t('nav.settings')}
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
