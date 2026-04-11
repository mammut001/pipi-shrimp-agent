/**
 * WorkflowView - Main workflow builder interface
 *
 * Combines canvas, config panel, execution bar, and output panel.
 * This is the main entry point for the workflow feature.
 */

import { useEffect, useState } from 'react';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowExecutionBar } from './WorkflowExecutionBar';
import { AgentConfigPanel } from './AgentConfigPanel';
import { WorkflowOutputPanel } from './WorkflowOutputPanel';
import { WorkflowRunHistory } from './WorkflowRunHistory';
import { useWorkflowStore } from '@/store/workflowStore';
import { t } from '@/i18n';

function WorkflowTaskPanel({ agentId }: { agentId: string }) {
  const agent = useWorkflowStore((state) => {
    const inst = state.instances.find(i => i.id === state.currentInstanceId);
    return inst?.agents.find((item) => item.id === agentId);
  });
  const updateAgent = useWorkflowStore((state) => state.updateAgent);
  const allAgents = useWorkflowStore((state) => {
    const inst = state.instances.find(i => i.id === state.currentInstanceId);
    return inst?.agents ?? [];
  });

  const [task, setTask] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskInstruction, setTaskInstruction] = useState('');

  useEffect(() => {
    setTask(agent?.task || '');
    setTaskPrompt(agent?.taskPrompt || '');
    setTaskInstruction(agent?.taskInstruction || '');
  }, [agent?.task, agent?.taskPrompt, agent?.taskInstruction, agent?.id]);

  if (!agent) return null;

  const upstreamAgent = agent.inputFrom
    ? allAgents.find((item) => item.id === agent.inputFrom)
    : null;

  const handleSave = () => {
    updateAgent(agentId, {
      task,
      taskPrompt,
      taskInstruction,
    });
  };

  return (
      <div className="border-b border-gray-200 bg-gray-50/70 px-4 py-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              {t('workflow.agentTask')}
            </div>
          <h3 className="mt-1 text-sm font-semibold text-gray-900">{agent.name}</h3>
          <p className="mt-1 text-xs text-gray-500">
            {t('workflow.agentTaskLabelHint')}
          </p>
        </div>
        <button
          onClick={handleSave}
          className="shrink-0 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t('workflow.save')}
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('workflow.agentTaskLabel')}
        </label>
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={t('workflow.agentTaskLabelPlaceholder')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          {t('workflow.agentTaskLabelHint')}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('workflow.taskPrompt')}
        </label>
        <textarea
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
          rows={4}
          placeholder={t('workflow.taskPromptPlaceholder')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <p className="mt-1 text-xs text-gray-400">
          {t('workflow.taskPromptHint')}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('workflow.taskInstruction')}
        </label>
        <textarea
          value={taskInstruction}
          onChange={(e) => setTaskInstruction(e.target.value)}
          rows={6}
          placeholder={t('workflow.taskInstructionPlaceholder')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <p className="mt-1 text-xs text-gray-400">
          {t('workflow.taskInstructionHint')}
        </p>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        {upstreamAgent
          ? t('workflow.upstreamInfo').replace('{name}', upstreamAgent.name)
          : t('workflow.upstreamNone')}
      </div>
    </div>
  );
}

export function WorkflowView() {
  const currentInstance = useWorkflowStore((state) =>
    state.instances.find(i => i.id === state.currentInstanceId) ?? null
  );
  const agents = currentInstance?.agents ?? [];
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [outputPanelOpen, setOutputPanelOpen] = useState(true);

  useEffect(() => {
    if (!selectedAgentId) return;
    const stillExists = agents.some((agent) => agent.id === selectedAgentId);
    if (!stillExists) {
      setSelectedAgentId(null);
    }
  }, [agents, selectedAgentId]);

  const handleAgentSelect = (id: string | null) => {
    setSelectedAgentId(id);
  };

  // No active workflow instance
  if (!currentInstance) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50">
        <div className="text-6xl mb-4 opacity-60">🦐</div>
        <h2 className="text-xl font-semibold text-gray-700 mb-2">
          No Active Workflow
        </h2>
        <p className="text-gray-400 mb-6 text-center max-w-sm">
          Create a new workflow to get started with multi-agent orchestration.
        </p>
        <button
          onClick={() => useWorkflowStore.getState().createInstance()}
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('workflow.newWorkflow')}
        </button>
      </div>
    );
  }

  return (
    <div key={currentInstance?.id ?? 'none'} className="flex flex-col h-full">
      {/* Top: Execution bar */}
      <WorkflowExecutionBar />

      {/* Main: Canvas + Config panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden bg-gray-50">
          <WorkflowCanvas
            selectedAgentId={selectedAgentId}
            onAgentSelect={handleAgentSelect}
          />
        </div>

        {/* Right: Agent config panel (320px) */}
        {selectedAgentId && (
          <div className="w-96 min-h-0 border-l border-gray-200 overflow-hidden bg-white flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <WorkflowTaskPanel agentId={selectedAgentId} />
              <AgentConfigPanel
                agentId={selectedAgentId}
                onClose={() => setSelectedAgentId(null)}
                hideTaskFields
                embedded
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom: Output panel (collapsible, ~200px) */}
      {outputPanelOpen && (
        <div className="h-48 border-t border-gray-200">
          <WorkflowOutputPanel key={currentInstance?.id ?? 'none'} />
        </div>
      )}

      {/* Toggle output panel */}
      <button
        onClick={() => setOutputPanelOpen(!outputPanelOpen)}
        className="absolute bottom-0 left-1/2 transform -translate-x-1/2 px-3 py-1 bg-white border border-gray-200 border-b-0 rounded-t-lg shadow-sm text-xs text-gray-500 hover:text-gray-700"
      >
        {outputPanelOpen ? '▼' : '▲'}
      </button>

      {/* History floating panel */}
      <WorkflowRunHistory />
    </div>
  );
}

export default WorkflowView;
