import type { ApiConfig, AutoResearchLlmSettings } from '@/types/settings';
import { DEFAULT_AUTORESEARCH_LLM_SETTINGS } from '@/types/settings';
import {
  getProviderDefaultApiFormat,
  getProviderDefaultBaseUrl,
  getProviderDefaultModelId,
} from '@/shared/providers';

export const MINIMAX_DEFAULT_CONFIG_ID = 'minimax-default';

export const STALE_ALIYUN_CONFIG_IDS = ['aliyun-anthropic', 'aliyun-openai'] as const;

/** Dead Aliyun MaaS host that used to be injected as the AutoResearch default. */
export const STALE_ALIYUN_ENDPOINT_MARKER = 'token-plan.cn-beijing.maas.aliyuncs.com';

export function hasConfiguredApiKey(config: Pick<ApiConfig, 'apiKey'>): boolean {
  return typeof config.apiKey === 'string' && config.apiKey.trim().length > 0;
}

export function isStaleAliyunConfig(config: Pick<ApiConfig, 'id' | 'baseUrl'>): boolean {
  const idIsLegacy = (STALE_ALIYUN_CONFIG_IDS as readonly string[]).includes(config.id);
  const endpoint = (config.baseUrl || '').toLowerCase();
  return idIsLegacy && endpoint.includes(STALE_ALIYUN_ENDPOINT_MARKER);
}

export function buildMiniMaxTemplateConfig(): ApiConfig {
  const apiFormat = getProviderDefaultApiFormat('minimax');
  return {
    id: MINIMAX_DEFAULT_CONFIG_ID,
    name: 'MiniMax',
    provider: 'minimax',
    modelProviderId: 'minimax',
    apiFormat: apiFormat === 'anthropic' || apiFormat === 'openai' ? apiFormat : 'openai',
    baseUrl: getProviderDefaultBaseUrl('minimax') || 'https://api.minimaxi.com/v1',
    apiKey: '',
    model: getProviderDefaultModelId('minimax') || 'MiniMax-M3',
  };
}

function hasMiniMaxConfig(configs: ApiConfig[]): boolean {
  return configs.some((config) => config.provider === 'minimax' || config.modelProviderId === 'minimax');
}

/**
 * Hydrate stored API configs for boot.
 *
 * Does not inject secrets and does not overwrite user-edited rows.
 * Ensures a MiniMax template exists so AutoResearch can align to it
 * instead of the retired Aliyun MaaS defaults.
 */
export function mergeBootstrappedApiConfigs(stored: ApiConfig[]): ApiConfig[] {
  const configs = stored.map((config) => ({
    ...config,
    modelProviderId: config.modelProviderId ?? config.provider,
  }));

  if (configs.length === 0) {
    return [buildMiniMaxTemplateConfig()];
  }

  if (!hasMiniMaxConfig(configs)) {
    return [buildMiniMaxTemplateConfig(), ...configs];
  }

  return configs;
}

export function resolvePreferredActiveConfigId(
  configs: ApiConfig[],
  candidateId?: string | null,
): string | null {
  const keyedNonStale = configs.filter((config) => hasConfiguredApiKey(config) && !isStaleAliyunConfig(config));
  const keyedAny = configs.filter((config) => hasConfiguredApiKey(config));

  if (candidateId) {
    const candidate = configs.find((config) => config.id === candidateId);
    if (candidate && hasConfiguredApiKey(candidate) && !isStaleAliyunConfig(candidate)) {
      return candidate.id;
    }
  }

  const preferredMiniMax = keyedNonStale.find((config) => config.provider === 'minimax' || config.modelProviderId === 'minimax');
  if (preferredMiniMax) {
    return preferredMiniMax.id;
  }

  return keyedNonStale[0]?.id ?? keyedAny[0]?.id ?? null;
}

function sanitizeAgainstConfigs(
  settings: Partial<AutoResearchLlmSettings> | null | undefined,
  configs: ApiConfig[],
): AutoResearchLlmSettings {
  const validIds = new Set(configs.map((config) => config.id));
  const normalizeId = (value: string | null | undefined): string | null => (
    value && validIds.has(value) ? value : null
  );

  return {
    defaultConfigId: normalizeId(settings?.defaultConfigId),
    agentConfigId: normalizeId(settings?.agentConfigId),
    reflectionConfigId: normalizeId(settings?.reflectionConfigId),
  };
}

export function settingsPointAtStaleAliyun(
  settings: AutoResearchLlmSettings,
  configs: ApiConfig[],
): boolean {
  const ids = [settings.defaultConfigId, settings.agentConfigId, settings.reflectionConfigId];
  return ids.some((id) => {
    if (!id) {
      return false;
    }
    const config = configs.find((candidate) => candidate.id === id);
    return Boolean(config && isStaleAliyunConfig(config));
  });
}

export function resolveAutoResearchLlmSettingsOnBoot(input: {
  configs: ApiConfig[];
  stored: Partial<AutoResearchLlmSettings> | null | undefined;
  activeConfigId: string | null;
}): AutoResearchLlmSettings {
  const sanitized = sanitizeAgainstConfigs(input.stored, input.configs);
  const stale = settingsPointAtStaleAliyun(sanitized, input.configs);
  const hasExplicitValid = Boolean(
    sanitized.defaultConfigId || sanitized.agentConfigId || sanitized.reflectionConfigId,
  );

  if (hasExplicitValid && !stale) {
    return sanitized;
  }

  const preferredId = resolvePreferredActiveConfigId(input.configs, input.activeConfigId);
  if (!preferredId) {
    return DEFAULT_AUTORESEARCH_LLM_SETTINGS;
  }

  return {
    defaultConfigId: preferredId,
    agentConfigId: preferredId,
    reflectionConfigId: preferredId,
  };
}
