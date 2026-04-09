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

function WorkflowTaskPanel({ agentId }: { agentId: string }) {
  const agent = useWorkflowStore((state) =>
    state.agents.find((item) => item.id === agentId)
  );
  const updateAgent = useWorkflowStore((state) => state.updateAgent);
  const allAgents = useWorkflowStore((state) => state.agents);

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
              Agent Task
            </div>
          <h3 className="mt-1 text-sm font-semibold text-gray-900">{agent.name}</h3>
          <p className="mt-1 text-xs text-gray-500">
            先在这里写清楚这个 Agent 的职责。下面的配置面板再调模型、路由和执行模式。
          </p>
        </div>
        <button
          onClick={handleSave}
          className="shrink-0 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          保存
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          任务标签
        </label>
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="如：撰写架构优化文档"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          这个短标题会显示在画布节点上。
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          任务 Prompt
        </label>
        <textarea
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
          rows={4}
          placeholder="例如：请写一个关于 PiPi Shrimp 当前架构和优化方向的调研报告。"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <p className="mt-1 text-xs text-gray-400">
          这里写这次具体想让它产出的内容。发送给模型时，会和下面的任务指令一起组合。
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          任务指令
        </label>
        <textarea
          value={taskInstruction}
          onChange={(e) => setTaskInstruction(e.target.value)}
          rows={6}
          placeholder="例如：请你写一份详细的 PiPi Shrimp 架构优化文档，重点说明当前问题、改造方向、影响范围和分阶段实施建议。"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <p className="mt-1 text-xs text-gray-400">
          这段会直接注入到该 Agent 的执行提示词里，适合写这个节点的固定职责模板。
        </p>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        {upstreamAgent
          ? `当前会接收上游「${upstreamAgent.name}」的输出，然后基于它继续工作。`
          : '当前是入口节点，没有上游输入，会直接根据 Workflow 的目标启动。'}
      </div>
    </div>
  );
}

export function WorkflowView() {
  const agents = useWorkflowStore((state) => state.agents);
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

  return (
    <div className="flex flex-col h-full">
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
          <WorkflowOutputPanel />
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
