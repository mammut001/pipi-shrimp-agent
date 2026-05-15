import {
  formatAgentConfigValidationError,
  resolveAgentConfig,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from '@/services/agentConfig';
import { useSettingsStore } from '@/store';
import {
  buildProviderExecutionCapabilities,
  getCapability,
  type ProviderCapability,
} from '@/services/llm/capabilities';
import {
  buildAutoResearchAgentConfigSnapshot,
  type AutoResearchConfigSource,
  type AutoResearchAgentConfigSnapshot,
} from './errors';

interface ResolvedConfigEntry {
  config: ResolvedAgentConfig;
  source: AutoResearchConfigSource;
}

export interface AutoResearchRunConfigSnapshotFile {
  createdAt: string;
  selectedConfigIds: {
    activeConfigId: string | null;
    defaultConfigId: string | null;
    agentConfigId: string | null;
    reflectionConfigId: string | null;
  };
  resolvedSources: {
    default: AutoResearchConfigSource;
    agent: AutoResearchConfigSource;
    reflection: AutoResearchConfigSource;
  };
  configs: {
    default: AutoResearchAgentConfigSnapshot;
    agent: AutoResearchAgentConfigSnapshot;
    reflection: AutoResearchAgentConfigSnapshot;
  };
  capabilities: {
    default: ProviderCapability;
    agent: ProviderCapability;
    reflection: ProviderCapability;
  };
}

export interface AutoResearchRunConfigResolution {
  defaultConfig: ResolvedAgentConfig;
  agentConfig: ResolvedAgentConfig;
  reflectionConfig: ResolvedAgentConfig;
  snapshot: AutoResearchAgentConfigSnapshot;
  featureSnapshots: {
    default: AutoResearchAgentConfigSnapshot;
    agent: AutoResearchAgentConfigSnapshot;
    reflection: AutoResearchAgentConfigSnapshot;
  };
  runConfigSnapshot: AutoResearchRunConfigSnapshotFile;
}

function getFirstValidConfigEntry(): ResolvedConfigEntry | null {
  const { apiConfigs } = useSettingsStore.getState();

  for (const config of apiConfigs) {
    const resolved = resolveAgentConfig(config);
    if (validateResolvedAgentConfig(resolved).length === 0) {
      return {
        config: resolved,
        source: 'settings.fallbackValidConfig',
      };
    }
  }

  return null;
}

function resolveConfigEntryFromId(
  configId: string | null | undefined,
  source: AutoResearchConfigSource,
): ResolvedConfigEntry | null {
  if (!configId) {
    return null;
  }

  const config = useSettingsStore.getState().apiConfigs.find((candidate) => candidate.id === configId);
  if (!config) {
    return null;
  }

  return {
    config: resolveAgentConfig(config),
    source,
  };
}

function assertValidConfig(entry: ResolvedConfigEntry | null, label: string): ResolvedConfigEntry {
  if (!entry) {
    throw new Error('Configure a provider first.');
  }

  const issues = validateResolvedAgentConfig(entry.config);
  if (issues.length > 0) {
    throw new Error(`${label}: ${formatAgentConfigValidationError(entry.config, issues)}`);
  }

  return entry;
}

function resolveDefaultConfigEntry(): ResolvedConfigEntry {
  const { autoResearchLlmSettings, activeConfigId } = useSettingsStore.getState();
  const explicitDefault = resolveConfigEntryFromId(
    autoResearchLlmSettings.defaultConfigId,
    'autoresearch.defaultConfig',
  );
  if (explicitDefault) {
    return assertValidConfig(explicitDefault, 'AutoResearch default config invalid');
  }

  const activeEntry = resolveConfigEntryFromId(activeConfigId, 'settings.activeConfig');
  if (activeEntry && validateResolvedAgentConfig(activeEntry.config).length === 0) {
    return activeEntry;
  }

  return assertValidConfig(
    getFirstValidConfigEntry(),
    'AutoResearch default config invalid',
  );
}

function buildFeatureSnapshot(entry: ResolvedConfigEntry): AutoResearchAgentConfigSnapshot {
  return buildAutoResearchAgentConfigSnapshot(entry.config, entry.source);
}

function buildUnsupportedToolCallMessage(config: ResolvedAgentConfig, saved = false): string {
  const prefix = saved ? 'Saved provider/model no longer supports' : 'Provider/model does not support';
  if (config.provider === 'deepseek') {
    return `${prefix} reliable structured tool calls for AutoResearch Advanced: DeepSeek model '${config.model}' is not a tool-calling agent model. Use deepseek-chat for the agent config, or choose another tool-calling provider.`;
  }

  return `${prefix} tool calls for AutoResearch Advanced. Choose a tool-calling model.`;
}

function assertAgentSupportsToolCalls(entry: ResolvedConfigEntry, saved = false): void {
  const executionCapabilities = buildProviderExecutionCapabilities({
    provider: entry.config.provider,
    apiFormat: entry.config.apiFormat,
    model: entry.config.model,
  });

  if (!executionCapabilities.supportsToolCalls) {
    throw new Error(buildUnsupportedToolCallMessage(entry.config, saved));
  }
}

function resolveSavedConfigEntry(configId: string | null | undefined, label: string): ResolvedConfigEntry | null {
  if (!configId) {
    return null;
  }

  const entry = resolveConfigEntryFromId(configId, 'savedRunConfig');
  if (!entry) {
    throw new Error(`${label}: saved config ${configId} is no longer available.`);
  }

  return assertValidConfig(entry, label);
}

export function resolveAutoResearchRunConfig(): AutoResearchRunConfigResolution {
  const { activeConfigId, autoResearchLlmSettings } = useSettingsStore.getState();
  const defaultEntry = resolveDefaultConfigEntry();
  const agentEntry = assertValidConfig(
    resolveConfigEntryFromId(autoResearchLlmSettings.agentConfigId, 'autoresearch.agentOverride') ?? defaultEntry,
    'AutoResearch agent config invalid',
  );
  const reflectionEntry = assertValidConfig(
    resolveConfigEntryFromId(autoResearchLlmSettings.reflectionConfigId, 'autoresearch.reflectionOverride') ?? defaultEntry,
    'AutoResearch reflection config invalid',
  );

  const agentCapability = getCapability(agentEntry.config.provider);
  assertAgentSupportsToolCalls(agentEntry);

  const featureSnapshots = {
    default: buildFeatureSnapshot(defaultEntry),
    agent: buildFeatureSnapshot(agentEntry),
    reflection: buildFeatureSnapshot(reflectionEntry),
  };

  return {
    defaultConfig: defaultEntry.config,
    agentConfig: agentEntry.config,
    reflectionConfig: reflectionEntry.config,
    snapshot: featureSnapshots.agent,
    featureSnapshots,
    runConfigSnapshot: {
      createdAt: new Date().toISOString(),
      selectedConfigIds: {
        activeConfigId,
        defaultConfigId: autoResearchLlmSettings.defaultConfigId,
        agentConfigId: autoResearchLlmSettings.agentConfigId,
        reflectionConfigId: autoResearchLlmSettings.reflectionConfigId,
      },
      resolvedSources: {
        default: defaultEntry.source,
        agent: agentEntry.source,
        reflection: reflectionEntry.source,
      },
      configs: featureSnapshots,
      capabilities: {
        default: getCapability(defaultEntry.config.provider),
        agent: agentCapability,
        reflection: getCapability(reflectionEntry.config.provider),
      },
    },
  };
}

export function resolveAutoResearchRunConfigFromSnapshotFile(
  snapshotFile: AutoResearchRunConfigSnapshotFile,
): AutoResearchRunConfigResolution {
  const defaultEntry = resolveSavedConfigEntry(
    snapshotFile.selectedConfigIds.defaultConfigId,
    'Saved AutoResearch default config invalid',
  ) ?? resolveSavedConfigEntry(
    snapshotFile.selectedConfigIds.activeConfigId,
    'Saved AutoResearch active config invalid',
  ) ?? assertValidConfig(
    getFirstValidConfigEntry(),
    'Saved AutoResearch default config invalid',
  );

  const agentEntry = resolveSavedConfigEntry(
    snapshotFile.selectedConfigIds.agentConfigId,
    'Saved AutoResearch agent config invalid',
  ) ?? defaultEntry;
  const reflectionEntry = resolveSavedConfigEntry(
    snapshotFile.selectedConfigIds.reflectionConfigId,
    'Saved AutoResearch reflection config invalid',
  ) ?? defaultEntry;

  const agentCapability = getCapability(agentEntry.config.provider);
  assertAgentSupportsToolCalls(agentEntry, true);

  const featureSnapshots = {
    default: buildFeatureSnapshot(defaultEntry),
    agent: buildFeatureSnapshot(agentEntry),
    reflection: buildFeatureSnapshot(reflectionEntry),
  };

  return {
    defaultConfig: defaultEntry.config,
    agentConfig: agentEntry.config,
    reflectionConfig: reflectionEntry.config,
    snapshot: featureSnapshots.agent,
    featureSnapshots,
    runConfigSnapshot: snapshotFile,
  };
}
