import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { getProviderDefaultModelIds, type ProviderName } from '@/shared/providers';
import type { TranslationKeys } from '@/i18n';
import {
  type RouteCondition,
  type WorkflowAgentRole,
} from '@/types/workflow';
import { AGENT_TEMPLATES } from '@/services/workflow/templates/agentTemplates';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_RETRY_POLICY,
} from '@/services/workflow/defaults';
import {
  WORKFLOW_AGENT_ROLES,
  getRoleModelHint,
  normalizeWorkflowAgentRole,
} from '@/services/workflow/templates/roles';
import {
  extractWorkflowMarkerTokens,
  normalizeWorkflowMarkerToken,
} from '@/services/workflow/templates/markers';
import {
  selectAgentIncomingConnections,
  selectAgentOutputRoutes,
} from '@/store/workflowStore';
import { t } from '@/i18n';

interface AgentConfigPanelProps {
  agentId: string;
  onClose: () => void;
  hideTaskFields?: boolean;
  embedded?: boolean;
}

const ROLE_LABEL_KEYS: Record<WorkflowAgentRole, keyof TranslationKeys> = {
  planner: 'workflow.role.custom',
  writer: 'workflow.role.writer',
  developer: 'workflow.role.coder',
  qa: 'workflow.role.tester',
  reviewer: 'workflow.role.reviewer',
  security: 'workflow.role.security',
  devops: 'workflow.role.devops',
  'goal-evaluator': 'workflow.role.goal-evaluator',
  custom: 'workflow.role.custom',
};

function getMissingExplicitRouteMarkers(agent: {
  taskPrompt?: string;
  taskInstruction?: string;
  soulPrompt?: string;
  outputRoutes: Array<{ condition: RouteCondition; keyword?: string }>;
}): string[] {
  const declaredMarkers = new Set(
    [agent.taskPrompt, agent.taskInstruction, agent.soulPrompt]
      .filter(Boolean)
      .flatMap((value) => extractWorkflowMarkerTokens(value!)),
  );

  const explicitKeywords = new Set(
    agent.outputRoutes
      .filter((route) => route.condition === 'outputContains' && route.keyword)
      .map((route) => normalizeWorkflowMarkerToken(route.keyword!) ?? route.keyword!.trim()),
  );

  return [...declaredMarkers].filter((marker) => !explicitKeywords.has(marker));
}

export function AgentConfigPanel({
  agentId,
  onClose,
  hideTaskFields = false,
  embedded = false,
}: AgentConfigPanelProps) {
  const agent = useWorkflowStore((state) => {
    const instance = state.instances.find((item) => item.id === state.currentInstanceId);
    return instance?.agents.find((item) => item.id === agentId);
  });
  const currentInstance = useWorkflowStore((state) =>
    state.instances.find((item) => item.id === state.currentInstanceId) ?? null,
  );
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const allAgents = currentInstance?.agents ?? [];
  const { updateAgent, addOutputRoute, removeOutputRoute, setAgentInputFrom } = useWorkflowStore();

  const apiConfigs = useSettingsStore((state) => state.apiConfigs);
  const availableModels = useSettingsStore((state) => state.availableModels);

  const [formData, setFormData] = useState({
    name: '',
    task: '',
    taskPrompt: '',
    taskInstruction: '',
    soulPrompt: '',
    execution: DEFAULT_EXECUTION_CONFIG,
    role: 'custom' as WorkflowAgentRole,
    configId: '',
    provider: '' as ProviderName | '',
    modelId: '',
    notifyOnComplete: [] as string[],
    retryPolicy: DEFAULT_RETRY_POLICY,
  });

  const [newRoute, setNewRoute] = useState({
    condition: 'onComplete' as RouteCondition,
    keyword: '',
    keywordMode: 'includes' as 'includes' | 'regex',
    targetAgentId: '',
  });

  useEffect(() => {
    if (!agent) return;
    setFormData({
      name: agent.name,
      task: agent.task || '',
      taskPrompt: agent.taskPrompt || '',
      taskInstruction: agent.taskInstruction || '',
      soulPrompt: agent.soulPrompt || '',
      execution: agent.execution || DEFAULT_EXECUTION_CONFIG,
      role: normalizeWorkflowAgentRole(agent.role),
      configId: agent.model?.configId || '',
      provider: (agent.model?.provider || '') as ProviderName | '',
      modelId: agent.model?.modelId || '',
      notifyOnComplete: agent.notifyOnComplete || [],
      retryPolicy: {
        ...DEFAULT_RETRY_POLICY,
        ...agent.retryPolicy,
        fallbackConfigIds: agent.retryPolicy?.fallbackConfigIds || [],
      },
    });
  }, [agent]);

  const roleHint = getRoleModelHint(formData.role);
  const selectedConfig = apiConfigs.find((config) => config.id === formData.configId) || null;
  const effectiveProvider = selectedConfig?.provider || formData.provider;
  const modelOptions = effectiveProvider
    ? availableModels[effectiveProvider] && availableModels[effectiveProvider].length > 0
      ? availableModels[effectiveProvider]
      : getProviderDefaultModelIds(effectiveProvider)
    : [];
  const otherAgents = allAgents.filter((item) => item.id !== agentId);
  const connections = selectAgentIncomingConnections(currentInstance, agentId);
  const outputRoutes = selectAgentOutputRoutes(currentInstance, agentId);
  const missingRouteMarkers = agent ? getMissingExplicitRouteMarkers({
    taskPrompt: agent.taskPrompt,
    taskInstruction: agent.taskInstruction,
    soulPrompt: agent.soulPrompt,
    outputRoutes,
  }) : [];

  const configOptions = useMemo(() => apiConfigs.map((config) => ({
    id: config.id,
    label: `${config.name} (${config.provider})`,
    provider: config.provider,
    model: config.model,
  })), [apiConfigs]);

  if (!agent) return null;

  const setField = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    updateAgent(agentId, {
      name: formData.name,
      soulPrompt: formData.soulPrompt,
      task: hideTaskFields ? agent.task : formData.task,
      taskPrompt: hideTaskFields ? agent.taskPrompt : formData.taskPrompt,
      taskInstruction: hideTaskFields ? agent.taskInstruction : formData.taskInstruction,
      execution: formData.execution,
      role: formData.role,
      model: formData.configId || formData.provider || formData.modelId
        ? {
            configId: formData.configId || undefined,
            provider: (selectedConfig?.provider || formData.provider || undefined) as ProviderName | undefined,
            modelId: formData.modelId || selectedConfig?.model || undefined,
          }
        : undefined,
      notifyOnComplete: formData.notifyOnComplete,
      retryPolicy: formData.retryPolicy,
    });
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = AGENT_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;

    setFormData((prev) => ({
      ...prev,
      name: template.name,
      task: template.task,
      taskPrompt: template.taskPrompt || '',
      taskInstruction: template.taskInstruction || '',
      soulPrompt: template.soulPrompt,
      execution: template.execution,
      role: template.recommendedRole || prev.role,
    }));
  };

  const handleAddRoute = () => {
    if (!newRoute.targetAgentId) return;
    addOutputRoute(agentId, {
      condition: newRoute.condition,
      keyword: newRoute.condition === 'outputContains' ? newRoute.keyword : undefined,
      keywordMode: newRoute.condition === 'outputContains' ? newRoute.keywordMode : undefined,
      targetAgentId: newRoute.targetAgentId,
    });
    setNewRoute({
      condition: 'onComplete',
      keyword: '',
      keywordMode: 'includes',
      targetAgentId: '',
    });
  };

  const applyRecommendedModel = () => {
    if (!roleHint) return;

    const recommendedConfig = configOptions.find((option) =>
      roleHint.preferredProviders.includes(option.provider),
    );
    const provider = recommendedConfig?.provider || roleHint.preferredProviders[0] || '';
    const models = provider ? (availableModels[provider]?.length ? availableModels[provider] : getProviderDefaultModelIds(provider)) : [];
    const recommendedModel = models.find((model) =>
      roleHint.preferredModelKeywords.some((keyword) => model.toLowerCase().includes(keyword.toLowerCase())),
    ) || models[0] || '';

    setFormData((prev) => ({
      ...prev,
      configId: recommendedConfig?.id || '',
      provider,
      modelId: recommendedModel,
    }));
  };

  const panelBody = (
    <div className={`space-y-4 ${embedded ? 'px-4 py-4' : 'flex-1 overflow-y-auto p-4'}`}>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t('workflow.agentName')}
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(event) => setField('name', event.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t('workflow.agentRole')}
        </label>
        <select
          value={formData.role}
          onChange={(event) => setField('role', event.target.value as WorkflowAgentRole)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {WORKFLOW_AGENT_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(ROLE_LABEL_KEYS[role])}
            </option>
          ))}
        </select>
      </div>

      {!hideTaskFields && (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('workflow.agentTaskLabel')}
            </label>
            <input
              type="text"
              value={formData.task}
              onChange={(event) => setField('task', event.target.value)}
              placeholder={t('workflow.agentTaskLabelPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('workflow.taskInstruction')}
            </label>
            <textarea
              value={formData.taskInstruction}
              onChange={(event) => setField('taskInstruction', event.target.value)}
              rows={5}
              placeholder={t('workflow.taskInstructionPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('workflow.taskPrompt')}
            </label>
            <textarea
              value={formData.taskPrompt}
              onChange={(event) => setField('taskPrompt', event.target.value)}
              rows={4}
              placeholder={t('workflow.taskPromptPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </>
      )}

      <div className="rounded-xl border border-gray-200 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-gray-900">{t('workflow.modelConfig')}</div>
            {roleHint && (
              <div className="text-xs text-gray-500" title={t(roleHint.reason as keyof TranslationKeys)}>
                {t('workflow.roleRecommendation').replace('{providers}', roleHint.preferredProviders.join(', ')).replace('{models}', roleHint.preferredModelKeywords.join(', '))}
              </div>
            )}
          </div>
          {roleHint && (
            <button
              onClick={applyRecommendedModel}
              type="button"
              className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              {t('workflow.applyRecommendation')}
            </button>
          )}
        </div>

        <div className="space-y-2">
          <select
            value={formData.configId}
            onChange={(event) => {
              const config = apiConfigs.find((item) => item.id === event.target.value) || null;
              setFormData((prev) => ({
                ...prev,
                configId: event.target.value,
                provider: config?.provider || prev.provider,
                modelId: prev.modelId || config?.model || '',
              }));
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('workflow.useMatchingProviderConfig')}</option>
            {configOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={formData.provider}
            onChange={(event) => setField('provider', event.target.value as ProviderName)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('workflow.selectProvider')}</option>
            {[...new Set(configOptions.map((option) => option.provider))].map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>

          <select
            value={formData.modelId}
            onChange={(event) => setField('modelId', event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t('workflow.selectModel')}</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </div>

      {connections.length > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {t('workflow.waitingUpstream')}
          </label>
          <div className="flex flex-wrap gap-1">
            {connections.map((connection) => {
              const upstreamAgent = allAgents.find((item) => item.id === connection.sourceAgentId);
              return upstreamAgent ? (
                <span key={connection.id} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                  {upstreamAgent.name}
                </span>
              ) : null;
            })}
          </div>
        </div>
      )}

      {isRunning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          工作流运行中，当前不能修改上下游连接与输出路由。
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t('workflow.inputSource')}
        </label>
        <select
          value={agent.inputFrom || ''}
          onChange={(event) => setAgentInputFrom(agentId, event.target.value || null)}
          disabled={isRunning}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{t('workflow.entryNode')}</option>
          {otherAgents.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t('workflow.notifyOnComplete')}
        </label>
        <div className="space-y-2 rounded-xl border border-gray-200 p-3">
          {otherAgents.length === 0 ? (
            <div className="text-sm text-gray-400">{t('workflow.notifyOnCompleteEmpty')}</div>
          ) : otherAgents.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={formData.notifyOnComplete.includes(item.id)}
                onChange={(event) => setFormData((prev) => ({
                  ...prev,
                  notifyOnComplete: event.target.checked
                    ? [...prev.notifyOnComplete, item.id]
                    : prev.notifyOnComplete.filter((id) => id !== item.id),
                }))}
              />
              {item.name}
            </label>
          ))}
        </div>
      </div>

      <details className="rounded-xl border border-gray-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-900">
          {t('workflow.retryPolicy')}
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('workflow.retryMaxAttempts')}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={formData.retryPolicy.maxAttempts}
                onChange={(event) => setFormData((prev) => ({
                  ...prev,
                  retryPolicy: { ...prev.retryPolicy, maxAttempts: Math.max(1, Number(event.target.value) || 1) },
                }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('workflow.retryBackoffMs')}
              </label>
              <input
                type="number"
                min={0}
                step={100}
                value={formData.retryPolicy.backoffMs}
                onChange={(event) => setFormData((prev) => ({
                  ...prev,
                  retryPolicy: { ...prev.retryPolicy, backoffMs: Math.max(0, Number(event.target.value) || 0) },
                }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('workflow.retryFallbackConfigs')}
            </label>
            <div className="space-y-2 rounded-xl border border-gray-200 p-3">
              {configOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formData.retryPolicy.fallbackConfigIds?.includes(option.id) || false}
                    onChange={(event) => setFormData((prev) => ({
                      ...prev,
                      retryPolicy: {
                        ...prev.retryPolicy,
                        fallbackConfigIds: event.target.checked
                          ? [...(prev.retryPolicy.fallbackConfigIds || []), option.id]
                          : (prev.retryPolicy.fallbackConfigIds || []).filter((id) => id !== option.id),
                      },
                    }))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </details>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Soul Prompt
        </label>
        <textarea
          value={formData.soulPrompt}
          onChange={(event) => setField('soulPrompt', event.target.value)}
          rows={6}
          placeholder={t('workflow.systemPromptPlaceholder')}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('workflow.executionMode')}
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={formData.execution.mode === 'single'}
              onChange={() => setField('execution', { mode: 'single' })}
            />
            {t('workflow.singleExecution')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={formData.execution.mode === 'multi-round'}
              onChange={() => setField('execution', { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' })}
            />
            {t('workflow.multiExecution')}
          </label>
        </div>
      </div>

      {formData.execution.mode === 'multi-round' && (
        <div className="space-y-3 rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">{t('workflow.maxRounds')}</span>
            <input
              type="number"
              min={1}
              max={10}
              value={formData.execution.maxRounds || 3}
              onChange={(event) => setField('execution', {
                ...formData.execution,
                maxRounds: Math.max(1, Number(event.target.value) || 3),
              })}
              className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </div>

          <select
            value={formData.execution.roundCondition || 'untilComplete'}
            onChange={(event) => setField('execution', {
              ...formData.execution,
              roundCondition: event.target.value as 'untilComplete' | 'untilError' | 'fixed',
            })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="untilComplete">{t('workflow.untilComplete')}</option>
            <option value="untilError">{t('workflow.untilError')}</option>
            <option value="fixed">{t('workflow.fixedRounds')}</option>
          </select>
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('workflow.outputRoutes')}
        </label>

        {missingRouteMarkers.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="font-medium">{t('workflow.missingOutputRouteWarning')}</div>
            <div className="mt-1 text-amber-800">
              {t('workflow.missingOutputRouteHint').replace('{markers}', missingRouteMarkers.join(', '))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {outputRoutes.map((route) => {
            const targetAgent = otherAgents.find((item) => item.id === route.targetAgentId);
            return (
              <div key={route.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span className="text-gray-600">
                  {route.condition === 'onComplete' && t('workflow.onComplete')}
                  {route.condition === 'onError' && t('workflow.onError')}
                  {route.condition === 'outputContains' && `${t('workflow.outputContains')} (${route.keywordMode || 'includes'}) "${route.keyword}"`}
                  {route.condition === 'always' && t('workflow.always')}
                  {' → '}
                  {targetAgent?.name || '?'}
                </span>
                <button
                  onClick={() => removeOutputRoute(agentId, route.id)}
                  disabled={isRunning}
                  className="text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {otherAgents.length > 0 && (
          <div className="mt-3 space-y-2 rounded-xl border border-gray-200 p-3">
            <select
              value={newRoute.condition}
              onChange={(event) => setNewRoute((prev) => ({ ...prev, condition: event.target.value as RouteCondition }))}
              disabled={isRunning}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="onComplete">{t('workflow.onComplete')}</option>
              <option value="onError">{t('workflow.onError')}</option>
              <option value="outputContains">{t('workflow.outputContains')}</option>
              <option value="always">{t('workflow.always')}</option>
            </select>

            {newRoute.condition === 'outputContains' && (
              <>
                <input
                  type="text"
                  value={newRoute.keyword}
                  onChange={(event) => setNewRoute((prev) => ({ ...prev, keyword: event.target.value }))}
                  disabled={isRunning}
                  placeholder={t('workflow.keywordPlaceholder')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <select
                  value={newRoute.keywordMode}
                  onChange={(event) => setNewRoute((prev) => ({ ...prev, keywordMode: event.target.value as 'includes' | 'regex' }))}
                  disabled={isRunning}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="includes">{t('workflow.routeMatch.includes')}</option>
                  <option value="regex">{t('workflow.routeMatch.regex')}</option>
                </select>
              </>
            )}

            <select
              value={newRoute.targetAgentId}
              onChange={(event) => setNewRoute((prev) => ({ ...prev, targetAgentId: event.target.value }))}
              disabled={isRunning}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">{t('workflow.selectTargetAgent')}</option>
              {otherAgents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>

            <button
              onClick={handleAddRoute}
              disabled={isRunning || !newRoute.targetAgentId}
              className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            >
              + {t('workflow.addRoute')}
            </button>
          </div>
        )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('workflow.template')}
        </label>
        <select
          value=""
          onChange={(event) => handleTemplateSelect(event.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{t('workflow.loadTemplate')}</option>
          {AGENT_TEMPLATES.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <div className={`bg-white ${embedded ? '' : 'flex h-full flex-col'}`}>
      {!embedded && (
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="font-medium text-gray-900">{t('workflow.agentConfig')}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>
      )}

      {panelBody}

      <div className={`${embedded ? 'px-4 pb-4' : 'border-t border-gray-200 px-4 py-3'}`}>
        <button
          onClick={handleSave}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          {t('workflow.save')}
        </button>
      </div>
    </div>
  );
}

export default AgentConfigPanel;
