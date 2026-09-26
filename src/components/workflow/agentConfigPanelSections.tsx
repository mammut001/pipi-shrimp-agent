/**
 * Section panels for AgentConfigPanel.
 * Behavior-preserving extract (split-soon / <500 follow-up).
 */

import type { Dispatch, SetStateAction } from 'react';
import type { ProviderName } from '@/shared/providers';
import type { TranslationKeys } from '@/i18n';
import type {
  OutputRoute,
  RoleModelHint,
  RouteCondition,
  WorkflowAgent,
  WorkflowAgentRole,
  WorkflowConnection,
} from '@/types/workflow';
import { AGENT_TEMPLATES } from '@/services/workflow/templates/agentTemplates';
import { WORKFLOW_AGENT_ROLES } from '@/services/workflow/templates/roles';
import { t } from '@/i18n';
import {
  ROLE_LABEL_KEYS,
  formatOutputRouteConditionLabel,
  type AgentConfigFormData,
  type ConfigOption,
} from './agentConfigPanelUi';

export function AgentConfigIdentityFields({
  formData,
  setField,
}: {
  formData: AgentConfigFormData;
  setField: <K extends keyof AgentConfigFormData>(key: K, value: AgentConfigFormData[K]) => void;
}) {
  return (
    <>
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
    </>
  );
}

export function AgentConfigTaskFields({
  formData,
  setField,
}: {
  formData: AgentConfigFormData;
  setField: <K extends keyof AgentConfigFormData>(key: K, value: AgentConfigFormData[K]) => void;
}) {
  return (
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
  );
}

export function AgentConfigModelSection({
  formData,
  setFormData,
  setField,
  roleHint,
  configOptions,
  modelOptions,
  apiConfigs,
  applyRecommendedModel,
}: {
  formData: AgentConfigFormData;
  setFormData: Dispatch<SetStateAction<AgentConfigFormData>>;
  setField: <K extends keyof AgentConfigFormData>(key: K, value: AgentConfigFormData[K]) => void;
  roleHint?: RoleModelHint | null;
  configOptions: ConfigOption[];
  modelOptions: string[];
  apiConfigs: Array<{ id: string; provider: ProviderName; model?: string }>;
  applyRecommendedModel: () => void;
}) {
  return (
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
  );
}

export function AgentConfigUpstreamConnections({
  connections,
  allAgents,
}: {
  connections: WorkflowConnection[];
  allAgents: WorkflowAgent[];
}) {
  if (connections.length === 0) return null;

  return (
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
  );
}

export function AgentConfigInputSourceField({
  agent,
  agentId,
  otherAgents,
  isRunning,
  setAgentInputFrom,
}: {
  agent: WorkflowAgent;
  agentId: string;
  otherAgents: WorkflowAgent[];
  isRunning: boolean;
  setAgentInputFrom: (agentId: string, from: string | null) => void;
}) {
  return (
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
  );
}

export function AgentConfigNotifySection({
  formData,
  setFormData,
  otherAgents,
}: {
  formData: AgentConfigFormData;
  setFormData: Dispatch<SetStateAction<AgentConfigFormData>>;
  otherAgents: WorkflowAgent[];
}) {
  return (
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
  );
}

export function AgentConfigRetryPolicySection({
  formData,
  setFormData,
  configOptions,
}: {
  formData: AgentConfigFormData;
  setFormData: Dispatch<SetStateAction<AgentConfigFormData>>;
  configOptions: ConfigOption[];
}) {
  return (
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
  );
}

export function AgentConfigSoulField({
  formData,
  setField,
}: {
  formData: AgentConfigFormData;
  setField: <K extends keyof AgentConfigFormData>(key: K, value: AgentConfigFormData[K]) => void;
}) {
  return (
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
  );
}

export function AgentConfigExecutionSection({
  formData,
  setField,
}: {
  formData: AgentConfigFormData;
  setField: <K extends keyof AgentConfigFormData>(key: K, value: AgentConfigFormData[K]) => void;
}) {
  return (
    <>
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
    </>
  );
}

export function AgentConfigOutputRoutesSection({
  agentId,
  otherAgents,
  outputRoutes,
  missingRouteMarkers,
  newRoute,
  setNewRoute,
  isRunning,
  onAddRoute,
  onRemoveRoute,
}: {
  agentId: string;
  otherAgents: WorkflowAgent[];
  outputRoutes: OutputRoute[];
  missingRouteMarkers: string[];
  newRoute: {
    condition: RouteCondition;
    keyword: string;
    keywordMode: 'includes' | 'regex';
    targetAgentId: string;
  };
  setNewRoute: Dispatch<SetStateAction<{
    condition: RouteCondition;
    keyword: string;
    keywordMode: 'includes' | 'regex';
    targetAgentId: string;
  }>>;
  isRunning: boolean;
  onAddRoute: () => void;
  onRemoveRoute: (agentId: string, routeId: string) => void;
}) {
  return (
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
                {formatOutputRouteConditionLabel(route, t)}
                {' → '}
                {targetAgent?.name || '?'}
              </span>
              <button
                onClick={() => onRemoveRoute(agentId, route.id)}
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
            onClick={onAddRoute}
            disabled={isRunning || !newRoute.targetAgentId}
            className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          >
            + {t('workflow.addRoute')}
          </button>
        </div>
      )}
    </div>
  );
}

export function AgentConfigTemplateField({
  onTemplateSelect,
}: {
  onTemplateSelect: (templateId: string) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700">
        {t('workflow.template')}
      </label>
      <select
        value=""
        onChange={(event) => onTemplateSelect(event.target.value)}
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
  );
}

export function AgentConfigPanelSaveFooter({
  embedded,
  onSave,
}: {
  embedded: boolean;
  onSave: () => void;
}) {
  return (
    <div className={`${embedded ? 'px-4 pb-4' : 'border-t border-gray-200 px-4 py-3'}`}>
      <button
        onClick={onSave}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        {t('workflow.save')}
      </button>
    </div>
  );
}
