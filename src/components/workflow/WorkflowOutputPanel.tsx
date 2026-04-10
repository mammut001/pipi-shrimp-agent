/**
 * WorkflowOutputPanel - Real-time output display panel
 *
 * Shows:
 * - Streaming output from each agent during workflow execution
 * - File listing from the run directory (auto-refreshes while running)
 * - Inline file viewer when a file is selected
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWorkflowStore } from '@/store/workflowStore';
import { workflowEngine } from '@/services/workflowEngine';
import { workflowService, type FileInfo } from '@/services/workflow';
import { useUIStore } from '@/store/uiStore';
import { t } from '@/i18n';

type Tab = 'output' | 'files';

export function WorkflowOutputPanel() {
  const currentInstance = useWorkflowStore((s) =>
    s.instances.find(i => i.id === s.currentInstanceId) ?? null
  );
  const agents = currentInstance?.agents ?? [];
  const workflowRuns = currentInstance?.workflowRuns ?? [];
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const selectedRunId = useWorkflowStore((s) => s.selectedRunId);
  const selectedPreviewFile = useWorkflowStore((s) => s.selectedPreviewFile);
  const setSelectedPreviewFile = useWorkflowStore((s) => s.setSelectedPreviewFile);
  const [agentOutputs, setAgentOutputs] = useState<Map<string, string>>(new Map());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Tab>('output');
  const scrollRef = useRef<HTMLDivElement>(null);

  // File browser state
  const [files, setFiles] = useState<FileInfo[]>([]);
  const addNotification = useUIStore((state) => state.addNotification);

  // Use the explicitly selected run, or fall back to the latest run
  const activeRun = selectedRunId
    ? workflowRuns.find((r) => r.id === selectedRunId) ?? workflowRuns[0]
    : workflowRuns[0];
  const runDirectory = activeRun?.runDirectory || '';

  // Stream callback
  useEffect(() => {
    workflowEngine.setStreamChunkCallback((agentId, _chunk, fullContent) => {
      setAgentOutputs((prev) => {
        const newMap = new Map(prev);
        newMap.set(agentId, fullContent);
        return newMap;
      });
    });
  }, []);

  // Auto-expand running agent
  useEffect(() => {
    if (isRunning) {
      const runningAgent = agents.find((a) => a.status === 'running');
      if (runningAgent) {
        setExpandedAgents((prev) => new Set(prev).add(runningAgent.id));
      }
    }
  }, [isRunning, agents]);

  // Refresh file list
  const refreshFiles = useCallback(async () => {
    if (!runDirectory) return;
    try {
      const entries = await workflowService.listDirectory(runDirectory);
      setFiles(entries.filter((f) => !f.is_directory));
    } catch {
      // directory may not exist yet
    }
  }, [runDirectory]);

  // Periodic refresh while running
  useEffect(() => {
    refreshFiles();
    if (!isRunning) return;
    const id = setInterval(refreshFiles, 2000);
    return () => clearInterval(id);
  }, [isRunning, refreshFiles]);

  // Extra refresh when run completes
  useEffect(() => {
    if (!isRunning && runDirectory) {
      const t = setTimeout(refreshFiles, 500);
      return () => clearTimeout(t);
    }
  }, [isRunning, runDirectory, refreshFiles]);

  const toggleExpand = (agentId: string) => {
    setExpandedAgents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(agentId)) newSet.delete(agentId);
      else newSet.add(agentId);
      return newSet;
    });
  };

  const openFile = async (filePath: string) => {
    setSelectedPreviewFile(filePath);
  };

  const openRunDirectoryInFinder = async () => {
    if (!runDirectory) {
      addNotification('warning', t('workflow.output.noWorkDir'));
      return;
    }

    try {
      await invoke('reveal_in_finder', { path: runDirectory });
    } catch (error) {
      console.error('Failed to reveal workflow directory in Finder:', error);
      addNotification('error', t('workflow.output.cannotOpenWorkDir').replace('{error}', String(error)));
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Tabs */}
      <div className="flex items-center border-b border-gray-200">
        <button
          onClick={() => setActiveTab('output')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'output'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('workflow.output.realTime')}
        </button>
        <button
          onClick={() => { setActiveTab('files'); refreshFiles(); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'files'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('workflow.output.files')} {files.length > 0 && <span className="ml-1 text-xs bg-gray-100 rounded-full px-1.5">{files.length}</span>}
        </button>
        <button
          onClick={openRunDirectoryInFinder}
          disabled={!runDirectory}
          className="ml-2 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          title={runDirectory || t('workflow.output.noWorkDir')}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          {t('workflow.output.openWorkDir')}
        </button>
        <span className="ml-auto pr-4 text-xs text-gray-400">
          {t('workflow.output.agentCount').replace('{done}', String(agents.filter((a) => agentOutputs.has(a.id)).length)).replace('{total}', String(agents.length))}
        </span>
      </div>

      {/* Tab content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {activeTab === 'output' ? (
          /* ===== Output tab ===== */
          agents.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              {t('workflow.output.noAgents')}
            </div>
          ) : (
            agents.map((agent) => {
              const output = agentOutputs.get(agent.id) || '';
              const isExpanded = expandedAgents.has(agent.id);
              const running = agent.status === 'running';

              return (
                <div key={agent.id} className="border-b border-gray-100">
                  {/* Agent header */}
                  <button
                    onClick={() => toggleExpand(agent.id)}
                    className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          agent.status === 'completed'
                            ? 'bg-green-500'
                            : agent.status === 'running'
                            ? 'bg-blue-500 animate-pulse'
                            : agent.status === 'error'
                            ? 'bg-red-500'
                            : 'bg-gray-300'
                        }`}
                      />
                      <span className="text-sm font-medium text-gray-900">{agent.name}</span>
                      {agent.status !== 'idle' && (
                        <span className="text-xs text-gray-400 capitalize">{agent.status}</span>
                      )}
                    </div>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Agent output */}
                  {isExpanded && (
                    <div className="px-4 pb-3">
                      {agent.task && (
                        <div className="mb-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded text-xs text-blue-700">
                          {t('workflow.agentTask')}: {agent.task}
                        </div>
                      )}
                      <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 font-mono whitespace-pre-wrap max-h-80 overflow-y-auto">
                        {output || (running ? t('workflow.output.waiting') : t('workflow.output.noOutput'))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : (
          /* ===== Files tab ===== */
          <div className="flex flex-col h-full">
            {!runDirectory ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                {t('workflow.output.runAfter')}
              </div>
            ) : (
              /* File list */
              <div className="py-2">
                {files.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-400 text-sm">
                    {isRunning ? t('workflow.output.waitingForFiles') : t('workflow.output.noFiles')}
                  </div>
                ) : (
                  files.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => openFile(file.path)}
                      className={`w-full flex items-center gap-2 px-4 py-2 transition-colors text-left ${
                        selectedPreviewFile === file.path
                          ? 'bg-blue-50 border-l-2 border-blue-500'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className={`text-sm truncate ${selectedPreviewFile === file.path ? 'text-blue-700 font-medium' : 'text-gray-900'}`}>
                        {file.name}
                      </span>
                      {selectedPreviewFile === file.path && (
                        <span className="ml-auto text-xs text-blue-500">{t('workflow.output.previewing')}</span>
                      )}
                    </button>
                  ))
                )}
                <div className="px-4 py-2 text-[10px] text-gray-400 truncate" title={runDirectory}>
                  {runDirectory}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkflowOutputPanel;
