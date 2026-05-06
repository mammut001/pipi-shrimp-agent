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
import { t } from '@/i18n';
import { GoalStatusBadge } from './GoalStatusBadge';

export function WorkflowExecutionBar() {
  const currentInstance = useWorkflowStore((s) =>
    s.instances.find(i => i.id === s.currentInstanceId) ?? null
  );
  const agents = currentInstance?.agents ?? [];
  const hasProjectGoal = Boolean(currentInstance?.projectGoal?.trim());
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const hasAgentTaskFallback = agents.some((agent) =>
    Boolean(agent.task?.trim() || agent.taskPrompt?.trim() || agent.taskInstruction?.trim())
  );
  const canRun = agents.length > 0 && (hasProjectGoal || hasAgentTaskFallback) && !isRunning;
  const currentRunningAgentId = useWorkflowStore((s) => s.currentRunningAgentId);
  const clearCanvas = useWorkflowStore((s) => s.clearCanvas);
  const startingRef = useRef(false);

  const currentAgent = agents.find((a) => a.id === currentRunningAgentId);
  const currentAgentName = currentAgent?.name || '';

  const runDisabledReason = agents.length === 0
    ? t('workflow.output.noAgents')
    : (!hasProjectGoal && !hasAgentTaskFallback)
      ? t('workflow.goalPanel.projectGoalRequired')
      : undefined;

  const handleRun = async () => {
    if (!canRun || startingRef.current || workflowEngine.getIsRunning()) return;
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
    if (window.confirm(t('workflow.clearCanvasConfirm'))) {
      clearCanvas();
    }
  };

  return (
    <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <button
          onClick={handleRun}
          disabled={!canRun}
          title={runDisabledReason}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          {t('workflow.run')}
        </button>

        <button
          onClick={handleStop}
          disabled={!isRunning}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" />
          </svg>
          {t('workflow.stop')}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-500">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isRunning ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'
            }`}
          />
          {isRunning ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-medium text-blue-600">
                {(() => {
                  const idx = agents.findIndex((a) => a.id === currentRunningAgentId);
                  return idx >= 0 ? `${idx + 1}/${agents.length}` : '';
                })()}
              </span>
              <span className="truncate">{currentAgentName}</span>
            </span>
          ) : (
            <span className="truncate">{t('workflow.clearCanvasWarning')}</span>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <GoalStatusBadge />

          {agents.length > 1 && (
            <div className="flex items-center gap-0.5">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  title={agent.name}
                  className={`h-1 w-4 rounded-full transition-colors ${
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

          <button
            onClick={handleClear}
            disabled={isRunning}
            className="shrink-0 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            {t('workflow.clearCanvas')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkflowExecutionBar;
