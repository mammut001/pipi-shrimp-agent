/**
 * AgentPanel - Redesigned Right panel for displaying agent instructions, task progress, and context.
 *
 * Inspired by Claude Code's sidebar layout.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useUIStore, useSettingsStore, useChatStore, useSkillStore } from '@/store';
import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useCdpStore } from '@/store/cdpStore';
import { invoke } from '@tauri-apps/api/core';
import { CdpConnectorModal } from './CdpConnectorModal';
import { TypstPreview } from './index';
import { BrowserMiniPreview } from './BrowserMiniPreview';
import { DocPanel } from './DocPanel';
import { ChatImage } from './ChatImage';
import { getLatestTypstBlock } from '@/utils/typst';
import { Section } from './ui/Section';
import { FileIcon } from './ui/FileIcon';
import { AutoResearchPanel } from './AutoResearchPanel';
import { useAutoResearchStore } from '@/store/autoresearchStore';

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
    agentPanelTab: activeTab,
    setAgentPanelTab: setActiveTab,
    currentArtifactId,
  } = useUIStore();
  const { importedFiles: globalImportedFiles, removeImportedFile, clearImportedFiles } = useSettingsStore();
  const { currentMessages, currentSessionId, sessions, removeSessionWorkingFile, updateSessionPermissionMode, isStreaming, pendingToolCalls } = useChatStore();
  const { status: browserStatus } = useBrowserAgentStore();
  const cdpStatus = useCdpStore(s => s.status);
  const [showCdpModal, setShowCdpModal] = useState(false);

  // Get session-level working files and permissionMode for current session
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const sessionWorkingFiles = currentSession?.workingFiles ?? [];
  // Get permissionMode from current session (defaults to 'standard')
  const permissionMode = currentSession?.permissionMode || 'standard';

  // Combine session files and global files (deduplicated by path) - memoized
  const allWorkingFiles = useMemo(() => [
    ...sessionWorkingFiles,
    ...globalImportedFiles.filter(f => !sessionWorkingFiles.some(sf => sf.path === f.path))
  ], [sessionWorkingFiles, globalImportedFiles]);

  const [showBypassConfirm, setShowBypassConfirm] = useState(false);
  const [showPermissionWarning, setShowPermissionWarning] = useState(false);
  const [localInstructions, setLocalInstructions] = useState(agentInstructions);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingModeChange, setPendingModeChange] = useState<string | null>(null);

  // Preview related state
  const [previewContent, setPreviewContent] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Synchronized workspace files
  const [syncedFiles, setSyncedFiles] = useState<{name: string, is_directory: boolean, path: string}[]>([]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    const syncWorkspaceFiles = async () => {
      if (!currentSessionId) return;
      let targetPath = currentSession?.workDir;
      if (!targetPath) {
        try {
          targetPath = await invoke<string>('get_app_default_dir', { sessionId: currentSessionId });
        } catch (e) {
          return; // Ignore
        }
      }
      
      if (targetPath) {
        try {
          // fetch all files
          const files = await invoke<{name: string, is_directory: boolean, path: string}[]>('list_files', { path: targetPath });
          // ignore .pipi-shrimp and hidden files/folders
          const visibleFiles = files.filter(f => !f.name.startsWith('.'));
          setSyncedFiles(visibleFiles);
        } catch (e) {
          // Folder might not exist yet, that's fine
          setSyncedFiles([]);
        }
      }
    };

    syncWorkspaceFiles();
    intervalId = setInterval(syncWorkspaceFiles, 2000); // Poll every 2 seconds

    return () => clearInterval(intervalId);
  }, [currentSessionId, currentSession?.workDir]);

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

  // Auto-switch to autoresearch tab + show setup modal when skill is activated
  useEffect(() => {
    if (activeSkill === 'autoresearch') {
      setActiveTab('autoresearch');
      const arStore = useAutoResearchStore.getState();
      // Only show setup if no session is running
      if (arStore.loopState === 'idle') {
        arStore.setShowSetupModal(true);
      }
    }
  }, [activeSkill, setActiveTab]);

  // Sync on mount (immediate, not debounced)
  useEffect(() => {
    if (autoSync && messages.length > 0) {
      const latestBlock = getLatestTypstBlock(messages);
      if (latestBlock && isInitialLoad) {
        setPreviewContent(latestBlock);
        setIsInitialLoad(false);
      }
    }
  }, []); // Only run on mount


  // Sync immediately when switching to typst-preview tab
  useEffect(() => {
    if (activeTab === 'typst-preview' && autoSync && messages.length > 0) {
      const latestBlock = getLatestTypstBlock(messages);
      if (latestBlock) {
        setPreviewContent(latestBlock);
      }
    }
  }, [activeTab]); // Run when tab changes

  // Auto-sync latest Typst block from messages (for new messages while on tab)
  useEffect(() => {
    if (autoSync && messages.length > 0) {
      const latestBlock = getLatestTypstBlock(messages);
      if (latestBlock) {
        setPreviewContent(latestBlock);
      }
    }
  }, [messages, autoSync]);

  React.useEffect(() => {
    setLocalInstructions(agentInstructions);
  }, [agentInstructions]);

  const handleModeChange = (mode: string) => {
    // Check if there are pending tool operations
    if (isStreaming || pendingToolCalls > 0) {
      setPendingModeChange(mode);
      setShowPermissionWarning(true);
      return;
    }

    if (mode === 'bypass' && permissionMode !== 'bypass') {
      setShowBypassConfirm(true);
    } else {
      if (currentSessionId) {
        updateSessionPermissionMode(currentSessionId, mode as 'standard' | 'auto-edits' | 'bypass' | 'plan-only');
      }
      setShowBypassConfirm(false);
    }
  };

  const confirmPermissionSwitch = () => {
    if (currentSessionId && pendingModeChange) {
      updateSessionPermissionMode(currentSessionId, pendingModeChange as 'standard' | 'auto-edits' | 'bypass' | 'plan-only');
    }
    setShowPermissionWarning(false);
    setPendingModeChange(null);
  };

  const confirmBypass = () => {
    if (currentSessionId) {
      updateSessionPermissionMode(currentSessionId, 'bypass');
    }
    setShowBypassConfirm(false);
  };

  const handleSaveSoul = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      setAgentInstructions(localInstructions);
      addNotification('success', 'Agent Soul saved successfully');
    } catch (error) {
      addNotification('error', 'Failed to save Agent Soul');
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate completed steps
  const completedSteps = taskProgress.filter(s => s.status === 'done').length;
  const totalSteps = taskProgress.length;

  return (
    <div className="flex flex-col h-full bg-[#fbfbfd] text-gray-800 border-l border-gray-200/60 transition-all duration-300">
      {/* Top Tab Bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-gray-200/60 bg-white/70">
        {/* Main tab */}
        <button
          onClick={() => setActiveTab('main')}
          className={`px-2.5 py-1 text-[10px] font-bold rounded-lg uppercase tracking-tight transition-all ${
            activeTab === 'main'
              ? 'bg-gray-900 text-white'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
        >
          Main
        </button>

        {/* Browser tab */}
        <button
          onClick={() => setActiveTab('browser')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'browser'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Browser"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        </button>

        {/* Typst Preview tab */}
        <button
          onClick={() => setActiveTab('typst-preview')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'typst-preview'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Typst Preview"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>

        {/* Typst Code tab */}
        <button
          onClick={() => setActiveTab('typst-code')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'typst-code'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Typst Code"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </button>

        {/* Artifact Preview tab (only if artifact exists) */}
        {currentArtifactId && (
          <button
            onClick={() => setActiveTab('artifact-preview')}
            className={`p-1.5 rounded-lg transition-all ${
              activeTab === 'artifact-preview'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            title="Artifact Preview"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
        )}
        
        {/* AutoResearch tab */}
        <button
          onClick={() => setActiveTab('autoresearch')}
          className={`p-1.5 rounded-lg transition-all ${
            activeTab === 'autoresearch'
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="AutoResearch"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </button>

        {/* Roadmap tab - TODO: re-implement with proper state management */}

        {/* Sync toggle (only relevant for Typst tabs) */}
        {(activeTab === 'typst-preview' || activeTab === 'typst-code') && (
          <button
            onClick={() => setAutoSync(!autoSync)}
            className={`ml-auto px-2 py-1 text-[9px] font-bold rounded-lg uppercase tracking-tight flex items-center gap-1 transition-all ${
              autoSync ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
            }`}
            title={autoSync ? 'Auto-sync on' : 'Auto-sync off'}
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            Sync
          </button>
        )}
      </div>

      {/* Tab content: Browser - Always show mini browser + task + logs */}
      {activeTab === 'browser' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <BrowserMiniPreview />
        </div>
      )}

      {/* Tab content: Typst Preview */}
      {activeTab === 'typst-preview' && (
        <div className="flex-1 overflow-hidden p-3">
          <TypstPreview rawContent={previewContent} className="h-full" outputDir={currentSession?.outputDir} />
        </div>
      )}

      {/* Tab content: Typst Code */}
      {activeTab === 'typst-code' && (
        <div className="flex-1 overflow-hidden p-3">
          <textarea
            value={previewContent}
            onChange={(e) => {
              setPreviewContent(e.target.value);
              setAutoSync(false);
            }}
            className="w-full h-full resize-none font-mono text-xs p-3 border border-gray-200 rounded-xl focus:outline-none focus:border-gray-400 bg-white"
            placeholder="Enter Typst source code..."
            spellCheck={false}
          />
        </div>
      )}

      {/* Tab content: Artifact Preview */}
      {activeTab === 'artifact-preview' && (
        <div className="flex-1 overflow-hidden p-3">
          <ArtifactRenderer artifactId={currentArtifactId} messages={messages} />
        </div>
      )}

      {/* Roadmap tab content removed - TODO: re-implement */}

      {/* Tab content: AutoResearch */}
      {activeTab === 'autoresearch' && (
        <AutoResearchPanel />
      )}

      {/* Tab content: Main (original AgentPanel) */}
      {activeTab === 'main' && (
        <>
          {/* Header / Mode Control */}
          <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Execution Mode</span>
            <div className={`h-1.5 w-1.5 rounded-full ${permissionMode === 'bypass' ? 'bg-red-500 animate-pulse' :
              permissionMode === 'standard' ? 'bg-blue-500' :
                permissionMode === 'auto-edits' ? 'bg-indigo-500' :
                  'bg-green-500'
              }`} />
            {permissionMode === 'bypass' && (
              <span className="text-[9px] text-red-600 font-bold uppercase tracking-tight ml-auto">Bypass Active</span>
            )}
          </div>
        </div>

        <div className="flex p-1 bg-gray-200/50 rounded-xl">
          {[
            { id: 'standard', label: 'Ask' },
            { id: 'auto-edits', label: 'Auto' },
            { id: 'bypass', label: 'Bypass' },
            { id: 'plan-only', label: 'Plan' },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all uppercase ${permissionMode === mode.id
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-400 hover:text-gray-600'
                }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {showBypassConfirm && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl animate-in slide-in-from-top-2">
            <p className="text-[10px] text-red-700 font-bold mb-2 uppercase leading-snug">Caution: AI will execute commands without approval.</p>
            <div className="flex gap-2">
              <button onClick={confirmBypass} className="flex-1 py-1.5 bg-red-600 text-white text-[9px] font-bold rounded-lg uppercase">Confirm</button>
              <button onClick={() => setShowBypassConfirm(false)} className="flex-1 py-1.5 bg-white text-gray-600 text-[9px] font-bold rounded-lg border border-gray-200 uppercase">Cancel</button>
            </div>
          </div>
        )}

        {/* Permission Switch Warning - when there are pending tool calls */}
        {showPermissionWarning && (
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl animate-in slide-in-from-top-2">
            <div className="flex items-start gap-2 mb-2">
              <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-[10px] text-amber-800 font-bold uppercase leading-snug">Cannot switch permissions now</p>
                <p className="text-[9px] text-amber-700 mt-1 leading-relaxed">
                  {isStreaming && 'AI is still generating a response. '}
                  {pendingToolCalls > 0 && `There ${pendingToolCalls === 1 ? 'is' : 'are'} ${pendingToolCalls} pending tool call${pendingToolCalls === 1 ? '' : 's'} waiting for results.`}
                </p>
                <p className="text-[9px] text-amber-600 mt-1 leading-relaxed">
                  Switching permissions now may cause API errors with in-progress tool calls.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={confirmPermissionSwitch} className="flex-1 py-1.5 bg-amber-600 text-white text-[9px] font-bold rounded-lg uppercase">Switch Anyway</button>
              <button onClick={() => { setShowPermissionWarning(false); setPendingModeChange(null); }} className="flex-1 py-1.5 bg-white text-gray-600 text-[9px] font-bold rounded-lg border border-gray-200 uppercase">Wait</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-6 scrollbar-hide hover:scrollbar-default transition-all">

        {/* Progress Section */}
        <Section
          title="Progress"
          count={totalSteps > 0 ? `${completedSteps} of ${totalSteps}` : undefined}
          defaultExpanded={totalSteps > 0}
        >
          {taskProgress.length > 0 ? (
            <div className="space-y-3 pt-2">
              {taskProgress.map((step, idx) => (
                <div key={step.id} className="flex gap-3 items-start relative group">
                  {idx < taskProgress.length - 1 && (
                    <div className="absolute left-[9px] top-5 bottom-0 w-[1px] bg-gray-100" />
                  )}
                  <div className={`mt-0.5 h-4.5 w-4.5 rounded-full flex items-center justify-center flex-shrink-0 z-10 transition-all ${step.status === 'done' ? 'bg-green-500 text-white' :
                    step.status === 'running' ? 'bg-blue-600 text-white shadow-[0_0_8px_rgba(37,99,235,0.3)]' :
                      step.status === 'failed' ? 'bg-red-500 text-white' :
                        'bg-white border-2 border-gray-100 text-gray-300'
                    }`}>
                    {step.status === 'done' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <span className="text-[9px] font-bold">{idx + 1}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[11px] font-medium leading-[1.4] transition-colors ${step.status === 'running' ? 'text-gray-900 font-bold' :
                      step.status === 'done' ? 'text-gray-500' : 'text-gray-400'
                      }`}>
                      {step.label}
                    </p>
                    {step.status === 'running' && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="flex gap-0.5">
                          <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-[9px] text-blue-600 font-bold uppercase tracking-tight">Thinking</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center justify-center opacity-25">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-widest">No Active Task</span>
            </div>
          )}
        </Section>

        {/* Working Folders Section */}
        <Section
          title="Working folders"
          count={((syncedFiles.length) + allWorkingFiles.length).toString()}
        >
          <div className="pt-2 space-y-1">
            {/* Render Disk-Synced Files */}
            {syncedFiles.length > 0 && syncedFiles.map((file) => (
              <div 
                key={file.path} 
                className="group flex items-center gap-3 p-2 hover:bg-gray-100/50 rounded-xl transition-all cursor-pointer"
                onClick={() => {
                   if (!file.is_directory) invoke('reveal_in_finder', { path: file.path }).catch(console.error);
                }}
              >
                {file.is_directory ? (
                  <div className="text-blue-400">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                       <path d="M2 6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1H8a3 3 0 00-3 3v6H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </div>
                ) : (
                  <FileIcon filename={file.name} />
                )}
                <span className="flex-1 text-[11px] text-gray-700 truncate font-medium" title={file.path}>
                  {file.name}
                </span>
                <span className="text-[8px] text-green-500 font-bold">disk</span>
              </div>
            ))}

            {allWorkingFiles.length > 0 ? (
              allWorkingFiles.map((file) => {
                // Check if file is from session or global
                const isSessionFile = sessionWorkingFiles.some(sf => sf.id === file.id);
                const handleRemove = () => {
                  if (isSessionFile && currentSessionId) {
                    removeSessionWorkingFile(currentSessionId, file.id);
                  } else {
                    removeImportedFile(file.id);
                  }
                };
                return (
                  <div key={file.id} className="group flex items-center gap-3 p-2 hover:bg-gray-100/50 rounded-xl transition-all">
                    <FileIcon filename={file.name} />
                    <span className="flex-1 text-[11px] text-gray-700 truncate font-medium" title={file.path}>
                      {file.name}
                    </span>
                    {isSessionFile ? (
                      <span className="text-[8px] text-blue-400 font-bold">session</span>
                    ) : (
                      <span className="text-[8px] text-orange-400 font-bold">global</span>
                    )}
                    <button
                      onClick={handleRemove}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 text-red-400 hover:text-red-500 rounded-lg transition-all"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                );
              })
            ) : (
              syncedFiles.length === 0 && (
                <div className="py-6 flex flex-col items-center justify-center opacity-25">
                  <p className="text-[10px] font-bold uppercase tracking-tight text-center px-4 leading-normal">Drop files here to add to context</p>
                </div>
              )
            )}
            {globalImportedFiles.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[9px] text-gray-400 font-medium">
                  {globalImportedFiles.length} global file{globalImportedFiles.length !== 1 ? 's' : ''} (all sessions)
                </span>
                <button
                  onClick={clearImportedFiles}
                  className="text-[9px] text-orange-500 hover:text-orange-700 font-bold uppercase tracking-tight hover:underline transition-colors"
                >
                  Clear global
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* Docs Section */}
        {currentSession?.workDir && (
          <DocPanel workDir={currentSession.workDir} />
        )}

        {/* Context / Skills Section */}
        <Section title="Context">
          <div className="pt-2 space-y-4">
            <div>
              <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2.5">Skills</h4>
              <div className="flex flex-wrap gap-2">
                {/* Show active skill badge if it doesn't match any core skill */}
                {activeSkill != null && !coreSkills.some(s =>
                  s.id === activeSkill || s.name === activeSkill ||
                  (s.displayName ?? '').toLowerCase() === activeSkill.toLowerCase()
                ) && (
                  <div
                    className="px-2 py-1 border rounded-lg text-[10px] font-bold shadow-sm flex items-center gap-1.5 transition-all cursor-default bg-black text-white border-black scale-105 shadow-md animate-pulse"
                    title={activeSkill}
                  >
                    <div className="h-1 w-1 rounded-full bg-white animate-pulse" />
                    {activeSkill.charAt(0).toUpperCase() + activeSkill.slice(1)}
                    <span className="ml-0.5 text-[9px] opacity-80">⚡</span>
                  </div>
                )}
                {coreSkills.slice(0, 8).map((skill) => {
                  const isActive = activeSkill != null &&
                    (skill.id === activeSkill ||
                     skill.name === activeSkill ||
                     (skill.displayName ?? '').toLowerCase() === activeSkill.toLowerCase());
                  return (
                    <div
                      key={skill.id}
                      className={`px-2 py-1 border rounded-lg text-[10px] font-bold shadow-sm flex items-center gap-1.5 transition-all cursor-default ${
                        isActive
                          ? 'bg-black text-white border-black scale-105 shadow-md'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-200'
                      }`}
                      title={skill.description || skill.name}
                    >
                      <div className={`h-1 w-1 rounded-full ${isActive ? 'bg-white animate-pulse' : 'bg-blue-500'}`} />
                      {skill.displayName}
                      {isActive && <span className="ml-0.5 text-[9px] opacity-80">⚡</span>}
                    </div>
                  );
                })}
                {remainingCount > 0 && (
                  <div className="px-2 py-1 bg-gray-50 border border-dashed border-gray-200 rounded-lg text-[10px] font-medium text-gray-400">
                    + {remainingCount} more
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2.5">Connectors</h4>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    if (cdpStatus !== 'connected') {
                      setShowCdpModal(true);
                    }
                  }}
                  className="w-full flex items-center justify-between p-2.5 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-blue-200 transition-all group text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-gray-800">
                        {cdpStatus === 'connected' ? 'Pipi Shrimp in Chrome' : 'Chrome Browser'}
                      </p>
                      <p className="text-[9px] text-gray-400 font-medium uppercase tracking-tight">
                        {cdpStatus === 'connected' && 'Active Connection'}
                        {cdpStatus === 'connecting' && 'Connecting...'}
                        {cdpStatus === 'disconnected' && 'Click to Connect'}
                        {cdpStatus === 'error' && 'Connection Failed — Retry'}
                      </p>
                    </div>
                  </div>
                  <div className={`h-1.5 w-1.5 rounded-full shadow-sm ${
                    cdpStatus === 'connected' ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]' :
                    cdpStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' :
                    cdpStatus === 'error' ? 'bg-red-400' :
                    'bg-gray-300'
                  }`} />
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Agent Soul (Default)</h4>
                {localInstructions !== agentInstructions && (
                  <button onClick={handleSaveSoul} className="text-[9px] font-bold text-blue-600 uppercase tracking-tight hover:underline">
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
              </div>
              <textarea
                value={localInstructions}
                onChange={(e) => setLocalInstructions(e.target.value)}
                className="w-full text-[11px] text-gray-600 leading-relaxed bg-gray-100/50 p-3 rounded-xl border border-transparent focus:border-blue-200 focus:bg-white focus:outline-none transition-all resize-none min-h-[80px]"
                placeholder="Agent identity and background..."
              />
            </div>
          </div>
        </Section>

      </div>
        </>
      )}

      {/* Footer / Status Area */}
      <div className="px-4 py-3 border-t border-gray-200/60 bg-white/50 flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-tighter cursor-default">
        <div className="flex items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full ${taskProgress.some(s => s.status === 'running') ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`} />
          {taskProgress.some(s => s.status === 'running') ? 'Processing' : 'System Ready'}
        </div>
        <div className="opacity-60">v0.1.0-alpha</div>
      </div>

      {showCdpModal && (
        <CdpConnectorModal
          onClose={() => {
            setShowCdpModal(false);
          }}
        />
      )}
    </div>
  );
};

/**
 * ArtifactRenderer - Renders specialized artifact types in the side panel
 */
function ArtifactRenderer({ artifactId, messages }: { artifactId?: string; messages: any[] }) {
  const artifact = useMemo(() => {
    if (!artifactId) return null;
    for (const msg of messages) {
      const found = msg.artifacts?.find((a: any) => a.id === artifactId);
      if (found) return found;
    }
    return null;
  }, [artifactId, messages]);

  if (!artifact) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs uppercase tracking-widest font-bold">No Artifact Selected</span>
      </div>
    );
  }

  if (artifact.type === 'image' || artifact.type === 'svg') {
    return (
      <div className="h-full flex flex-col">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-tight">{artifact.title || 'Image Artifact'}</h3>
          <span className="text-[9px] font-mono text-gray-300">ID: {artifact.id}</span>
        </div>
        <div className="flex-1 overflow-auto bg-white rounded-xl border border-gray-100 p-2">
          <ChatImage 
            src={artifact.content} 
            isSVG={artifact.type === 'svg' || artifact.mimeType === 'image/svg+xml'} 
            className="w-full"
          />
        </div>
      </div>
    );
  }

  // Fallback for code/html etc.
  return (
    <div className="h-full flex flex-col">
       <div className="mb-2">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-tight">{artifact.title || artifact.type}</h3>
       </div>
       <pre className="flex-1 p-3 bg-gray-900 text-gray-100 rounded-xl font-mono text-[11px] overflow-auto">
         {artifact.content}
       </pre>
    </div>
  );
}

export default AgentPanel;
