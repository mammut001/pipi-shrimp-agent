/**
 * WorkflowOutputPanel - Real-time output display panel
 *
 * Shows:
 * - Streaming output from each agent during workflow execution
 * - File listing from the run directory (auto-refreshes while running)
 * - Inline file viewer when a file is selected
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { workflowEngine } from '@/services/workflowEngine';
import { workflowService, type FileInfo } from '@/services/workflow';

type Tab = 'output' | 'files';

export function WorkflowOutputPanel() {
  const { agents, isRunning, workflowRuns, selectedRunId } = useWorkflowStore();
  const [agentOutputs, setAgentOutputs] = useState<Map<string, string>>(new Map());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Tab>('output');
  const scrollRef = useRef<HTMLDivElement>(null);

  // File browser state
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileLoading, setFileLoading] = useState(false);

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
    setSelectedFile(filePath);
    setFileLoading(true);
    try {
      const result = await workflowService.readFile(filePath);
      setFileContent(result.content);
    } catch (e) {
      setFileContent(`Error reading file: ${e}`);
    } finally {
      setFileLoading(false);
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
          实时输出
        </button>
        <button
          onClick={() => { setActiveTab('files'); refreshFiles(); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'files'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          文件 {files.length > 0 && <span className="ml-1 text-xs bg-gray-100 rounded-full px-1.5">{files.length}</span>}
        </button>
        <span className="ml-auto pr-4 text-xs text-gray-400">
          {agents.filter((a) => agentOutputs.has(a.id)).length} / {agents.length} agents
        </span>
      </div>

      {/* Tab content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {activeTab === 'output' ? (
          /* ===== Output tab ===== */
          agents.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              添加 Agent 后将显示输出
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
                          任务: {agent.task}
                        </div>
                      )}
                      <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 font-mono whitespace-pre-wrap max-h-80 overflow-y-auto">
                        {output || (running ? '等待输出...' : '无输出')}
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
                运行工作流后将在此展示输出文件
              </div>
            ) : selectedFile ? (
              /* File viewer */
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50">
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-medium text-gray-700 truncate">
                    {selectedFile.split('/').pop()}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {fileLoading ? (
                    <div className="text-gray-400 text-sm animate-pulse">加载中...</div>
                  ) : (
                    <pre className="text-sm text-gray-700 font-mono whitespace-pre-wrap">{fileContent}</pre>
                  )}
                </div>
              </div>
            ) : (
              /* File list */
              <div className="py-2">
                {files.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-400 text-sm">
                    {isRunning ? '等待文件生成...' : '暂无输出文件'}
                  </div>
                ) : (
                  files.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => openFile(file.path)}
                      className="w-full flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition-colors text-left"
                    >
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-gray-900 truncate">{file.name}</span>
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
