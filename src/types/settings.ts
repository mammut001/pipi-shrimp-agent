/**
 * Settings-related type definitions
 * Includes ApiConfig and SettingsState interfaces
 */

// ============= Type Definitions =============

/** API configuration interface */
export interface ApiConfig {
  id: string;              // Unique identifier
  name: string;            // User-friendly name (e.g., "My Anthropic", "Minimax Pro")
  provider: 'anthropic' | 'openai' | 'minimax' | 'custom';
  apiKey: string;
  baseUrl?: string;        // Custom API endpoint
  model: string;           // Model name to use
}

/** Settings store state interface */
export interface SettingsState {
  // ========== Data State ==========
  apiConfigs: ApiConfig[];           // All saved API configurations
  activeConfigId: string | null;     // Currently active config ID
  /** @deprecated Use apiConfigs + activeConfigId instead */
  apiConfig: ApiConfig | null;       // Computed: the active config (for backward compat)
  availableModels: Record<string, string[]>; // Provider -> Model IDs
  workingDirectory: string;
  telegramToken?: string;
  theme: 'light' | 'dark';
  language: 'en' | 'zh';
  importedFiles: ImportedFile[];

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
   * Set working directory
   */
  setWorkingDirectory: (path: string) => Promise<void>;

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

/** Default working directory */
export const DEFAULT_WORKING_DIRECTORY = '';

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
