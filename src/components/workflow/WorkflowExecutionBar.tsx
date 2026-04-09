/**
 * WorkflowExecutionBar - Top bar for running/stopping the workflow
 *
 * Contains:
 * - Run/Stop buttons
 * - Status indicator
 * - Clear canvas button
 */

import { useRef } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { workflowEngine } from '@/services/workflowEngine';

export function WorkflowExecutionBar() {
  const { isRunning, currentRunningAgentId, agents, clearCanvas } = useWorkflowStore();
  // Ref-based guard: prevents double-click and the stop→run race condition where
  // stop() sets this.isRunning=false before the old coroutine's finally block runs.
  const startingRef = useRef(false);

  const currentAgent = agents.find((a) => a.id === currentRunningAgentId);
  const currentAgentName = currentAgent?.name || '';

  const handleRun = async () => {
    if (agents.length === 0 || isRunning || startingRef.current || workflowEngine.getIsRunning()) return;
    startingRef.current = true;
    try {
      await workflowEngine.start();
    } finally {
      startingRef.current = false;
    }
  };

  const handleStop = async () => {
    await workflowEngine.stop();
  };

  const handleClear = () => {
    if (window.confirm('确定要清空画布吗？此操作不可恢复。')) {
      clearCanvas();
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200">
      <div className="flex items-center gap-2 text-sm text-gray-500 min-w-0 flex-1">
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <span className="font-medium text-gray-700">工作流将直接使用当前 Agent Task 配置运行</span>
      </div>

      {/* Run button */}
      <button
        onClick={handleRun}
        disabled={isRunning || agents.length === 0}
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
