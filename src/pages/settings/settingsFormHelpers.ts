import type { ApiConfig, ModelPricing, ModelEntry } from '@/types/settings';
import { DEFAULT_MODEL_PRICING } from '@/types/settings';
import { resolveDraftApiKeyValue } from '@/services/agentConfig';
import { formatError } from '@/utils/errorFormat';
import {
  getProvider,
  getProviderDefaultModelId,
  getProviderDefaultModelIds,
  getProviderDefaultBaseUrl,
  getProviderDefaultApiFormat,
  validateProviderFields,
} from '@/shared/providers';
import type { ProviderName } from '@/shared/providers';
import { t } from '@/i18n';
import {
  buildConnectionFailureDetails,
  classifyConnectionError,
  getConnectionErrorMessage,
} from '@/services/settings/settingsConnection';

export type SettingsFormData = {
  name: string;
  provider: ApiConfig['provider'];
  apiKey: string;
  baseUrl: string;
  model: string;
  apiFormat: '' | 'anthropic' | 'openai';
  pricing: Partial<Omit<ModelPricing, 'model' | 'provider'>>;
};

export function createEmptySettingsFormData(): SettingsFormData {
  return {
    name: '',
    provider: 'anthropic',
    apiKey: '',
    baseUrl: '',
    model: getProviderDefaultModelId('anthropic'),
    apiFormat: '',
    pricing: {},
  };
}

export function settingsFormDataFromConfig(config: ApiConfig): SettingsFormData {
  return {
    name: config.name,
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || '',
    model: config.model,
    apiFormat: (config.apiFormat || '') as '' | 'anthropic' | 'openai',
    pricing: config.pricing || {},
  };
}

export function buildProviderModelEntries(
  provider: ApiConfig['provider'],
  availableModelEntries: Record<string, ModelEntry[]>,
  model: string,
): ModelEntry[] {
  const providerName = provider as ProviderName;
  const remoteEntries = availableModelEntries[providerName] ?? [];
  const remoteIds = new Set(remoteEntries.map((e) => e.id));
  const defaultIds = getProviderDefaultModelIds(providerName).filter((id) => !remoteIds.has(id));
  const currentProviderModelEntries: ModelEntry[] = [
    ...remoteEntries,
    ...defaultIds.map((id) => ({ id, source: 'default' as const })),
  ];
  const currentModel = model?.trim();
  const existingIds = new Set(currentProviderModelEntries.map((e) => e.id));
  if (currentModel && !existingIds.has(model) && !existingIds.has(currentModel)) {
    currentProviderModelEntries.push({ id: model, source: 'user' });
  }
  return currentProviderModelEntries;
}

export function buildDraftApiConfig(
  formData: SettingsFormData,
  editingConfigId: string | null,
  existingConfig: ApiConfig | null,
): ApiConfig {
  return {
    id: editingConfigId || 'draft-config',
    name: formData.name.trim() || existingConfig?.name || formData.provider,
    provider: formData.provider,
    apiKey: resolveDraftApiKeyValue(formData.apiKey, formData.provider, existingConfig),
    baseUrl: formData.baseUrl || undefined,
    model: formData.model,
    modelProviderId: formData.provider,
    apiFormat: (formData.apiFormat || undefined) as ApiConfig['apiFormat'],
    pricing: Object.keys(formData.pricing).length > 0 ? formData.pricing : undefined,
  };
}

export function buildProviderChangeUpdates(
  newProvider: ProviderName,
  formData: SettingsFormData,
  availableModelEntries: Record<string, ModelEntry[]>,
): Partial<SettingsFormData> {
  const providerDef = getProvider(newProvider);
  const dynamicModels = (availableModelEntries[newProvider] ?? []).map((e) => e.id);
  const staticModels = getProviderDefaultModelIds(newProvider);
  const allModels = [...new Set([...staticModels, ...dynamicModels])];

  const updates: Partial<SettingsFormData> = {
    apiKey: '',
    name: formData.name || (providerDef?.label ?? newProvider),
  };

  if (allModels.length > 0) {
    updates.model = allModels[0];
  } else {
    updates.model = formData.model;
  }

  // Auto-fill Base URL from registry
  updates.baseUrl = getProviderDefaultBaseUrl(newProvider);

  // Auto-set apiFormat from registry
  updates.apiFormat = getProviderDefaultApiFormat(newProvider);

  return updates;
}

export function getSettingsPricingDisplay(formData: SettingsFormData): {
  inputPrice: number;
  outputPrice: number;
  isCustom: boolean;
} {
  const defaultPricing = DEFAULT_MODEL_PRICING[formData.model];
  const hasCustomPricing = Object.keys(formData.pricing).length > 0;

  if (hasCustomPricing) {
    return {
      inputPrice: formData.pricing.inputPrice ?? defaultPricing?.inputPrice ?? 0,
      outputPrice: formData.pricing.outputPrice ?? defaultPricing?.outputPrice ?? 0,
      isCustom: true,
    };
  }

  return {
    inputPrice: defaultPricing?.inputPrice ?? 0,
    outputPrice: defaultPricing?.outputPrice ?? 0,
    isCustom: false,
  };
}

export function collectApiFormErrors(
  formData: SettingsFormData,
  draftConfig: ApiConfig,
): Record<string, string> {
  const newErrors: Record<string, string> = {};

  if (!formData.name.trim()) {
    newErrors.name = t('settings.nameRequired');
  }

  if (!formData.model.trim()) {
    newErrors.model = t('settings.modelRequired');
  }

  // Capability-driven provider field validation
  const providerErrors = validateProviderFields(
    draftConfig.provider,
    draftConfig.apiKey,
    draftConfig.baseUrl || '',
  );
  Object.assign(newErrors, providerErrors);

  return newErrors;
}

export function buildSaveConfigPayload(draftConfig: ApiConfig): Omit<ApiConfig, 'id'> {
  return {
    name: draftConfig.name,
    provider: draftConfig.provider,
    apiKey: draftConfig.apiKey,
    baseUrl: draftConfig.baseUrl,
    model: draftConfig.model,
    modelProviderId: draftConfig.modelProviderId,
    apiFormat: draftConfig.apiFormat,
    pricing: draftConfig.pricing,
  };
}

export function buildConnectionTestSuccessMessage(
  provider: string,
  model: string,
  latency: number,
): string {
  return t('settings.testConnectionSuccess')
    .replace('{provider}', provider)
    .replace('{model}', model)
    .replace('{latency}', String(latency));
}

export function buildConnectionTestFailure(error: unknown): {
  friendlyMsg: string;
  details: string;
} {
  const details = (error instanceof Error && 'diagnostics' in error)
    ? buildConnectionFailureDetails(
      (error as Error & { diagnostics: Parameters<typeof buildConnectionFailureDetails>[0] }).diagnostics,
      error,
    )
    : formatError(error);
  const rawMsg = error instanceof Error ? error.message : formatError(error);
  const friendlyMsg = getConnectionErrorMessage(classifyConnectionError(rawMsg), t);

  return { friendlyMsg, details };
}
