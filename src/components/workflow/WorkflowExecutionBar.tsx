/**
 * WorkflowExecutionBar - Top bar for running/stopping the workflow
 *
 * Contains:
 * - Prompt input field
 * - Run/Stop buttons
 * - Mock run button (simulates execution without calling LLM)
 * - Status indicator
 * - Clear canvas button
 */

import { useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { workflowEngine } from '@/services/workflowEngine';

export function WorkflowExecutionBar() {
  const [prompt, setPrompt] = useState('');
  const { isRunning, currentRunningAgentId, agents, clearCanvas } = useWorkflowStore();

  const currentAgent = agents.find((a) => a.id === currentRunningAgentId);
  const currentAgentName = currentAgent?.name || '';

  const handleRun = async () => {
    if (!prompt.trim() || isRunning) return;
    await workflowEngine.start(prompt.trim());
  };

  const handleStop = async () => {
    await workflowEngine.stop();
  };

  const handleMockRun = async () => {
    if (isRunning || agents.length === 0) return;

    const store = useWorkflowStore.getState();
    store.resetAllStatuses();
    store.setRunning(true, null);

    for (const agent of agents) {
      store.setAgentStatus(agent.id, 'running');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      store.setAgentStatus(agent.id, 'completed');
    }

    store.setRunning(false, null);
  };

  const handleClear = () => {
    if (window.confirm('确定要清空画布吗？此操作不可恢复。')) {
      clearCanvas();
      setPrompt('');
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200">
      {/* Task description label */}
      <div className="flex items-center gap-1 text-gray-400 flex-shrink-0">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <span className="text-xs font-medium">任务:</span>
      </div>

      {/* Task description input */}
      <input
        type="text"
        placeholder="输入工作流任务描述..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleRun()}
        disabled={isRunning}
        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
      />

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={isRunning || !prompt.trim()}
        className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        Run
      </button>

      {/* Stop button */}
      <button
        onClick={handleStop}
        disabled={!isRunning}
        className="px-4 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" />
        </svg>
        Stop
      </button>

      {/* Mock run button */}
      <button
        onClick={handleMockRun}
        disabled={isRunning || agents.length === 0}
        className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Mock
      </button>

      {/* Status display with step progress */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isRunning ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'
          }`}
        />
        {isRunning ? (
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-blue-600">
              {(() => {
                const idx = agents.findIndex((a) => a.id === currentRunningAgentId);
                return idx >= 0 ? `${idx + 1}/${agents.length}` : '';
              })()}
            </span>
            <span className="truncate max-w-[120px]">{currentAgentName}</span>
          </span>
        ) : '就绪'}
      </div>

      {/* Mini step indicators */}
      {agents.length > 1 && (
        <div className="flex items-center gap-0.5">
          {agents.map((agent) => (
            <div
              key={agent.id}
              title={agent.name}
              className={`w-4 h-1 rounded-full transition-colors ${
                agent.status === 'completed'
                  ? 'bg-green-400'
                  : agent.status === 'running'
                  ? 'bg-blue-500 animate-pulse'
                  : agent.status === 'error'
                  ? 'bg-red-400'
                  : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
      )}

      {/* Clear canvas */}
      <button
        onClick={handleClear}
        disabled={isRunning}
        className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        清空
      </button>
    </div>
  );
}

export default WorkflowExecutionBar;
