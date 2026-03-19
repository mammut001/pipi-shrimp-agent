/**
 * AgentPanel - Redesigned Right panel for displaying agent instructions, task progress, and context.
 * 
 * Inspired by Claude Code's sidebar layout.
 */

import React, { useState, useEffect } from 'react';
import { useUIStore, useSettingsStore, useChatStore } from '@/store';
import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { TypstPreview } from './TypstPreview';
import { BrowserPanel } from './BrowserPanel';
import { getLatestTypstBlock } from '@/utils/typst';

/**
 * Section Container Component
 */
const Section: React.FC<{
  title: string;
  subtitle?: string;
  count?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, count, defaultExpanded = true, children }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mx-3 mb-2 bg-white rounded-xl border border-gray-200/60 shadow-sm overflow-hidden transition-all duration-300">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50/50 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-gray-800 uppercase tracking-tight">{title}</h3>
          {subtitle && <span className="text-[10px] text-gray-400 font-medium">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-3">
          {count && <span className="text-[10px] text-gray-500 font-bold bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 text-gray-400 transition-transform duration-300 ${expanded ? '' : '-rotate-90'}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-300">
          {children}
        </div>
      )}
    </div>
  );
};

/**
 * File Icon Helper - Supports multiple file types with type-specific icons
 */
const FileIcon: React.FC<{ filename: string }> = ({ filename }) => {
  const ext = filename.split('.').pop()?.toLowerCase();

  // TypeScript / TSX
  if (ext === 'ts' || ext === 'tsx') return (
    <div className="p-1 px-1.5 bg-blue-50 rounded text-blue-600 font-bold text-[8px] uppercase ring-1 ring-blue-100 flex-shrink-0">TS</div>
  );
  // Rust
  if (ext === 'rs') return (
    <div className="p-1 px-1.5 bg-orange-50 rounded text-orange-600 font-bold text-[8px] uppercase ring-1 ring-orange-100 flex-shrink-0">RS</div>
  );
  // Markdown
  if (ext === 'md' || ext === 'mdx') return (
    <div className="p-1 px-1.5 bg-gray-100 rounded text-gray-600 font-bold text-[8px] uppercase ring-1 ring-gray-200 flex-shrink-0">MD</div>
  );
  // JSON
  if (ext === 'json') return (
    <div className="p-1 px-1.5 bg-yellow-50 rounded text-yellow-600 font-bold text-[8px] uppercase ring-1 ring-yellow-100 flex-shrink-0">{'{}'}</div>
  );
  // Python
  if (ext === 'py') return (
    <div className="p-1 px-1.5 bg-yellow-100 rounded text-yellow-700 font-bold text-[8px] uppercase ring-1 ring-yellow-200 flex-shrink-0">PY</div>
  );
  // Go
  if (ext === 'go') return (
    <div className="p-1 px-1.5 bg-cyan-50 rounded text-cyan-600 font-bold text-[8px] uppercase ring-1 ring-cyan-100 flex-shrink-0">GO</div>
  );
  // Java
  if (ext === 'java') return (
    <div className="p-1 px-1.5 bg-red-50 rounded text-red-600 font-bold text-[8px] uppercase ring-1 ring-red-100 flex-shrink-0">JV</div>
  );
  // CSS
  if (ext === 'css') return (
    <div className="p-1 px-1.5 bg-blue-100 rounded text-blue-700 font-bold text-[8px] uppercase ring-1 ring-blue-200 flex-shrink-0">CSS</div>
  );
  // HTML
  if (ext === 'html' || ext === 'htm') return (
    <div className="p-1 px-1.5 bg-orange-100 rounded text-orange-700 font-bold text-[8px] uppercase ring-1 ring-orange-200 flex-shrink-0">HTML</div>
  );
  // Image files
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) return (
    <div className="p-1 px-1.5 bg-purple-50 rounded text-purple-600 font-bold text-[8px] uppercase ring-1 ring-purple-100 flex-shrink-0">IMG</div>
  );
  // Config files
  if (['yaml', 'yml', 'toml', 'ini', 'conf'].includes(ext || '')) return (
    <div className="p-1 px-1.5 bg-gray-100 rounded text-gray-600 font-bold text-[8px] uppercase ring-1 ring-gray-200 flex-shrink-0">CFG</div>
  );

  // Default file icon
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
};

/**
 * AgentPanel component
 */
export const AgentPanel: React.FC = () => {
  const {
    agentInstructions,
    setAgentInstructions,
    taskProgress,
    permissionMode,
    setPermissionMode,
    addNotification,
    agentPanelTab: activeTab,
    setAgentPanelTab: setActiveTab,
  } = useUIStore();
  const { importedFiles: globalImportedFiles, removeImportedFile } = useSettingsStore();
  const { currentMessages, currentSessionId, sessions, removeSessionWorkingFile } = useChatStore();
  const { status: browserStatus } = useBrowserAgentStore();

  // Get session-level working files for current session
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const sessionWorkingFiles = currentSession?.workingFiles ?? [];

  // Combine session files and global files (deduplicated by path)
  const allWorkingFiles = [
    ...sessionWorkingFiles,
    ...globalImportedFiles.filter(f => !sessionWorkingFiles.some(sf => sf.path === f.path))
  ];

  const [showBypassConfirm, setShowBypassConfirm] = useState(false);
  const [localInstructions, setLocalInstructions] = useState(agentInstructions);
  const [isSaving, setIsSaving] = useState(false);

  // activeTab / setActiveTab come from global useUIStore (agentPanelTab / setAgentPanelTab)
  const [previewContent, setPreviewContent] = useState<string>('');
  const [autoSync, setAutoSync] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const messages = currentMessages();

  // Auto-switch to browser tab when browser starts running
  useEffect(() => {
    if (browserStatus === 'running' && activeTab !== 'browser') {
      setActiveTab('browser');
    }
  }, [browserStatus]);

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
    if (mode === 'bypass' && permissionMode !== 'bypass') {
      setShowBypassConfirm(true);
    } else {
      setPermissionMode(mode as any);
      setShowBypassConfirm(false);
    }
  };

  const confirmBypass = () => {
    setPermissionMode('bypass');
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
    <div className="flex flex-col h-full bg-[#fbfbfd] text-gray-800 border-l border-gray-200/60 transition-all duration-300 select-none">

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

      {/* Tab content: Browser */}
      {activeTab === 'browser' && (
        <div className="flex-1 overflow-hidden">
          <BrowserPanel />
        </div>
      )}

      {/* Tab content: Typst Preview */}
      {activeTab === 'typst-preview' && (
        <div className="flex-1 overflow-hidden p-3">
          <TypstPreview rawContent={previewContent} className="h-full" />
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

      {/* Tab content: Main (original AgentPanel) */}
      {activeTab === 'main' && <>

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
          count={allWorkingFiles.length > 0 ? allWorkingFiles.length.toString() : undefined}
        >
          <div className="pt-2 space-y-1">
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
                    {isSessionFile && (
                      <span className="text-[8px] text-blue-400 font-bold">session</span>
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
              <div className="py-6 flex flex-col items-center justify-center opacity-25">
                <p className="text-[10px] font-bold uppercase tracking-tight text-center px-4 leading-normal">Drop files here to add to context</p>
              </div>
            )}
          </div>
        </Section>

        {/* Context / Skills Section */}
        <Section title="Context">
          <div className="pt-2 space-y-4">
            <div>
              <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2.5">Skills</h4>
              <div className="flex flex-wrap gap-2">
                {['read_file', 'write_file', 'bash', 'ripgrep', 'glob'].map(skill => (
                  <div key={skill} className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-[10px] font-bold text-gray-600 shadow-sm flex items-center gap-1.5 hover:border-blue-200 transition-colors cursor-default">
                    <div className="h-1 w-1 bg-blue-500 rounded-full" />
                    {skill}
                  </div>
                ))}
                <div className="px-2 py-1 bg-gray-50 border border-dashed border-gray-200 rounded-lg text-[10px] font-medium text-gray-400">
                  + 12 more
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2.5">Connectors</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 bg-white border border-gray-200 rounded-xl shadow-sm hover:border-blue-200 transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-50 rounded-lg text-blue-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-gray-800">Claude in Chrome</p>
                      <p className="text-[9px] text-gray-400 font-medium uppercase tracking-tight">Active Connection</p>
                    </div>
                  </div>
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" />
                </div>
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

      </> /* end activeTab === 'main' */}

      {/* Footer / Status Area */}
      <div className="px-4 py-3 border-t border-gray-200/60 bg-white/50 flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-tighter cursor-default">
        <div className="flex items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full ${taskProgress.some(s => s.status === 'running') ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`} />
          {taskProgress.some(s => s.status === 'running') ? 'Processing' : 'System Ready'}
        </div>
        <div className="opacity-60">v0.1.0-alpha</div>
      </div>
    </div>
  );
};

export default AgentPanel;
