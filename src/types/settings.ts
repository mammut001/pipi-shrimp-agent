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
  provider: 'anthropic' | 'openai' | 'minimax' | 'other';
}

/** API configuration interface */
export interface ApiConfig {
  id: string;              // Unique identifier
  name: string;            // User-friendly name (e.g., "My Anthropic", "Minimax Pro")
  provider: 'anthropic' | 'openai' | 'minimax' | 'custom';
  apiKey: string;
  baseUrl?: string;        // Custom API endpoint
  model: string;           // Model name to use
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

/** Settings store state interface */
export interface SettingsState {
  // ========== Data State ==========
  apiConfigs: ApiConfig[];           // All saved API configurations
  activeConfigId: string | null;     // Currently active config ID
  /** @deprecated Use apiConfigs + activeConfigId instead */
  apiConfig: ApiConfig | null;       // Computed: the active config (for backward compat)
  availableModels: Record<string, string[]>; // Provider -> Model IDs
  telegramToken?: string;
  theme: 'light' | 'dark';
  language: 'en' | 'zh';
  importedFiles: ImportedFile[];
  budgetSettings: BudgetSettings;    // Budget alert settings

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
export const API_PROVIDERS = ['anthropic', 'openai', 'minimax', 'custom'] as const;

/** Supported models per provider */
export const PROVIDER_MODELS: Record<ApiConfig['provider'], string[]> = {
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-20250508',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-haiku-20240307',
  ],
  openai: [
    'gpt-4.5',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
  ],
  minimax: [
    'MiniMax-M2.5',
    'MiniMax-M2.1',
    'MiniMax-M2.5-highspeed',
    'MiniMax-M2.1-highspeed',
    'MiniMax-M2',
  ],
  custom: [],
};

/** Default model pricing (per 1M tokens, in USD) */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic models
  'claude-sonnet-4-20250514': {
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    inputPrice: 3,
    outputPrice: 15,
    cacheReadPrice: 0.3,
    cacheWritePrice: 3.75,
    contextWindow: 200000,
  },
  'claude-sonnet-4-20250508': {
    model: 'claude-sonnet-4-20250508',
    provider: 'anthropic',
    inputPrice: 3,
    outputPrice: 15,
    cacheReadPrice: 0.3,
    cacheWritePrice: 3.75,
    contextWindow: 200000,
  },
  'claude-3-5-sonnet-20241022': {
    model: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    inputPrice: 3,
    outputPrice: 15,
    cacheReadPrice: 0.3,
    cacheWritePrice: 3.75,
    contextWindow: 200000,
  },
  'claude-3-5-haiku-20241022': {
    model: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    inputPrice: 0.25,
    outputPrice: 1.25,
    cacheReadPrice: 0.03,
    cacheWritePrice: 0.03,
    contextWindow: 200000,
  },
  'claude-3-opus-20240229': {
    model: 'claude-3-opus-20240229',
    provider: 'anthropic',
    inputPrice: 15,
    outputPrice: 75,
    cacheReadPrice: 1.5,
    cacheWritePrice: 18.75,
    contextWindow: 200000,
  },
  'claude-3-haiku-20240307': {
    model: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    inputPrice: 0.25,
    outputPrice: 1.25,
    contextWindow: 200000,
  },

  // OpenAI models
  'gpt-4.5': {
    model: 'gpt-4.5',
    provider: 'openai',
    inputPrice: 75,
    outputPrice: 150,
    contextWindow: 128000,
  },
  'gpt-4o': {
    model: 'gpt-4o',
    provider: 'openai',
    inputPrice: 2.5,
    outputPrice: 10,
    contextWindow: 128000,
  },
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    provider: 'openai',
    inputPrice: 0.15,
    outputPrice: 0.6,
    contextWindow: 128000,
  },
  'gpt-4-turbo': {
    model: 'gpt-4-turbo',
    provider: 'openai',
    inputPrice: 10,
    outputPrice: 30,
    contextWindow: 128000,
  },
  'gpt-4': {
    model: 'gpt-4',
    provider: 'openai',
    inputPrice: 30,
    outputPrice: 60,
    contextWindow: 128000,
  },
  'gpt-3.5-turbo': {
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    inputPrice: 0.5,
    outputPrice: 1.5,
    contextWindow: 16385,
  },

  // MiniMax models (default pricing, user should configure)
  'MiniMax-M2.5': {
    model: 'MiniMax-M2.5',
    provider: 'minimax',
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 1000000,
  },
  'MiniMax-M2.1': {
    model: 'MiniMax-M2.1',
    provider: 'minimax',
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 1000000,
  },
  'MiniMax-M2.5-highspeed': {
    model: 'MiniMax-M2.5-highspeed',
    provider: 'minimax',
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 1000000,
  },
  'MiniMax-M2.1-highspeed': {
    model: 'MiniMax-M2.1-highspeed',
    provider: 'minimax',
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 1000000,
  },
  'MiniMax-M2': {
    model: 'MiniMax-M2',
    provider: 'minimax',
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 1000000,
  },
};

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
