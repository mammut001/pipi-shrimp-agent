/**
 * AgentPanel - Redesigned Right panel for displaying agent instructions, task progress, and context.
 *
 * Inspired by Claude Code's sidebar layout.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useUIStore, useSettingsStore, useChatStore, useSkillStore } from '@/store';
import { usePolling } from '@/hooks/usePolling';
import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useCdpStore } from '@/store/cdpStore';
import { invoke } from '@tauri-apps/api/core';
import { DocPanel } from './DocPanel';
import { SessionGoalPanel } from './SessionGoalPanel';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import {
  type SyncedWorkspaceEntry,
  combineWorkingFiles,
} from './agentPanelUi';
import {
  AgentPanelTabBar,
  AgentPanelBrowserTab,
  AgentPanelArtifactTab,
  AgentPanelProgressSection,
  AgentPanelWorkingFoldersSection,
  AgentPanelContextSection,
  AgentPanelFooter,
} from './agentPanelSections';

// TODO: Roadmap feature removed due to UI freeze bug (infinite re-render loop).
// Re-implement with proper state management when ready.

/**
 * AgentPanel component
 */
export const AgentPanel: React.FC = () => {
  const {
    agentInstructions,
    setAgentInstructions,
    taskProgress,
    addNotification,
    updateTaskStep,
    agentPanelTab: activeTab,
    setAgentPanelTab: setActiveTab,
    currentArtifactId,
    setCurrentView,
  } = useUIStore();
  const { importedFiles: globalImportedFiles, removeImportedFile, clearImportedFiles } = useSettingsStore();
  const { currentMessages, currentSessionId, sessions, removeSessionWorkingFile } = useChatStore();
  const { status: browserStatus } = useBrowserAgentStore();
  const cdpStatus = useCdpStore((s) => s.status);
  const cdpConnectionState = useCdpStore((s) => s.connectionState);
  const setupCdpConnectionMonitor = useCdpStore((s) => s.setupConnectionMonitor);
  const openConnectorModal = useCdpStore((s) => s.openConnectorModal);

  // Get session-level working files for current session
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const sessionWorkingFiles = currentSession?.workingFiles ?? [];

  // Combine session files and global files (deduplicated by path) - memoized
  const allWorkingFiles = useMemo(
    () => combineWorkingFiles(sessionWorkingFiles, globalImportedFiles),
    [sessionWorkingFiles, globalImportedFiles],
  );

  const [localInstructions, setLocalInstructions] = useState(agentInstructions);
  const [isSaving, setIsSaving] = useState(false);

  // Synchronized workspace files
  const [syncedFiles, setSyncedFiles] = useState<SyncedWorkspaceEntry[]>([]);

  useEffect(() => {
    return setupCdpConnectionMonitor();
  }, [setupCdpConnectionMonitor]);

  useEffect(() => {
    if (!currentSessionId) {
      setSyncedFiles([]);
      return;
    }

    setSyncedFiles([]);
  }, [currentSessionId]);

  const syncWorkspaceFiles = useCallback(async () => {
    if (!currentSessionId) {
      setSyncedFiles([]);
      return;
    }
    // Two-folder model: "sync workspace files" tracks the **Project
    // Folder** (the user's repo) — the PiPi Output Folder lives
    // outside the project and isn't relevant here. We still fall
    // back to the app-managed PiPi Output Folder when no Project
    // Folder is bound so the panel isn't permanently empty.
    let targetPath = currentSession?.projectDir ?? currentSession?.workDir;
    if (!targetPath) {
      try {
        targetPath = await invoke<string>('get_app_default_dir', { sessionId: currentSessionId });
      } catch {
        return;
      }
    }

    if (targetPath) {
      try {
        const files = await invoke<{ name: string; is_directory: boolean; path: string }[]>('list_files', {
          path: targetPath,
        });
        const visibleFiles = files.filter((f) => !f.name.startsWith('.'));
        const flattened: SyncedWorkspaceEntry[] = [];

        for (const file of visibleFiles) {
          flattened.push({ ...file, depth: 0, displayName: file.name });

          if (!file.is_directory) continue;

          try {
            const children = await invoke<{ name: string; is_directory: boolean; path: string }[]>('list_files', {
              path: file.path,
            });
            const visibleChildren = children.filter((child) => !child.name.startsWith('.'));
            for (const child of visibleChildren) {
              flattened.push({
                ...child,
                depth: 1,
                displayName: `${file.name}/${child.name}`,
              });
            }
          } catch {
            // Ignore unreadable sub-directories; top-level entry is still useful.
          }
        }

        setSyncedFiles(flattened);
      } catch {
        setSyncedFiles([]);
      }
    }
  }, [currentSessionId, currentSession?.projectDir, currentSession?.workDir]);

  usePolling(syncWorkspaceFiles, 2000, !!currentSessionId);

  // Load skills from tool registry
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const getCoreSkills = useSkillStore((s) => s.getCoreSkills);
  const getRemainingCount = useSkillStore((s) => s.getRemainingCount);
  const isLoaded = useSkillStore((s) => s.isLoaded);
  const activeSkill = useUIStore((s) => s.activeSkill);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const coreSkills = useMemo(() => {
    if (!isLoaded) return [];
    return getCoreSkills();
  }, [isLoaded, getCoreSkills]);

  const remainingCount = useMemo(() => {
    if (!isLoaded) return 0;
    return getRemainingCount();
  }, [isLoaded, getRemainingCount]);

  const messages = currentMessages();

  // Auto-switch to browser tab when browser starts running
  useEffect(() => {
    if (browserStatus === 'running' && activeTab !== 'browser') {
      const { presentationMode } = useBrowserAgentStore.getState();
      if (presentationMode !== 'expanded') {
        setActiveTab('browser');
      }
    }
  }, [browserStatus, activeTab, setActiveTab]);

  // AutoResearch skill: open the dedicated page (sidebar entry), not a right-panel tab.
  useEffect(() => {
    if (activeSkill === 'autoresearch') {
      setCurrentView('autoresearch');
      const arStore = useAutoResearchStore.getState();
      if (arStore.loopState === 'idle') {
        arStore.setShowSetupModal(true);
      }
    }
  }, [activeSkill, setCurrentView]);

  React.useEffect(() => {
    setLocalInstructions(agentInstructions);
  }, [agentInstructions]);

  const handleSaveSoul = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setAgentInstructions(localInstructions);
      addNotification('success', 'Agent Soul saved successfully');
    } catch {
      addNotification('error', 'Failed to save Agent Soul');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelToolExecution = useCallback(
    async (stepId: string, executionId: string) => {
      updateTaskStep(stepId, 'cancelling');
      try {
        const result = await invoke<{
          executionId: string;
          cancelled: boolean;
          status: string;
          message: string;
        }>('cancel_tool_execution', {
          executionId,
        });

        if (result.cancelled) {
          updateTaskStep(stepId, 'cancelled');
          addNotification('success', 'Command cancellation requested.', currentSessionId ?? undefined);
          return;
        }

        if (result.status === 'not_found' || result.status === 'already_finished') {
          // Neutral finished — not a user Cancelled outcome (vocab: done).
          updateTaskStep(stepId, 'done');
          addNotification('info', result.message, currentSessionId ?? undefined);
          return;
        }

        updateTaskStep(stepId, 'running');
        addNotification('warning', result.message, currentSessionId ?? undefined);
      } catch (error) {
        updateTaskStep(stepId, 'running');
        addNotification(
          'error',
          `Failed to cancel command: ${error instanceof Error ? error.message : String(error)}`,
          currentSessionId ?? undefined,
        );
      }
    },
    [addNotification, currentSessionId, updateTaskStep],
  );

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-gray-800 border-l border-gray-200/60 transition-all duration-300">
      {/* Top Tab Bar */}
      <AgentPanelTabBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentArtifactId={currentArtifactId}
      />

      {/* Tab content: Browser - Always show mini browser + task + logs */}
      {activeTab === 'browser' && <AgentPanelBrowserTab />}

      {/* Tab content: Artifact Preview */}
      {activeTab === 'artifact-preview' && (
        <AgentPanelArtifactTab artifactId={currentArtifactId} messages={messages} />
      )}

      {/* Tab content: Goal */}
      {activeTab === 'goal' && <SessionGoalPanel />}

      {/* Tab content: Main (original AgentPanel) */}
      {activeTab === 'main' && (
        <div className="flex-1 overflow-y-auto pb-6 scrollbar-hide hover:scrollbar-default transition-all pt-4">
          {/* Progress Section */}
          <AgentPanelProgressSection
            taskProgress={taskProgress}
            onCancelToolExecution={handleCancelToolExecution}
          />

          {/* Working Folders Section */}
          <AgentPanelWorkingFoldersSection
            syncedFiles={syncedFiles}
            allWorkingFiles={allWorkingFiles}
            sessionWorkingFiles={sessionWorkingFiles}
            globalImportedFiles={globalImportedFiles}
            currentSessionId={currentSessionId}
            onRemoveSessionWorkingFile={removeSessionWorkingFile}
            onRemoveImportedFile={removeImportedFile}
            onClearImportedFiles={clearImportedFiles}
          />

          {/* Docs Section */}
          {/* Two-folder model: docs land under the PiPi Output Folder,
              not the Project Folder. We pass `pipiOutputDir` so the
              panel reads from the correct location. The panel itself
              doesn't care which folder it points at — the `list_docs`
              Rust helper just appends `.pipi-shrimp/docs/` to whatever
              root the caller passes. */}
          {currentSession?.pipiOutputDir && (
            <DocPanel workDir={currentSession.pipiOutputDir} />
          )}

          {/* Context / Skills Section */}
          <AgentPanelContextSection
            activeSkill={activeSkill}
            coreSkills={coreSkills}
            remainingCount={remainingCount}
            cdpStatus={cdpStatus}
            cdpConnectionState={cdpConnectionState}
            onOpenConnectorModal={openConnectorModal}
            agentInstructions={agentInstructions}
            localInstructions={localInstructions}
            onChangeLocalInstructions={setLocalInstructions}
            onSaveSoul={handleSaveSoul}
            isSavingSoul={isSaving}
          />
        </div>
      )}

      {/* Footer / Status Area */}
      <AgentPanelFooter taskProgress={taskProgress} />
    </div>
  );
};

export default AgentPanel;
