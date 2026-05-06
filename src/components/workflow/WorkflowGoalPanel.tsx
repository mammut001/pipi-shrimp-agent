import { useEffect, useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { t } from '@/i18n';

export function WorkflowGoalPanel() {
  const currentInstance = useWorkflowStore((state) =>
    state.instances.find((instance) => instance.id === state.currentInstanceId) ?? null,
  );
  const updateInstanceMeta = useWorkflowStore((state) => state.updateInstanceMeta);

  const [projectGoal, setProjectGoal] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [goalEvaluatorAgentId, setGoalEvaluatorAgentId] = useState<string>('');
  const [maxGoalIterations, setMaxGoalIterations] = useState(5);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!currentInstance) return;
    setProjectGoal(currentInstance.projectGoal || '');
    setSuccessCriteria(currentInstance.successCriteria || '');
    setGoalEvaluatorAgentId(currentInstance.goalEvaluatorAgentId || '');
    setMaxGoalIterations(currentInstance.maxGoalIterations || 5);
  }, [
    currentInstance?.goalEvaluatorAgentId,
    currentInstance?.id,
    currentInstance?.maxGoalIterations,
    currentInstance?.projectGoal,
    currentInstance?.successCriteria,
  ]);

  if (!currentInstance) {
    return null;
  }

  const evaluatorAgents = currentInstance.agents.filter((agent) => agent.role === 'goal-evaluator');

  return (
    <section className="shrink-0 border-b border-gray-200 bg-white px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <label className="block text-xs font-medium text-gray-500">
            {t('workflow.goalPanel.projectGoal')}
          </label>
          <textarea
            value={projectGoal}
            onChange={(event) => setProjectGoal(event.target.value)}
            rows={2}
            placeholder={t('workflow.goalPanel.projectGoalPlaceholder')}
            className="mt-1 block h-20 max-h-28 min-h-[80px] w-full max-w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
          >
            {expanded ? t('workflow.goalPanel.collapseConfig') : t('workflow.goalPanel.expandConfig')}
          </button>
          <button
            onClick={() => updateInstanceMeta(currentInstance.id, {
              projectGoal,
              successCriteria,
              goalEvaluatorAgentId: goalEvaluatorAgentId || null,
              maxGoalIterations,
            })}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t('workflow.save')}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-500">
              {t('workflow.goalPanel.successCriteria')}
            </label>
            <textarea
              value={successCriteria}
              onChange={(event) => setSuccessCriteria(event.target.value)}
              rows={3}
              placeholder={t('workflow.goalPanel.successCriteriaPlaceholder')}
              className="mt-1 block min-h-[88px] w-full max-w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-500">
              {t('workflow.goalPanel.goalEvaluator')}
            </label>
            <select
              value={goalEvaluatorAgentId}
              onChange={(event) => setGoalEvaluatorAgentId(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('workflow.goalPanel.builtinEvaluator')}</option>
              {evaluatorAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-500">
              {t('workflow.goalPanel.maxIterations')}
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxGoalIterations}
              onChange={(event) => setMaxGoalIterations(Math.max(1, Number(event.target.value) || 5))}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      )}
    </section>
  );
}

export default WorkflowGoalPanel;
