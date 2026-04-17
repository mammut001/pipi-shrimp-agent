/**
 * Settings-related type definitions
 * Includes ApiConfig and SettingsState interfaces
 */

// ============= Type Definitions =============

/** Model pricing configuration for cost estimation */
export interface ModelPricing {
  model: string;              // e.g. "claude-3-5-sonnet-20241022"
  inputPrice: number;         // $/1M tokens（输入）
  outputPrice: number;        // $/1M tokens（输出）
  cacheReadPrice?: number;    // $/1M tokens（缓存命中，Anthropic 特有）
  cacheWritePrice?: number;   // $/1M tokens（缓存写入，Anthropic 特有）
  maxTokens?: number;         // 模型单次输出上限
  contextWindow: number;       // 模型上下文窗口大小（tokens）
  provider: 'anthropic' | 'openai' | 'minimax' | 'deepseek' | 'other';
}

/** API configuration interface */
export interface ApiConfig {
  id: string;              // Unique identifier
  name: string;            // User-friendly name (e.g., "My Anthropic", "Minimax Pro")
  provider: 'anthropic' | 'openai' | 'minimax' | 'deepseek' | 'anthropic-compatible' | 'openai-compatible';
  apiKey: string;
  baseUrl?: string;        // Custom API endpoint
  model: string;           // Model name to use
  /**
   * Explicit provider scope for the model, used to disambiguate when the same
   * model ID exists across providers. Defaults to `provider` when absent.
   * New configs set this; old configs are back-filled on read.
   */
  modelProviderId?: ApiConfig['provider'];
  /**
   * Explicit API wire format override.
   * - "anthropic": use Anthropic /v1/messages format (x-api-key header)
   * - "openai":    use OpenAI /chat/completions format (Bearer header)
   * When absent, the format is auto-detected from provider / base URL / model name.
   * Mainly useful for Anthropic-compatible and OpenAI-compatible custom gateway providers.
   */
  apiFormat?: 'anthropic' | 'openai';
  /** Optional custom pricing for this config (overrides defaults) */
  pricing?: Partial<Omit<ModelPricing, 'model' | 'provider'>>;
}

/** Budget settings for cost control */
export interface BudgetSettings {
  monthlyLimit: number;        // 月度预算上限（美元，0 = 关闭）
  alertThresholds: number[];   // 告警阈值百分比 [50, 80, 100]
  alertedThresholds: number[]; // 已发送过告警的阈值（避免重复）
  enabled: boolean;             // 是否启用预算告警
}

/** Agent behavior settings */
export interface AgentSettings {
  maxToolRounds: number;  // Maximum tool loop rounds (default: 10)
}

/** Default agent settings */
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  maxToolRounds: 50,
};

/** Source of a model entry — for observability and debugging */
export type ModelSource = 'remote' | 'user' | 'default';

/** A model entry with source tracking */
export interface ModelEntry {
  id: string;
  source: ModelSource;
}

/** Settings store state interface */
export interface SettingsState {
  // ========== Data State ==========
  apiConfigs: ApiConfig[];           // All saved API configurations
  activeConfigId: string | null;     // Currently active config ID
  /** @deprecated Use apiConfigs + activeConfigId instead */
  apiConfig: ApiConfig | null;       // Computed: the active config (for backward compat)
  /** @deprecated Use availableModelEntries for source-aware access */
  availableModels: Record<string, string[]>; // Provider -> Model IDs (backward compat)
  /** Source-aware model store: provider -> ModelEntry[] */
  availableModelEntries: Record<string, ModelEntry[]>;
  telegramToken?: string;
  theme: 'light' | 'dark';
  language: 'en' | 'zh';
  importedFiles: ImportedFile[];
  budgetSettings: BudgetSettings;    // Budget alert settings
  agentSettings: AgentSettings;      // Agent behavior settings

  // ========== Action Methods ==========

  /**
   * Add a new API configuration
   */
  addApiConfig: (config: Omit<ApiConfig, 'id'>) => Promise<ApiConfig>;

  /**
   * Update an existing API configuration
   */
  updateApiConfig: (id: string, config: Partial<Omit<ApiConfig, 'id'>>) => Promise<void>;

  /**
   * Remove an API configuration
   */
  removeApiConfig: (id: string) => Promise<void>;

  /**
   * Set the active API configuration by ID
   */
  setActiveConfig: (id: string) => void;

  /**
   * Get the currently active API configuration
   */
  getActiveConfig: () => ApiConfig | null;

  /**
   * Set API configuration (legacy - saves/updates single config)
   * @deprecated Use addApiConfig or updateApiConfig instead
   */
  setApiConfig: (config: ApiConfig) => Promise<void>;

  /**
   * Get API configuration (legacy)
   * @deprecated Use getActiveConfig instead
   */
  getApiConfig: () => Promise<ApiConfig | null>;

  /**
   * Fetch available models from provider
   */
  fetchAvailableModels: (params?: { provider: ApiConfig['provider'], apiKey: string, baseUrl?: string }) => Promise<string[]>;

  /**
   * Set Telegram token
   */
  setTelegramToken: (token: string) => Promise<void>;

  /**
   * Toggle theme
   */
  setTheme: (theme: 'light' | 'dark') => void;

  /**
   * Toggle language
   */
  setLanguage: (language: 'en' | 'zh') => void;

  /**
   * Clear API key (for security)
   */
  clearApiKey: () => Promise<void>;

  /**
   * Add imported files
   */
  addImportedFiles: (files: { name: string; path: string }[]) => void;

  /**
   * Remove imported file by ID
   */
  removeImportedFile: (id: string) => void;

  /**
   * Clear all imported files
   */
  clearImportedFiles: () => void;

  /**
   * Update budget settings
   */
  updateBudgetSettings: (settings: Partial<BudgetSettings>) => void;

  /**
   * Update agent settings
   */
  updateAgentSettings: (settings: Partial<AgentSettings>) => void;

  /**
   * Get pricing for a specific model (custom or default)
   */
  getModelPricing: (model: string, provider: ApiConfig['provider']) => ModelPricing | null;
}

// ============= Constants =============

/** Default API configuration */
export const DEFAULT_API_CONFIG: ApiConfig = {
  id: 'default',
  name: 'Anthropic',
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-3-5-sonnet-20241022',
};

/** Supported API providers */
export const API_PROVIDERS = ['anthropic', 'openai', 'minimax', 'deepseek', 'anthropic-compatible', 'openai-compatible'] as const;

/**
 * Supported models per provider.
 * @deprecated Use PROVIDER_REGISTRY from '@/shared/providers' instead.
 * Now auto-derived from the registry for backward compatibility.
 */
import { buildProviderModelsMap, buildFlatPricingMap } from '@/shared/providers';

export const PROVIDER_MODELS: Record<ApiConfig['provider'], string[]> = buildProviderModelsMap() as Record<ApiConfig['provider'], string[]>;

/**
 * Default model pricing (per 1M tokens, in USD).
 * @deprecated Use resolvePricing() from '@/shared/providers' instead.
 * Now auto-derived from the registry for backward compatibility.
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = buildFlatPricingMap() as Record<string, ModelPricing>;

/** Default budget settings */
export const DEFAULT_BUDGET_SETTINGS: BudgetSettings = {
  monthlyLimit: 0,
  alertThresholds: [50, 80, 100],
  alertedThresholds: [],
  enabled: false,
};


/** Imported file interface */
export interface ImportedFile {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

/** Token usage record */
export interface TokenUsage {
  id: string;
  session_id: string | null;
  date: string;  // YYYY-MM-DD format
  input_tokens: number;
  output_tokens: number;
  model: string;
  api_config_id: string | null;
  created_at: number;
}

/** Daily token statistics */
export interface DailyTokenStats {
  date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/** Model token statistics */
export interface ModelTokenStats {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}
