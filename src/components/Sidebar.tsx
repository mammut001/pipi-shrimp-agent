/**
 * Sidebar - Session list and navigation sidebar
 *
 * Features:
 * - Display all chat sessions
 * - Highlight active session
 * - Create new session
 * - Delete sessions
 */

import React, { useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore, useUIStore, useWorkflowStore, useSettingsStore } from '@/store';
import { t } from '@/i18n';
import { invoke } from '@tauri-apps/api/core';
import { workflowEngine } from '@/services/workflowEngine';
import { startNewChatFlow } from '@/services/newChatFlow';

import { SidebarAccountChip } from '@/components/sidebar/SidebarAccountChip';
import { SidebarSessionBulkActions } from '@/components/sidebar/SidebarSessionBulkActions';
import { SidebarSessionList } from '@/components/sidebar/SidebarSessionList';
import { SidebarWorkflowBulkActions } from '@/components/sidebar/SidebarWorkflowBulkActions';
import { SidebarWorkflowList } from '@/components/sidebar/SidebarWorkflowList';
import { SidebarModals } from '@/components/sidebar/SidebarModals';
import { SidebarViewSwitcher } from '@/components/sidebar/SidebarViewSwitcher';
import { useSidebarSessionState } from '@/components/sidebar/useSidebarSessionState';
import { useSidebarSessionActions } from '@/components/sidebar/useSidebarSessionActions';
import { useSidebarProjectController } from '@/components/sidebar/useSidebarProjectController';
import { useSidebarWorkflowController } from '@/components/sidebar/useSidebarWorkflowController';


/**
 * Sidebar component
 */
export function Sidebar() {
  const sessions = useChatStore((state) => state.sessions);
  const projects = useChatStore((state) => state.projects);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const getSessionsByProject = useChatStore((state) => state.getSessionsByProject);
  const { toggleSettings, currentView, setCurrentView } = useUIStore();
  const workflowInstances = useWorkflowStore((state) => state.instances);
  const currentInstanceId = useWorkflowStore((state) => state.currentInstanceId);

  const getModelPricing = useSettingsStore((state) => state.getModelPricing);
  const apiConfigs = useSettingsStore((state) => state.apiConfigs);
  const activeConfigId = useSettingsStore((state) => state.activeConfigId);
  const activeApiConfig = useMemo(
    () => apiConfigs.find((config) => config.id === activeConfigId) || apiConfigs[0] || null,
    [apiConfigs, activeConfigId],
  );

  const sessionState = useSidebarSessionState({
    sessions,
    getSessionsByProject,
    apiConfigs,
    activeApiConfig,
    getModelPricing,
  });
  const project = useSidebarProjectController();
  const sessionActions = useSidebarSessionActions({
    sessions,
    state: sessionState,
    setContextMenu: project.setContextMenu,
  });
  const workflow = useSidebarWorkflowController(workflowInstances);

  const {
    searchQuery, setSearchQuery, showDeleteConfirm, setShowDeleteConfirm, sessionToDelete, setSessionToDelete,
    showBatchDeleteConfirm, setShowBatchDeleteConfirm, renamingSessionId, renameInput, setRenameInput,
    isMultiSelectMode, setIsMultiSelectMode, selectedSessions, setSelectedSessions, ungroupedSessions,
    filteredSessions, tokenUsageMap, sessionCostMap,
  } = sessionState;
  const {
    handleOpenDeleteConfirm, handleConfirmDelete, handleSelectSession, getSessionPreview,
    handleToggleSessionSelection, handleSelectAll, handleBatchDelete, handleConfirmBatchDelete,
    handleStartRename, handleConfirmRename, handleCancelRename,
  } = sessionActions;
  const {
    expandedProjects, toggleProject, showNewProjectModal, setShowNewProjectModal, newProjectName, setNewProjectName,
    handleCreateProject, contextMenu, showMoveChatModal, setShowMoveChatModal, sessionToMove,
    setSessionToMove, targetProjectForMove, setTargetProjectForMove, handleOpenMoveChatModal,
    handleMoveSession, handleContextMenu, closeContextMenu, handleDeleteProject,
  } = project;
  const {
    workflowSearchQuery, setWorkflowSearchQuery, filteredWorkflows, showWorkflowDeleteConfirm,
    setShowWorkflowDeleteConfirm, workflowInstanceToDelete, setWorkflowInstanceToDelete,
    renamingWorkflowInstanceId, workflowRenameInput, setWorkflowRenameInput, isWorkflowMultiSelectMode,
    setIsWorkflowMultiSelectMode, selectedWorkflows, setSelectedWorkflows, handleToggleWorkflowSelection,
    handleWorkflowSelectAll, handleBatchDeleteWorkflows, handleConfirmBatchDeleteWorkflows,
    handleSelectInstance, handleStartWorkflowRename, handleConfirmWorkflowRename, handleCancelWorkflowRename,
    handleOpenWorkflowDeleteConfirm, handleConfirmWorkflowDelete,
  } = workflow;

  /**
   * Handle creating a new chat with the default session flow.
   */
  const handleNewChat = useCallback(() => {
    void startNewChatFlow('sidebar');
  }, []);

  /**
   * Create a new blank workflow with a pre-assigned working directory.
   * Stops any in-progress execution first to avoid stale state.
   */
  const handleNewWorkflow = useCallback(async () => {
    const { clearCanvas, addWorkflowRun, setRunning, createInstance, currentInstanceId, instances } = useWorkflowStore.getState();
    // Stop any in-progress run first so we don't leave isRunning/currentRunningAgentId stale
    if (workflowEngine.getIsRunning()) {
      await workflowEngine.stop();
    }
    if (!currentInstanceId || instances.length === 0) {
      createInstance();
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
        title: t('sidebar.newWorkflow'),
        projectGoal: '',
        successCriteria: [],
        status: 'idle',
        startTime: Date.now(),
        currentIteration: 0,
        goalEvaluations: [],
        reachedGoal: false,
        agents: [],
        runDirectory: dir,
      });
      useUIStore.getState().addNotification('success', t('notification.workflowCreated'));
    } catch (e) {
      console.warn('Failed to create workflow directory:', e);
    }
  }, []);

  const renderSidebarModal = (isOpen: boolean, content: React.ReactNode) => {
    if (!isOpen || typeof document === 'undefined') {
      return null;
    }
    return createPortal(content, document.body);
  };

  return (
    <div className="h-full flex flex-col bg-[#fbfbfa] text-[#37352f]">
      {/* Header */}
      <div className="border-b border-[#ececea] p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-[#191919] tracking-tight">🦐 PiPi Shrimp Agent</h1>
        </div>

        {/* New Chat / New Workflow Button (context-aware) */}
        <button
          onClick={currentView === 'workflow' ? handleNewWorkflow : handleNewChat}
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
          {currentView === 'workflow' ? t('sidebar.newWorkflow') : t('nav.newChat')}
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

        {/* AutoResearch Button */}
        <button
          onClick={() => setCurrentView('autoresearch')}
          className="w-full px-4 py-2 mt-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-all flex items-center justify-center gap-2 font-medium shadow-sm active:scale-[0.98]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.773l1.657.71a3 3 0 002.686 0l1.657-.71v3.772a8.972 8.972 0 00-2.3 1.638 1 1 0 01-1.4 0zM15 14.935a9.025 9.025 0 00-2.3 1.638 1 1 0 01-1.4 0 8.972 8.972 0 00-2.3-1.638v-3.772l1.657.71a3 3 0 002.686 0L15 11.162v3.773z" />
          </svg>
          {t('nav.autoresearch')}
        </button>

        <SidebarViewSwitcher
          currentView={currentView}
          setCurrentView={setCurrentView}
          sessionCount={sessions.length}
          workflowCount={workflowInstances.length}
          isMultiSelectMode={isMultiSelectMode}
          setIsMultiSelectMode={setIsMultiSelectMode}
          setSelectedSessions={setSelectedSessions}
          isWorkflowMultiSelectMode={isWorkflowMultiSelectMode}
          setIsWorkflowMultiSelectMode={setIsWorkflowMultiSelectMode}
          setSelectedWorkflows={setSelectedWorkflows}
        />

        <SidebarSessionBulkActions
        isMultiSelectMode={isMultiSelectMode}
        setIsMultiSelectMode={setIsMultiSelectMode}
        selectedSessions={selectedSessions}
        setSelectedSessions={setSelectedSessions}
        ungroupedSessions={ungroupedSessions}
        handleSelectAll={handleSelectAll}
        handleBatchDelete={handleBatchDelete}
        showBatchDeleteConfirm={showBatchDeleteConfirm}
        setShowBatchDeleteConfirm={setShowBatchDeleteConfirm}
        handleConfirmBatchDelete={handleConfirmBatchDelete}
        renderSidebarModal={renderSidebarModal}
      />
      <SidebarWorkflowBulkActions
        isWorkflowMultiSelectMode={isWorkflowMultiSelectMode}
        setIsWorkflowMultiSelectMode={setIsWorkflowMultiSelectMode}
        selectedWorkflows={selectedWorkflows}
        setSelectedWorkflows={setSelectedWorkflows}
        workflowInstances={workflowInstances}
        handleWorkflowSelectAll={handleWorkflowSelectAll}
        handleBatchDeleteWorkflows={handleBatchDeleteWorkflows}
      />
      </div>

      {/* Session/Run List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" onClick={closeContextMenu}>
        {currentView === 'chat' ? (
          <SidebarSessionList
            currentSessionId={currentSessionId}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            filteredSessions={filteredSessions}
            sessions={sessions}
            ungroupedSessions={ungroupedSessions}
            isMultiSelectMode={isMultiSelectMode}
            selectedSessions={selectedSessions}
            handleToggleSessionSelection={handleToggleSessionSelection}
            handleSelectSession={handleSelectSession}
            getSessionPreview={getSessionPreview}
            renamingSessionId={renamingSessionId}
            renameInput={renameInput}
            setRenameInput={setRenameInput}
            handleConfirmRename={handleConfirmRename}
            handleCancelRename={handleCancelRename}
            handleStartRename={handleStartRename}
            tokenUsageMap={tokenUsageMap}
            sessionCostMap={sessionCostMap}
            handleOpenMoveChatModal={handleOpenMoveChatModal}
            handleOpenDeleteConfirm={handleOpenDeleteConfirm}
            projects={projects}
            expandedProjects={expandedProjects}
            toggleProject={toggleProject}
            getSessionsByProject={getSessionsByProject}
            handleContextMenu={handleContextMenu}
            setShowNewProjectModal={setShowNewProjectModal}
          />
        )
        : (
          <SidebarWorkflowList
            workflowInstances={workflowInstances}
            currentInstanceId={currentInstanceId}
            filteredWorkflows={filteredWorkflows}
            workflowSearchQuery={workflowSearchQuery}
            setWorkflowSearchQuery={setWorkflowSearchQuery}
            isWorkflowMultiSelectMode={isWorkflowMultiSelectMode}
            selectedWorkflows={selectedWorkflows}
            handleToggleWorkflowSelection={handleToggleWorkflowSelection}
            handleSelectInstance={handleSelectInstance}
            renamingWorkflowInstanceId={renamingWorkflowInstanceId}
            workflowRenameInput={workflowRenameInput}
            setWorkflowRenameInput={setWorkflowRenameInput}
            handleConfirmWorkflowRename={handleConfirmWorkflowRename}
            handleCancelWorkflowRename={handleCancelWorkflowRename}
            handleStartWorkflowRename={handleStartWorkflowRename}
            handleOpenWorkflowDeleteConfirm={handleOpenWorkflowDeleteConfirm}
          />
        )}
      </div>

      <SidebarModals
        showNewProjectModal={showNewProjectModal}
        setShowNewProjectModal={setShowNewProjectModal}
        newProjectName={newProjectName}
        setNewProjectName={setNewProjectName}
        handleCreateProject={handleCreateProject}
        showMoveChatModal={showMoveChatModal}
        setShowMoveChatModal={setShowMoveChatModal}
        sessionToMove={sessionToMove}
        setSessionToMove={setSessionToMove}
        sessions={sessions}
        targetProjectForMove={targetProjectForMove}
        setTargetProjectForMove={setTargetProjectForMove}
        projects={projects}
        handleMoveSession={handleMoveSession}
        showDeleteConfirm={showDeleteConfirm}
        setShowDeleteConfirm={setShowDeleteConfirm}
        setSessionToDelete={setSessionToDelete}
        handleConfirmDelete={handleConfirmDelete}
        showWorkflowDeleteConfirm={showWorkflowDeleteConfirm}
        setShowWorkflowDeleteConfirm={setShowWorkflowDeleteConfirm}
        isWorkflowMultiSelectMode={isWorkflowMultiSelectMode}
        selectedWorkflows={selectedWorkflows}
        setSelectedWorkflows={setSelectedWorkflows}
        setIsWorkflowMultiSelectMode={setIsWorkflowMultiSelectMode}
        setWorkflowInstanceToDelete={setWorkflowInstanceToDelete}
        handleConfirmBatchDeleteWorkflows={handleConfirmBatchDeleteWorkflows}
        handleConfirmWorkflowDelete={handleConfirmWorkflowDelete}
        contextMenu={contextMenu}
        handleDeleteProject={handleDeleteProject}
        renderSidebarModal={renderSidebarModal}
      />

      {/* Footer / User Profile & Settings */}
      <div className="p-4 border-t border-gray-100 bg-gray-50/50">
        <div className="flex items-center justify-between gap-2">
          <SidebarAccountChip />

          <button
            onClick={toggleSettings}
            className="p-2 rounded-xl hover:bg-white hover:shadow-md text-gray-500 hover:text-gray-900 transition-all active:scale-95 flex-shrink-0"
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
