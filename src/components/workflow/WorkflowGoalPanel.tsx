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
    <div className="border-b border-gray-200 bg-white px-4 py-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_220px_180px_auto]">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {t('workflow.goalPanel.projectGoal')}
          </label>
          <textarea
            value={projectGoal}
            onChange={(event) => setProjectGoal(event.target.value)}
            rows={3}
            placeholder={t('workflow.goalPanel.projectGoalPlaceholder')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {t('workflow.goalPanel.successCriteria')}
          </label>
          <textarea
            value={successCriteria}
            onChange={(event) => setSuccessCriteria(event.target.value)}
            rows={3}
            placeholder={t('workflow.goalPanel.successCriteriaPlaceholder')}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {t('workflow.goalPanel.goalEvaluator')}
          </label>
          <select
            value={goalEvaluatorAgentId}
            onChange={(event) => setGoalEvaluatorAgentId(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('workflow.goalPanel.builtinEvaluator')}</option>
            {evaluatorAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            {t('workflow.goalPanel.maxIterations')}
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={maxGoalIterations}
            onChange={(event) => setMaxGoalIterations(Math.max(1, Number(event.target.value) || 5))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-end">
          <button
            onClick={() => updateInstanceMeta(currentInstance.id, {
              projectGoal,
              successCriteria,
              goalEvaluatorAgentId: goalEvaluatorAgentId || null,
              maxGoalIterations,
            })}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t('workflow.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkflowGoalPanel;
