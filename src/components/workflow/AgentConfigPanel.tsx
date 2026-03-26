/**
 * AgentConfigPanel - Configuration panel for editing an agent
 *
 * Located on the right side of the canvas.
 * Contains form fields for:
 * - Agent name
 * - Task description
 * - Soul prompt (textarea)
 * - Execution mode (single/multi-round)
 * - Model override (optional)
 * - Output routes
 * - Template loading
 */

import { useState, useEffect } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { AGENT_TEMPLATES, DEFAULT_EXECUTION_CONFIG } from '@/types/workflow';
import type { RouteCondition } from '@/types/workflow';

interface AgentConfigPanelProps {
  agentId: string;
  onClose: () => void;
}

export function AgentConfigPanel({ agentId, onClose }: AgentConfigPanelProps) {
  const agent = useWorkflowStore((state) =>
    state.agents.find((a) => a.id === agentId)
  );
  const allAgents = useWorkflowStore((state) => state.agents);
  const { updateAgent, addOutputRoute, removeOutputRoute, setAgentInputFrom } = useWorkflowStore();

  const [formData, setFormData] = useState({
    name: '',
    task: '',
    soulPrompt: '',
    execution: DEFAULT_EXECUTION_CONFIG,
    modelProvider: '',
    modelId: '',
    modelApiKey: '',
    modelBaseUrl: '',
  });

  const [newRoute, setNewRoute] = useState({
    condition: 'onComplete' as RouteCondition,
    keyword: '',
    targetAgentId: '',
  });

  useEffect(() => {
    if (agent) {
      setFormData({
        name: agent.name,
        task: agent.task || '',
        soulPrompt: agent.soulPrompt || '',
        execution: agent.execution || DEFAULT_EXECUTION_CONFIG,
        modelProvider: agent.model?.provider || '',
        modelId: agent.model?.modelId || '',
        modelApiKey: agent.model?.apiKey || '',
        modelBaseUrl: agent.model?.baseUrl || '',
      });
    }
  }, [agent]);

  if (!agent) return null;

  const handleSave = () => {
    const updates: any = {
      name: formData.name,
      task: formData.task,
      soulPrompt: formData.soulPrompt,
      execution: formData.execution,
    };

    // Only add model override if at least one field is filled
    if (formData.modelProvider || formData.modelId) {
      updates.model = {
        provider: formData.modelProvider,
        modelId: formData.modelId,
        apiKey: formData.modelApiKey || undefined,
        baseUrl: formData.modelBaseUrl || undefined,
      };
    }

    updateAgent(agentId, updates);
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = AGENT_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      setFormData((prev) => ({
        ...prev,
        name: template.name,
        task: template.task,
        soulPrompt: template.soulPrompt,
        execution: template.execution,
      }));
    }
  };

  const handleAddRoute = () => {
    if (newRoute.targetAgentId) {
      addOutputRoute(agentId, {
        condition: newRoute.condition,
        keyword: newRoute.condition === 'outputContains' ? newRoute.keyword : undefined,
        targetAgentId: newRoute.targetAgentId,
      });
      setNewRoute({
        condition: 'onComplete',
        keyword: '',
        targetAgentId: '',
      });
    }
  };

  // Get other agents for route targets
  const otherAgents = useWorkflowStore((state) =>
    state.agents.filter((a) => a.id !== agentId)
  );

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="font-medium text-gray-900">Agent 配置</h2>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-600 rounded"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Agent Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Agent 名称
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Task Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Task 描述
          </label>
          <input
            type="text"
            value={formData.task}
            onChange={(e) => setFormData({ ...formData, task: e.target.value })}
            placeholder="描述这个 Agent 的任务..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* InputFrom - Upstream Agent Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            输入来源 <span className="text-xs text-gray-400">(上游 Agent)</span>
          </label>
          <select
            value={agent.inputFrom || ''}
            onChange={(e) => setAgentInputFrom(agentId, e.target.value || null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">入口节点（无上游）</option>
            {allAgents
              .filter((a) => a.id !== agentId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            {agent.inputFrom
              ? `将接收「${allAgents.find((a) => a.id === agent.inputFrom)?.name}」的输出作为输入`
              : '此 Agent 将作为入口节点启动'}
          </p>
        </div>

        {/* Soul Prompt */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Soul Prompt
          </label>
          <textarea
            value={formData.soulPrompt}
            onChange={(e) => setFormData({ ...formData, soulPrompt: e.target.value })}
            rows={6}
            placeholder="Agent 的系统提示词..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Execution Mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            执行模式
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="executionMode"
                checked={formData.execution.mode === 'single'}
                onChange={() => setFormData({ ...formData, execution: { mode: 'single' } })}
                className="text-blue-600"
              />
              单次执行
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="executionMode"
                checked={formData.execution.mode === 'multi-round'}
                onChange={() =>
                  setFormData({
                    ...formData,
                    execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
                  })
                }
                className="text-blue-600"
              />
              多轮执行
            </label>
          </div>

          {formData.execution.mode === 'multi-round' && (
            <div className="mt-3 space-y-2 pl-4 border-l-2 border-gray-200">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">最大轮数:</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={formData.execution.maxRounds || 3}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      execution: { ...formData.execution, maxRounds: parseInt(e.target.value) || 3 },
                    })
                  }
                  className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">停止条件:</span>
                <select
                  value={formData.execution.roundCondition || 'untilComplete'}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      execution: { ...formData.execution, roundCondition: e.target.value as any },
                    })
                  }
                  className="px-2 py-1 border border-gray-300 rounded text-sm"
                >
                  <option value="untilComplete">直到完成</option>
                  <option value="untilError">直到错误</option>
                  <option value="fixed">固定轮数</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Model Override */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Model 覆盖（可选）
          </label>
          <div className="space-y-2">
            <input
              type="text"
              value={formData.modelProvider}
              onChange={(e) => setFormData({ ...formData, modelProvider: e.target.value })}
              placeholder="Provider (如 anthropic)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={formData.modelId}
              onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
              placeholder="Model ID (如 claude-3-5-sonnet-20241022)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password"
              value={formData.modelApiKey}
              onChange={(e) => setFormData({ ...formData, modelApiKey: e.target.value })}
              placeholder="API Key (可选)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={formData.modelBaseUrl}
              onChange={(e) => setFormData({ ...formData, modelBaseUrl: e.target.value })}
              placeholder="Base URL (可选)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Output Routes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            输出路由
          </label>

          {/* Existing routes */}
          {agent.outputRoutes.map((route) => {
            const targetAgent = otherAgents.find((a) => a.id === route.targetAgentId);
            return (
              <div
                key={route.id}
                className="flex items-center justify-between px-3 py-2 mb-2 bg-gray-50 rounded-lg text-sm"
              >
                <span className="text-gray-600">
                  {route.condition === 'onComplete' && '完成时'}
                  {route.condition === 'onError' && '错误时'}
                  {route.condition === 'outputContains' && `包含"${route.keyword}"`}
                  {route.condition === 'always' && '总是'}
                  → {targetAgent?.name || '未知'}
                </span>
                <button
                  onClick={() => removeOutputRoute(agentId, route.id)}
                  className="text-red-500 hover:text-red-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}

          {/* Add new route */}
          {otherAgents.length > 0 && (
            <div className="space-y-2">
              <select
                value={newRoute.condition}
                onChange={(e) => setNewRoute({ ...newRoute, condition: e.target.value as RouteCondition })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="onComplete">完成时</option>
                <option value="onError">错误时</option>
                <option value="outputContains">输出包含</option>
                <option value="always">总是</option>
              </select>

              {newRoute.condition === 'outputContains' && (
                <input
                  type="text"
                  value={newRoute.keyword}
                  onChange={(e) => setNewRoute({ ...newRoute, keyword: e.target.value })}
                  placeholder="关键词 (如 &lt;PASS&gt;)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              )}

              <select
                value={newRoute.targetAgentId}
                onChange={(e) => setNewRoute({ ...newRoute, targetAgentId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">选择目标 Agent</option>
                {otherAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>

              <button
                onClick={handleAddRoute}
                disabled={!newRoute.targetAgentId}
                className="w-full px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                + 添加路由
              </button>
            </div>
          )}
        </div>

        {/* Template Loader */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            预设模板
          </label>
          <select
            value=""
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">从模板加载...</option>
            {AGENT_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Save button */}
      <div className="px-4 py-3 border-t border-gray-200">
        <button
          onClick={handleSave}
          className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          保存更改
        </button>
      </div>
    </div>
  );
}

export default AgentConfigPanel;
