/**
 * Pure helpers for turning a workflow role's model hint into an actual
 * provider/model selection, given the user's configured API configs.
 *
 * Shared by the per-agent "apply recommendation" button in the config
 * panel and by the preset workflow builders, which auto-assign a
 * cost-appropriate model to each generated node.
 */
import { getProviderDefaultModelIds, type ProviderName } from '@/shared/providers';
import type { RoleModelHint } from '@/types/workflow';

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
