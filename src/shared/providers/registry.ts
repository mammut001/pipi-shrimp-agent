/**
 * Provider Registry — Single Source of Truth for all provider/model definitions.
 *
 * Every provider's behavior, default models, API format, and base URLs
 * are defined here. Settings UI, fetch logic, and pricing all consume
 * this registry instead of maintaining separate constants.
 */

// ============== Core Types ==============

export type ApiFormat = 'anthropic' | 'openai';

export type ProviderName =
  | 'anthropic'
  | 'openai'
  | 'minimax'
  | 'deepseek'
  | 'anthropic-compatible'
  | 'openai-compatible';

export type ModelsEndpointStyle = 'openai' | 'anthropic';

export interface ProviderModelDef {
  id: string;
  name?: string;
  supportsImage?: boolean;
  /** True if this model is being deprecated / sunset */
  deprecating?: boolean;
}

export interface ProviderPricingDef {
  inputPrice: number;         // $/1M tokens
  outputPrice: number;        // $/1M tokens
  cacheReadPrice?: number;
  cacheWritePrice?: number;
  maxTokens?: number;
  contextWindow: number;
}

export interface ProviderDef {
  id: ProviderName;
  label: string;
  defaultBaseUrl: string;
  defaultApiFormat: ApiFormat;
  /** Whether the provider requires an API key */
  requiresApiKey: boolean;
  /** Whether the provider supports fetching models from an endpoint */
  supportsModelFetch: boolean;
  /** Which endpoint style to use for fetching models */
  modelsEndpointStyle?: ModelsEndpointStyle;
  /** Whether the Base URL field should be shown in the UI */
  showBaseUrl: boolean;
  /** Whether Base URL is required (validation) */
  requiresBaseUrl: boolean;
  /** Placeholder text for the Base URL field */
  baseUrlPlaceholder?: string;
  /** Help text shown below the Base URL field */
  baseUrlHelp?: string;
  /** Default models shipped with this provider (fallback when fetch unavailable) */
  defaultModels: ProviderModelDef[];
  /** Default pricing per model ID */
  defaultPricing: Record<string, ProviderPricingDef>;
}

// ============== Provider Definitions ==============

const anthropicProvider: ProviderDef = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  defaultApiFormat: 'anthropic',
  requiresApiKey: true,
  supportsModelFetch: true,
  modelsEndpointStyle: 'anthropic',
  showBaseUrl: false,
  requiresBaseUrl: false,
  defaultModels: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 (Sept 2025)' },
    { id: 'claude-sonnet-4-latest', name: 'Claude Sonnet 4 Latest' },
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet Latest' },
    { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku Latest' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (May 2025)' },
    { id: 'claude-sonnet-4-20250508', name: 'Claude Sonnet 4 (May 8 2025)' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Oct 2024)' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Oct 2024)' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', deprecating: true },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', deprecating: true },
  ],
  defaultPricing: {
    'claude-sonnet-4-5': {
      inputPrice: 3, outputPrice: 15,
      cacheReadPrice: 0.3, cacheWritePrice: 3.75,
      contextWindow: 200000,
    },
    'claude-sonnet-4-5-20250929': {
      inputPrice: 3, outputPrice: 15,
      cacheReadPrice: 0.3, cacheWritePrice: 3.75,
      contextWindow: 200000,
    },
    'claude-sonnet-4-latest': {
      inputPrice: 3, outputPrice: 15,
      cacheReadPrice: 0.3, cacheWritePrice: 3.75,
      contextWindow: 200000,
    },
    'claude-3-5-sonnet-latest': {
      inputPrice: 3, outputPrice: 15,
      cacheReadPrice: 0.3, cacheWritePrice: 3.75,
      contextWindow: 200000,
    },
    'claude-3-5-haiku-latest': {
      inputPrice: 0.25, outputPrice: 1.25,
      cacheReadPrice: 0.03, cacheWritePrice: 0.03,
      contextWindow: 200000,
    },
    'claude-sonnet-4-20250514': {
      inputPrice: 3, outputPrice: 15,
      cacheReadPrice: 0.3, cacheWritePrice: 3.75,
      contextWindow: 200000,
    },
    'claude-sonnet-4-20250508': {
      inputPrice: 3, outputPrice: 15,
      cacheReadPrice: 0.3, cacheWritePrice: 3.75,
      contextWindow: 200000,
    },
    'claude-3-5-sonnet-20241022': {
      inputPrice: 3, outputPrice: 15,
      cacheReadPrice: 0.3, cacheWritePrice: 3.75,
      contextWindow: 200000,
    },
    'claude-3-5-haiku-20241022': {
      inputPrice: 0.25, outputPrice: 1.25,
      cacheReadPrice: 0.03, cacheWritePrice: 0.03,
      contextWindow: 200000,
    },
    'claude-3-opus-20240229': {
      inputPrice: 15, outputPrice: 75,
      cacheReadPrice: 1.5, cacheWritePrice: 18.75,
      contextWindow: 200000,
    },
    'claude-3-haiku-20240307': {
      inputPrice: 0.25, outputPrice: 1.25,
      contextWindow: 200000,
    },
  },
};

const openaiProvider: ProviderDef = {
  id: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  defaultApiFormat: 'openai',
  requiresApiKey: true,
  supportsModelFetch: true,
  modelsEndpointStyle: 'openai',
  showBaseUrl: false,
  requiresBaseUrl: false,
  defaultModels: [
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
    { id: 'gpt-4.5', name: 'GPT-4.5', supportsImage: true },
    { id: 'gpt-4o', name: 'GPT-4o', supportsImage: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', supportsImage: true },
    { id: 'o3', name: 'o3' },
    { id: 'o4-mini', name: 'o4 Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', deprecating: true },
    { id: 'gpt-4', name: 'GPT-4', deprecating: true },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', deprecating: true },
  ],
  defaultPricing: {
    'gpt-4.1': {
      inputPrice: 2, outputPrice: 8,
      contextWindow: 1047576,
    },
    'gpt-4.1-mini': {
      inputPrice: 0.4, outputPrice: 1.6,
      contextWindow: 1047576,
    },
    'gpt-4.1-nano': {
      inputPrice: 0.1, outputPrice: 0.4,
      contextWindow: 1047576,
    },
    'gpt-4.5': {
      inputPrice: 75, outputPrice: 150,
      contextWindow: 128000,
    },
    'gpt-4o': {
      inputPrice: 2.5, outputPrice: 10,
      contextWindow: 128000,
    },
    'gpt-4o-mini': {
      inputPrice: 0.15, outputPrice: 0.6,
      contextWindow: 128000,
    },
    'o3': {
      inputPrice: 2, outputPrice: 8,
      contextWindow: 200000,
    },
    'o4-mini': {
      inputPrice: 1.10, outputPrice: 4.40,
      contextWindow: 200000,
    },
    'gpt-4-turbo': {
      inputPrice: 10, outputPrice: 30,
      contextWindow: 128000,
    },
    'gpt-4': {
      inputPrice: 30, outputPrice: 60,
      contextWindow: 128000,
    },
    'gpt-3.5-turbo': {
      inputPrice: 0.5, outputPrice: 1.5,
      contextWindow: 16385,
    },
  },
};

const minimaxProvider: ProviderDef = {
  id: 'minimax',
  label: 'MiniMax',
  defaultBaseUrl: 'https://api.minimaxi.com/v1',
  defaultApiFormat: 'openai',
  requiresApiKey: true,
  supportsModelFetch: true,
  modelsEndpointStyle: 'openai',
  showBaseUrl: true,
  requiresBaseUrl: true,
  baseUrlPlaceholder: 'https://api.minimaxi.com/v1',
  baseUrlHelp: 'MiniMax uses OpenAI-compatible /chat/completions format.',
  defaultModels: [
    { id: 'MiniMax-M2.5', name: 'MiniMax M2.5' },
    { id: 'MiniMax-M2.1', name: 'MiniMax M2.1' },
    { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed' },
    { id: 'MiniMax-M2.1-highspeed', name: 'MiniMax M2.1 Highspeed' },
    { id: 'MiniMax-M2', name: 'MiniMax M2' },
  ],
  defaultPricing: {
    'MiniMax-M2.5': { inputPrice: 0, outputPrice: 0, contextWindow: 1000000 },
    'MiniMax-M2.1': { inputPrice: 0, outputPrice: 0, contextWindow: 1000000 },
    'MiniMax-M2.5-highspeed': { inputPrice: 0, outputPrice: 0, contextWindow: 1000000 },
    'MiniMax-M2.1-highspeed': { inputPrice: 0, outputPrice: 0, contextWindow: 1000000 },
    'MiniMax-M2': { inputPrice: 0, outputPrice: 0, contextWindow: 1000000 },
  },
};

const deepseekProvider: ProviderDef = {
  id: 'deepseek',
  label: 'DeepSeek',
  defaultBaseUrl: 'https://api.deepseek.com',
  defaultApiFormat: 'openai',
  requiresApiKey: true,
  supportsModelFetch: true,
  modelsEndpointStyle: 'openai',
  showBaseUrl: true,
  requiresBaseUrl: true,
  baseUrlPlaceholder: 'https://api.deepseek.com',
  baseUrlHelp: 'DeepSeek API address (backend auto-appends /v1).',
  defaultModels: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
  ],
  defaultPricing: {
    'deepseek-chat': { inputPrice: 0.27, outputPrice: 1.1, contextWindow: 128000 },
    'deepseek-reasoner': { inputPrice: 0.55, outputPrice: 2.19, contextWindow: 128000 },
  },
};

const anthropicCompatibleProvider: ProviderDef = {
  id: 'anthropic-compatible',
  label: 'Anthropic Compatible',
  defaultBaseUrl: '',
  defaultApiFormat: 'anthropic',
  requiresApiKey: true,
  supportsModelFetch: true,
  modelsEndpointStyle: 'anthropic',
  showBaseUrl: true,
  requiresBaseUrl: true,
  baseUrlPlaceholder: 'https://your-proxy.example.com',
  baseUrlHelp: 'Uses Anthropic /v1/messages format — suitable for Claude proxy gateways.',
  defaultModels: [],
  defaultPricing: {},
};

const openaiCompatibleProvider: ProviderDef = {
  id: 'openai-compatible',
  label: 'OpenAI Compatible',
  defaultBaseUrl: '',
  defaultApiFormat: 'openai',
  requiresApiKey: true,
  supportsModelFetch: true,
  modelsEndpointStyle: 'openai',
  showBaseUrl: true,
  requiresBaseUrl: true,
  baseUrlPlaceholder: 'https://api.example.com/v1',
  baseUrlHelp: 'Uses OpenAI /chat/completions format — works with most compatible APIs.',
  defaultModels: [],
  defaultPricing: {},
};

// ============== Registry ==============

/** All registered providers, keyed by ProviderName */
export const PROVIDER_REGISTRY: Record<ProviderName, ProviderDef> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  minimax: minimaxProvider,
  deepseek: deepseekProvider,
  'anthropic-compatible': anthropicCompatibleProvider,
  'openai-compatible': openaiCompatibleProvider,
};

// ============== Helper Functions ==============

/** Get ordered list of all provider names */
export function getProviderNames(): ProviderName[] {
  return Object.keys(PROVIDER_REGISTRY) as ProviderName[];
}

/** Get provider definition or null */
export function getProvider(name: string): ProviderDef | null {
  return PROVIDER_REGISTRY[name as ProviderName] ?? null;
}

/** Get default models for a provider (as string IDs) */
export function getProviderDefaultModelIds(providerName: string): string[] {
  const provider = getProvider(providerName);
  if (!provider) return [];
  return provider.defaultModels.map(m => m.id);
}

/** Get default base URL for a provider */
export function getProviderDefaultBaseUrl(providerName: string): string {
  return getProvider(providerName)?.defaultBaseUrl ?? '';
}

/** Get the API format for a provider (used to set apiFormat on new configs) */
export function getProviderDefaultApiFormat(providerName: string): ApiFormat | '' {
  const provider = getProvider(providerName);
  if (!provider) return '';
  // First-party providers (anthropic, openai, minimax, deepseek) use auto-detection
  if (providerName === 'anthropic-compatible') return 'anthropic';
  if (providerName === 'openai-compatible') return 'openai';
  return '';
}

/**
 * Resolve pricing for a model across all providers.
 * Returns the first matching pricing definition.
 */
export function resolvePricing(
  modelId: string,
  providerName?: string,
): ProviderPricingDef | null {
  // If provider is specified, check that first
  if (providerName) {
    const provider = getProvider(providerName);
    if (provider?.defaultPricing[modelId]) {
      return provider.defaultPricing[modelId];
    }
  }
  // Fall back to scanning all providers
  for (const provider of Object.values(PROVIDER_REGISTRY)) {
    if (provider.defaultPricing[modelId]) {
      return provider.defaultPricing[modelId];
    }
  }
  return null;
}

/**
 * Build a stable identity key for a (provider, model) pair.
 * This ensures same-named models across different providers can be distinguished.
 *
 * Format: "<providerId>:<modelId>"
 *
 * Example: getModelIdentityKey("anthropic", "claude-3-5-sonnet-20241022")
 *          → "anthropic:claude-3-5-sonnet-20241022"
 */
export function getModelIdentityKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/**
 * Build a flat DEFAULT_MODEL_PRICING-compatible map from the registry.
 * Used for backward compatibility during migration.
 */
export function buildFlatPricingMap(): Record<string, {
  model: string;
  provider: string;
  inputPrice: number;
  outputPrice: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
  maxTokens?: number;
  contextWindow: number;
}> {
  const result: Record<string, any> = {};
  for (const provider of Object.values(PROVIDER_REGISTRY)) {
    for (const [modelId, pricing] of Object.entries(provider.defaultPricing)) {
      result[modelId] = {
        model: modelId,
        provider: provider.id,
        ...pricing,
      };
    }
  }
  return result;
}

/**
 * Build a flat PROVIDER_MODELS-compatible map from the registry.
 * Used for backward compatibility during migration.
 */
export function buildProviderModelsMap(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const provider of Object.values(PROVIDER_REGISTRY)) {
    result[provider.id] = provider.defaultModels.map(m => m.id);
  }
  return result;
}
