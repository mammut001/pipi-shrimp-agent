import { useSettingsStore } from '@/store';
import { getProvider } from '@/shared/providers';
import {
  resolveConfigApiFormat,
  resolveConfigBaseUrl,
} from '@/shared/providers/runtime';
import type { ApiConfig } from '@/types/settings';

export interface ResolvedAgentConfig {
  configId: string | null;
  name: string;
  provider: ApiConfig['provider'];
  model: string;
  baseUrl: string;
  apiFormat: ApiConfig['apiFormat'] | '';
  hasApiKey: boolean;
  hasBaseUrl: boolean;
  apiKey: string;
}

export interface AgentConfigValidationIssue {
  field: 'config' | 'provider' | 'model' | 'apiKey' | 'baseUrl';
  message: string;
}

function normalizeName(config: ApiConfig): string {
  return config.name?.trim() || config.provider;
}

export function resolveAgentConfig(config: ApiConfig): ResolvedAgentConfig {
  const baseUrl = resolveConfigBaseUrl(config.provider, config.baseUrl || '');
  const resolvedApiFormat = resolveConfigApiFormat(config.provider, config.apiFormat || '');
  const apiFormat = resolvedApiFormat || getProvider(config.provider)?.defaultApiFormat || '';
  const apiKey = config.apiKey || '';

  return {
    configId: config.id,
    name: normalizeName(config),
    provider: config.provider,
    model: config.model?.trim() || '',
    baseUrl,
    apiFormat,
    hasApiKey: apiKey.trim().length > 0,
    hasBaseUrl: baseUrl.trim().length > 0,
    apiKey,
  };
}

export function resolveActiveAgentConfig(): ResolvedAgentConfig | null {
  const activeConfig = useSettingsStore.getState().getActiveConfig();
  return activeConfig ? resolveAgentConfig(activeConfig) : null;
}

export function validateResolvedAgentConfig(
  config: ResolvedAgentConfig | null,
): AgentConfigValidationIssue[] {
  if (!config) {
    return [{ field: 'config', message: 'No active API configuration selected.' }];
  }

  const issues: AgentConfigValidationIssue[] = [];
  const provider = getProvider(config.provider);

  if (!provider) {
    issues.push({
      field: 'provider',
      message: `Selected config '${config.name}' uses unknown provider '${config.provider}'.`,
    });
  }

  if (!config.model) {
    issues.push({
      field: 'model',
      message: `Selected config '${config.name}' is missing a model.`,
    });
  }

  if (!config.hasApiKey) {
    issues.push({
      field: 'apiKey',
      message: `Selected config '${config.name}' is missing API key.`,
    });
  }

  if (provider?.requiresBaseUrl && !config.baseUrl.trim()) {
    issues.push({
      field: 'baseUrl',
      message: `Selected config '${config.name}' is missing base URL.`,
    });
  }

  return issues;
}

export function formatAgentConfigValidationError(
  config: ResolvedAgentConfig | null,
  issues: AgentConfigValidationIssue[],
): string {
  if (issues.length === 0) {
    return '';
  }

  const configLabel = config?.name ? `'${config.name}'` : 'the active config';
  const primary = issues[0];

  switch (primary.field) {
    case 'config':
      return 'Agent API config invalid: no active API configuration selected.';
    case 'provider':
      return `Agent API config invalid: selected config ${configLabel} uses unknown provider '${config?.provider ?? 'unknown'}'.`;
    case 'model':
      return `Agent API config invalid: selected config ${configLabel} is missing model.`;
    case 'apiKey':
      return `Agent API config invalid: selected config ${configLabel} is missing API key.`;
    case 'baseUrl':
      return `Agent API config invalid: selected config ${configLabel} is missing base URL.`;
    default:
      return `Agent API config invalid: ${primary.message}`;
  }
}

function getEndpointHost(baseUrl: string): string | null {
  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

export function getAgentAdapterName(config: ResolvedAgentConfig): string {
  if (config.provider === 'minimax') {
    return 'minimax-openai';
  }
  if (config.provider === 'openai-compatible') {
    return 'openai-compatible';
  }
  if (config.provider === 'anthropic-compatible') {
    return 'anthropic-compatible';
  }
  return config.apiFormat === 'anthropic' ? 'anthropic' : 'openai';
}

export function getAgentConfigDiagnostics(config: ResolvedAgentConfig) {
  return {
    selectedConfigName: config.name,
    selectedProvider: config.provider,
    selectedModel: config.model,
    apiFormat: config.apiFormat,
    hasApiKey: config.hasApiKey,
    hasBaseURL: config.hasBaseUrl,
    adapterName: getAgentAdapterName(config),
    endpointHost: getEndpointHost(config.baseUrl),
    authorizationHeaderPresent: config.apiFormat === 'openai' && config.hasApiKey,
  };
}

const MASKED_SECRET_PATTERN = /^[•*]+$/;

export function looksLikeMaskedSecret(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 4 && MASKED_SECRET_PATTERN.test(trimmed);
}

export function preserveApiKeyValue(inputValue: string, existingValue?: string): string {
  if (looksLikeMaskedSecret(inputValue) && existingValue) {
    return existingValue;
  }
  return inputValue;
}
