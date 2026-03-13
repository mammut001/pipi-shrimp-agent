/**
 * WorkflowRunHistory - Historical execution records panel
 *
 * Shows past workflow executions with their status.
 * Can be toggled to show/hide.
 */

import { useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';

export function WorkflowRunHistory() {
  const [isOpen, setIsOpen] = useState(false);
  const { workflowRuns, agents } = useWorkflowStore();

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (start: number, end?: number) => {
    if (!end) return '-';
    const duration = Math.round((end - start) / 1000);
    if (duration < 60) return `${duration}s`;
    return `${Math.floor(duration / 60)}m ${duration % 60}s`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="text-green-500">✅</span>;
      case 'error':
        return <span className="text-red-500">❌</span>;
      case 'stopped':
        return <span className="text-yellow-500">⏹</span>;
      case 'running':
        return <span className="text-blue-500 animate-pulse">⏳</span>;
      default:
        return <span className="text-gray-400">○</span>;
    }
  };

  const getAgentStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'running':
        return '🔄';
      case 'error':
        return '❌';
      case 'skipped':
        return '⏭';
      default:
        return '⏳';
    }
  };

  if (workflowRuns.length === 0) return null;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 left-4 z-40 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm text-sm text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        历史
        <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">
          {workflowRuns.length}
        </span>
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="fixed bottom-16 left-4 z-40 w-80 max-h-96 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
            <h3 className="font-medium text-sm text-gray-900">执行历史</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* History list */}
          <div className="overflow-y-auto max-h-72">
            {workflowRuns.map((run) => (
              <div key={run.id} className="border-b border-gray-100 last:border-0">
                {/* Run header */}
                <div className="px-4 py-2 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(run.status)}
                      <span className="text-sm font-medium text-gray-900 truncate max-w-40">
                        {run.title}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {formatDuration(run.startTime, run.endTime)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {formatDate(run.startTime)}
                  </div>
                </div>

                {/* Agent steps */}
                <div className="px-4 pb-2">
                  <div className="text-xs space-y-0.5 pl-6">
                    {run.agents.map((entry) => {
                      const agent = agents.find((a) => a.id === entry.agentId);
                      return (
                        <div key={entry.agentId} className="flex items-center gap-1 text-gray-500">
                          <span>{getAgentStatusIcon(entry.status)}</span>
                          <span className="truncate">
                            {agent?.name || entry.agentName || 'Unknown'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default WorkflowRunHistory;
