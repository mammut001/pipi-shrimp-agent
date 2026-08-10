import { useWorkflowStore } from '@/store/workflowStore';
import { t } from '@/i18n';

export function GoalStatusBadge() {
  const currentInstance = useWorkflowStore((state) =>
    state.instances.find((instance) => instance.id === state.currentInstanceId) ?? null,
  );
  const isRunning = useWorkflowStore((state) => state.isRunning);

  const workflowRuns = currentInstance?.workflowRuns ?? [];
  const activeRun = currentInstance?.activeRunId
    ? workflowRuns.find((run) => run.id === currentInstance.activeRunId) ?? workflowRuns[0]
    : workflowRuns[0];
  const maxIterations = currentInstance?.maxGoalIterations ?? 5;
  const currentIteration = activeRun?.currentIteration ?? 0;
  const evaluations = activeRun?.goalEvaluations ?? [];
  const latestEvaluation = evaluations.length > 0 ? evaluations[evaluations.length - 1] : null;

  const currentRunningAgentId = useWorkflowStore((state) => state.currentRunningAgentId);
  const isEvaluatingGoal = isRunning && currentRunningAgentId === null;

  const status = latestEvaluation?.reached
    ? { icon: '✅', label: t('workflow.goalStatus.reached'), className: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    : latestEvaluation && !isRunning
      ? { icon: '❌', label: t('workflow.goalStatus.notReached'), className: 'bg-rose-50 text-rose-700 border-rose-200' }
      : !latestEvaluation && !isRunning && currentIteration === 0
        ? { icon: '⚪', label: t('workflow.goalStatus.notStarted'), className: 'bg-slate-50 text-slate-600 border-slate-200' }
        : isEvaluatingGoal
          ? { icon: '⏳', label: t('workflow.goalStatus.evaluating'), className: 'bg-purple-50 text-purple-700 border-purple-200' }
          : { icon: '⚡', label: t('workflow.goalStatus.inProgress'), className: 'bg-blue-50 text-blue-700 border-blue-200' };

  const missingItems = latestEvaluation?.missingItems?.length
    ? latestEvaluation.missingItems.join('\n')
    : t('workflow.goalStatus.noMissingItems');

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${status.className}`}
      title={missingItems}
    >
      <span>{status.icon}</span>
      <span>{`Iter ${currentIteration}/${maxIterations}`}</span>
      <span>{status.label}</span>
    </div>
  );
}

export default GoalStatusBadge;
