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
  | 'gemini'
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
  /** Whether the provider supports free-text custom model IDs (compatible gateways) */
  supportsCustomModel?: boolean;
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
    { id: 'claude-fable-5', name: 'Claude Fable 5' },
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 (Sept 2025)' },
    { id: 'claude-sonnet-4-latest', name: 'Claude Sonnet 4 Latest' },
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet Latest' },
    { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku Latest' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (May 2025)' },
    { id: 'claude-sonnet-4-20250508', name: 'Claude Sonnet 4 (May 8 2025)' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Oct 2024)' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Oct 2024)' },
  ],
  defaultPricing: {
    'claude-fable-5': {
      inputPrice: 10, outputPrice: 50,
      cacheReadPrice: 1.0, cacheWritePrice: 12.5,
      contextWindow: 1000000,
    },
    'claude-opus-4-8': {
      inputPrice: 15, outputPrice: 75,
      cacheReadPrice: 1.5, cacheWritePrice: 18.75,
      contextWindow: 200000,
    },
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
    { id: 'gpt-5.5', name: 'GPT-5.5', supportsImage: true },
    { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', supportsImage: true },
    { id: 'gpt-5.4', name: 'GPT-5.4', supportsImage: true },
    { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', supportsImage: true },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', supportsImage: true },
    { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', supportsImage: true },
    { id: 'gpt-4.5', name: 'GPT-4.5', supportsImage: true },
    { id: 'gpt-4o', name: 'GPT-4o', supportsImage: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', supportsImage: true },
    { id: 'o3', name: 'o3' },
    { id: 'o4-mini', name: 'o4 Mini' },
  ],
  defaultPricing: {
    'gpt-5.5': {
      inputPrice: 10, outputPrice: 40,
      contextWindow: 1000000,
    },
    'gpt-5.5-pro': {
      inputPrice: 15, outputPrice: 60,
      contextWindow: 1000000,
    },
    'gpt-5.4': {
      inputPrice: 2, outputPrice: 8,
      contextWindow: 1000000,
    },
    'gpt-5.4-pro': {
      inputPrice: 4, outputPrice: 16,
      contextWindow: 1000000,
    },
    'gpt-5.4-mini': {
      inputPrice: 0.15, outputPrice: 0.6,
      contextWindow: 1000000,
    },
    'gpt-5.4-nano': {
      inputPrice: 0.05, outputPrice: 0.2,
      contextWindow: 1000000,
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
    { id: 'MiniMax-M3', name: 'MiniMax M3', supportsImage: true },
    { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
  ],
  defaultPricing: {
    'MiniMax-M3': { inputPrice: 0, outputPrice: 0, contextWindow: 1000000 },
    'MiniMax-M2.7': { inputPrice: 0, outputPrice: 0, contextWindow: 1000000 },
  },
};

const geminiProvider: ProviderDef = {
  id: 'gemini',
  label: 'Gemini',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  defaultApiFormat: 'openai',
  requiresApiKey: true,
  supportsModelFetch: false,
  showBaseUrl: true,
  requiresBaseUrl: false,
  baseUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta/openai',
  baseUrlHelp: 'Gemini uses the Google OpenAI-compatible endpoint for chat completions.',
  defaultModels: [
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', supportsImage: true },
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', supportsImage: true },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', supportsImage: true },
  ],
  defaultPricing: {
    'gemini-3.5-flash': { inputPrice: 0.075, outputPrice: 0.3, contextWindow: 1000000 },
    'gemini-3.1-pro': { inputPrice: 1.25, outputPrice: 5.0, contextWindow: 2000000 },
    'gemini-3.1-flash-lite': { inputPrice: 0.0375, outputPrice: 0.15, contextWindow: 1000000 },
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
  supportsCustomModel: true,
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
  supportsCustomModel: true,
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
  gemini: geminiProvider,
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

/** Get the first default model for a provider, suitable for new config defaults. */
export function getProviderDefaultModelId(providerName: string): string {
  return getProviderDefaultModelIds(providerName)[0] ?? '';
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
