/**
 * Presentational helpers for AgentConfigPanel.
 * Behavior-preserving extract (split-soon / >800 governance).
 */

import React from 'react';
import type { TranslationKeys } from '@/i18n';
import { t } from '@/i18n';
import { getProviderDefaultModelIds, type ProviderName } from '@/shared/providers';
import type {
  AgentExecutionConfig,
  RetryPolicy,
  RoleModelHint,
  RouteCondition,
  WorkflowAgent,
  WorkflowAgentRole,
} from '@/types/workflow';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_RETRY_POLICY,
} from '@/services/workflow/defaults';
import { normalizeWorkflowAgentRole } from '@/services/workflow/templates/roles';
import {
  extractWorkflowMarkerTokens,
  normalizeWorkflowMarkerToken,
} from '@/services/workflow/templates/markers';

export const ROLE_LABEL_KEYS: Record<WorkflowAgentRole, keyof TranslationKeys> = {
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

export function getMissingExplicitRouteMarkers(agent: {
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

export interface BuildModelOptionsParams {
  effectiveProvider?: string;
  selectedConfig?: { model?: string } | null;
  apiConfigs: Array<{ provider: string; model?: string }>;
  availableModels: Record<string, string[]>;
}

export function buildModelOptions({
  effectiveProvider,
  selectedConfig,
  apiConfigs,
  availableModels,
}: BuildModelOptionsParams): string[] {
  if (!effectiveProvider) return [];
  const modelSet = new Set<string>();

  if (selectedConfig?.model?.trim()) {
    modelSet.add(selectedConfig.model.trim());
  }
  apiConfigs
    .filter((c) => c.provider === effectiveProvider)
    .forEach((c) => {
      if (c.model?.trim()) modelSet.add(c.model.trim());
    });

  const fetched = availableModels[effectiveProvider];
  if (fetched && fetched.length > 0) {
    fetched.forEach((m) => {
      if (m?.trim()) modelSet.add(m.trim());
    });
  }

  getProviderDefaultModelIds(effectiveProvider).forEach((m) => {
    if (m?.trim()) modelSet.add(m.trim());
  });

  return Array.from(modelSet);
}

export interface ConfigOption {
  id: string;
  label: string;
  provider: string;
  model: string;
}

export function buildConfigOptions(
  apiConfigs: Array<{ id: string; name: string; provider: string; model: string }>,
): ConfigOption[] {
  return apiConfigs.map((config) => ({
    id: config.id,
    label: `${config.name} (${config.provider})`,
    provider: config.provider,
    model: config.model,
  }));
}

export interface AgentConfigFormData {
  name: string;
  task: string;
  taskPrompt: string;
  taskInstruction: string;
  soulPrompt: string;
  execution: AgentExecutionConfig;
  role: WorkflowAgentRole;
  configId: string;
  provider: ProviderName | '';
  modelId: string;
  notifyOnComplete: string[];
  retryPolicy: RetryPolicy;
}

export function createAgentConfigFormData(
  agent?: Partial<WorkflowAgent> | null,
): AgentConfigFormData {
  if (!agent) {
    return {
      name: '',
      task: '',
      taskPrompt: '',
      taskInstruction: '',
      soulPrompt: '',
      execution: DEFAULT_EXECUTION_CONFIG,
      role: 'custom',
      configId: '',
      provider: '',
      modelId: '',
      notifyOnComplete: [],
      retryPolicy: DEFAULT_RETRY_POLICY,
    };
  }

  return {
    name: agent.name || '',
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
  };
}

export interface RecommendedModelSelection {
  configId: string;
  provider: ProviderName | '';
  modelId: string;
}

export interface ResolveRecommendedModelSelectionParams {
  roleHint?: RoleModelHint | null;
  configOptions: Array<{ id: string; provider: string; model?: string }>;
  availableModels: Record<string, string[]>;
}

export function resolveRecommendedModelSelection({
  roleHint,
  configOptions,
  availableModels,
}: ResolveRecommendedModelSelectionParams): RecommendedModelSelection | null {
  if (!roleHint) return null;

  const recommendedConfig = configOptions.find((option) =>
    roleHint.preferredProviders.includes(option.provider as ProviderName),
  );
  const provider = (recommendedConfig?.provider || roleHint.preferredProviders[0] || '') as ProviderName | '';
  const models = provider
    ? availableModels[provider]?.length
      ? availableModels[provider]
      : getProviderDefaultModelIds(provider)
    : [];
  const recommendedModel =
    models.find((model) =>
      roleHint.preferredModelKeywords.some((keyword) =>
        model.toLowerCase().includes(keyword.toLowerCase()),
      ),
    ) ||
    models[0] ||
    '';

  return {
    configId: recommendedConfig?.id || '',
    provider,
    modelId: recommendedModel,
  };
}

export function formatOutputRouteConditionLabel(
  route: { condition: RouteCondition; keyword?: string; keywordMode?: string },
  translate: (key: keyof TranslationKeys) => string = t,
): string {
  switch (route.condition) {
    case 'onComplete':
      return translate('workflow.onComplete');
    case 'onError':
      return translate('workflow.onError');
    case 'outputContains':
      return `${translate('workflow.outputContains')} (${route.keywordMode || 'includes'}) "${route.keyword}"`;
    case 'always':
      return translate('workflow.always');
    default:
      return route.condition;
  }
}

export function TopologyRunningLockBanner(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      工作流运行中，当前不能修改上下游连接与输出路由。
    </div>
  );
}

export interface AgentConfigPanelChromeHeaderProps {
  title: string;
  onClose: () => void;
}

export function AgentConfigPanelChromeHeader({
  title,
  onClose,
}: AgentConfigPanelChromeHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
      <h2 className="font-medium text-gray-900">{title}</h2>
      <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
        ×
      </button>
    </div>
  );
}
