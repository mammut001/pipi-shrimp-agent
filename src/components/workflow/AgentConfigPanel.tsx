import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useWorkflowStore } from '@/store/workflowStore';
import type { ProviderName } from '@/shared/providers';
import { AGENT_TEMPLATES } from '@/services/workflow/templates/agentTemplates';
import { getRoleModelHint } from '@/services/workflow/templates/roles';
import {
  selectAgentIncomingConnections,
  selectAgentOutputRoutes,
} from '@/store/workflowStore';
import { t } from '@/i18n';
import type { RouteCondition } from '@/types/workflow';
import {
  getMissingExplicitRouteMarkers,
  buildModelOptions,
  buildConfigOptions,
  createAgentConfigFormData,
  resolveRecommendedModelSelection,
  TopologyRunningLockBanner,
  AgentConfigPanelChromeHeader,
  type AgentConfigFormData,
} from './agentConfigPanelUi';
import {
  AgentConfigIdentityFields,
  AgentConfigTaskFields,
  AgentConfigModelSection,
  AgentConfigUpstreamConnections,
  AgentConfigInputSourceField,
  AgentConfigNotifySection,
  AgentConfigRetryPolicySection,
  AgentConfigSoulField,
  AgentConfigExecutionSection,
  AgentConfigOutputRoutesSection,
  AgentConfigTemplateField,
  AgentConfigPanelSaveFooter,
} from './agentConfigPanelSections';

interface AgentConfigPanelProps {
  agentId: string;
  onClose: () => void;
  hideTaskFields?: boolean;
  embedded?: boolean;
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

  const [formData, setFormData] = useState<AgentConfigFormData>(() =>
    createAgentConfigFormData(null),
  );

  const [newRoute, setNewRoute] = useState({
    condition: 'onComplete' as RouteCondition,
    keyword: '',
    keywordMode: 'includes' as 'includes' | 'regex',
    targetAgentId: '',
  });

  useEffect(() => {
    if (!agent) return;
    setFormData(createAgentConfigFormData(agent));
  }, [agent]);

  const roleHint = getRoleModelHint(formData.role);
  const selectedConfig = apiConfigs.find((config) => config.id === formData.configId) || null;
  const effectiveProvider = selectedConfig?.provider || formData.provider;
  const modelOptions = useMemo(
    () =>
      buildModelOptions({
        effectiveProvider,
        selectedConfig,
        apiConfigs,
        availableModels,
      }),
    [effectiveProvider, selectedConfig, apiConfigs, availableModels],
  );
  const otherAgents = allAgents.filter((item) => item.id !== agentId);
  const connections = selectAgentIncomingConnections(currentInstance, agentId);
  const outputRoutes = selectAgentOutputRoutes(currentInstance, agentId);
  const missingRouteMarkers = agent ? getMissingExplicitRouteMarkers({
    taskPrompt: agent.taskPrompt,
    taskInstruction: agent.taskInstruction,
    soulPrompt: agent.soulPrompt,
    outputRoutes,
  }) : [];

  const configOptions = useMemo(
    () => buildConfigOptions(apiConfigs),
    [apiConfigs],
  );

  if (!agent) return null;

  const setField = <K extends keyof AgentConfigFormData>(key: K, value: AgentConfigFormData[K]) => {
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
    const recommended = resolveRecommendedModelSelection({
      roleHint,
      configOptions,
      availableModels,
    });
    if (!recommended) return;

    setFormData((prev) => ({
      ...prev,
      ...recommended,
    }));
  };

  const panelBody = (
    <div className={`space-y-4 ${embedded ? 'px-4 py-4' : 'flex-1 overflow-y-auto p-4'}`}>
      <AgentConfigIdentityFields formData={formData} setField={setField} />

      {!hideTaskFields && (
        <AgentConfigTaskFields formData={formData} setField={setField} />
      )}

      <AgentConfigModelSection
        formData={formData}
        setFormData={setFormData}
        setField={setField}
        roleHint={roleHint}
        configOptions={configOptions}
        modelOptions={modelOptions}
        apiConfigs={apiConfigs}
        applyRecommendedModel={applyRecommendedModel}
      />

      <AgentConfigUpstreamConnections connections={connections} allAgents={allAgents} />

      {isRunning && <TopologyRunningLockBanner />}

      <AgentConfigInputSourceField
        agent={agent}
        agentId={agentId}
        otherAgents={otherAgents}
        isRunning={isRunning}
        setAgentInputFrom={setAgentInputFrom}
      />

      <AgentConfigNotifySection
        formData={formData}
        setFormData={setFormData}
        otherAgents={otherAgents}
      />

      <AgentConfigRetryPolicySection
        formData={formData}
        setFormData={setFormData}
        configOptions={configOptions}
      />

      <AgentConfigSoulField formData={formData} setField={setField} />

      <AgentConfigExecutionSection formData={formData} setField={setField} />

      <AgentConfigOutputRoutesSection
        agentId={agentId}
        otherAgents={otherAgents}
        outputRoutes={outputRoutes}
        missingRouteMarkers={missingRouteMarkers}
        newRoute={newRoute}
        setNewRoute={setNewRoute}
        isRunning={isRunning}
        onAddRoute={handleAddRoute}
        onRemoveRoute={removeOutputRoute}
      />

      <AgentConfigTemplateField onTemplateSelect={handleTemplateSelect} />
    </div>
  );

  return (
    <div className={`bg-white ${embedded ? '' : 'flex h-full flex-col'}`}>
      {!embedded && (
        <AgentConfigPanelChromeHeader
          title={t('workflow.agentConfig')}
          onClose={onClose}
        />
      )}

      {panelBody}

      <AgentConfigPanelSaveFooter embedded={embedded} onSave={handleSave} />
    </div>
  );
}

export default AgentConfigPanel;
