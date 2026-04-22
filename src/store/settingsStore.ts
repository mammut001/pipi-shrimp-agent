/**
 * Settings store - Zustand state management for app settings
 * Supports multiple API configurations with active config switching
 */

import { create } from 'zustand';
import type { SettingsState, ApiConfig, ImportedFile, BudgetSettings, AgentSettings } from '../types/settings';
import { DEFAULT_BUDGET_SETTINGS } from '../types/settings';
import { resolvePricing } from '../shared/providers';
import { setLocale, getCurrentLocale, convertOldLanguageCode, convertToOldLanguageCode } from '../i18n';

/**
 * Storage keys for persisting settings
 */
const API_CONFIGS_STORAGE_KEY = 'ai-agent-api-configs';
const ACTIVE_CONFIG_STORAGE_KEY = 'ai-agent-active-config';
const TELEGRAM_TOKEN_STORAGE_KEY = 'ai-agent-telegram-token';
const THEME_STORAGE_KEY = 'ai-agent-theme';
const LANGUAGE_STORAGE_KEY = 'ai-agent-language';
const IMPORTED_FILES_STORAGE_KEY = 'ai-agent-imported-files';
const BUDGET_SETTINGS_STORAGE_KEY = 'ai-agent-budget-settings';
const AGENT_SETTINGS_STORAGE_KEY = 'ai-agent-agent-settings';

/** Legacy storage key (for migration) */
const LEGACY_API_CONFIG_KEY = 'ai-agent-api-config';

/**
 * Generate a unique ID for API configs
 */
function generateConfigId(): string {
  return `config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Minimal obfuscation for API keys in localStorage.
 * 
 * ⚠️ SECURITY WARNING ⚠️
 * This is NOT real encryption. btoa() creates easily reversible base64 encoding.
 * Anyone can decode with: atob(encodedKey)
 * 
 * Current protection: prevents casual shoulder-surfing and accidental log exposure
 * 
 * P2 TODO: Implement proper encryption using:
 *   - @tauri-apps/plugin-secure-store (when available), OR
 *   - Use OS keychain via tauri-plugin-os
 *   
 * Current fallback: if secure storage unavailable, API keys are stored with this
 * basic obfuscation only.
 */
function obfuscate(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function deobfuscate(value: string): string {
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    // Fallback: value might be stored in plaintext from before this change
    return value;
  }
}

/**
 * Persist all API configs to localStorage
 */
function persistConfigs(configs: ApiConfig[], activeId: string | null) {
  try {
    // Obfuscate API keys before persisting
    const safe = configs.map(c => ({
      ...c,
      apiKey: c.apiKey ? obfuscate(c.apiKey) : '',
    }));
    localStorage.setItem(API_CONFIGS_STORAGE_KEY, JSON.stringify(safe));
    if (activeId) {
      localStorage.setItem(ACTIVE_CONFIG_STORAGE_KEY, activeId);
    }
  } catch (error) {
    console.error('Failed to persist API configs:', error);
  }
}

/**
 * Load API configs from localStorage, deobfuscating keys.
 */
function loadPersistedConfigs(): ApiConfig[] {
  try {
    const raw = localStorage.getItem(API_CONFIGS_STORAGE_KEY);
    if (!raw) return [];
    const configs = JSON.parse(raw) as ApiConfig[];
    return configs.map(c => ({
      ...c,
      apiKey: c.apiKey ? deobfuscate(c.apiKey) : '',
    }));
  } catch {
    return [];
  }
}

/**
 * Settings store using Zustand
 */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  // ========== Initial State ==========
  apiConfigs: [],
  activeConfigId: null,
  apiConfig: null, // Computed from apiConfigs + activeConfigId
  availableModels: {},
  availableModelEntries: {},
  telegramToken: undefined,
  theme: 'dark',
  language: 'en',
  importedFiles: [],
  budgetSettings: DEFAULT_BUDGET_SETTINGS,
  agentSettings: { maxToolRounds: 50 },

  // ========== Imported Files Methods ==========

  /**
   * Add a new API configuration
   */
  addApiConfig: async (configData) => {
    const newConfig: ApiConfig = {
      ...configData,
      id: generateConfigId(),
      // Back-fill modelProviderId so identity is always explicit
      modelProviderId: configData.modelProviderId ?? configData.provider,
    };

    const { apiConfigs } = get();
    const updatedConfigs = [...apiConfigs, newConfig];

    // If this is the first config, auto-activate it
    const activeId = apiConfigs.length === 0 ? newConfig.id : get().activeConfigId;
    const activeConfig = activeId === newConfig.id ? newConfig : get().apiConfig;

    set({
      apiConfigs: updatedConfigs,
      activeConfigId: activeId,
      apiConfig: activeConfig,
    });

    persistConfigs(updatedConfigs, activeId);
    return newConfig;
  },

  /**
   * Update an existing API configuration
   */
  updateApiConfig: async (id, updates) => {
    const { apiConfigs, activeConfigId } = get();
    const updatedConfigs = apiConfigs.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    );

    // Update apiConfig if the active one was modified
    const activeConfig = activeConfigId
      ? updatedConfigs.find((c) => c.id === activeConfigId) || null
      : null;

    set({
      apiConfigs: updatedConfigs,
      apiConfig: activeConfig,
    });

    persistConfigs(updatedConfigs, activeConfigId);
  },

  /**
   * Remove an API configuration
   */
  removeApiConfig: async (id) => {
    const { apiConfigs, activeConfigId } = get();
    const updatedConfigs = apiConfigs.filter((c) => c.id !== id);

    // If we removed the active config, switch to first remaining
    let newActiveId = activeConfigId;
    if (activeConfigId === id) {
      newActiveId = updatedConfigs.length > 0 ? updatedConfigs[0].id : null;
    }

    const activeConfig = newActiveId
      ? updatedConfigs.find((c) => c.id === newActiveId) || null
      : null;

    set({
      apiConfigs: updatedConfigs,
      activeConfigId: newActiveId,
      apiConfig: activeConfig,
    });

    persistConfigs(updatedConfigs, newActiveId);
  },

  /**
   * Set the active API configuration by ID
   */
  setActiveConfig: (id) => {
    const { apiConfigs } = get();
    const config = apiConfigs.find((c) => c.id === id);
    if (config) {
      set({
        activeConfigId: id,
        apiConfig: config,
      });
      localStorage.setItem(ACTIVE_CONFIG_STORAGE_KEY, id);
    }
  },

  /**
   * Get the currently active API configuration
   */
  getActiveConfig: () => {
    const { apiConfigs, activeConfigId } = get();
    if (!activeConfigId) return null;
    return apiConfigs.find((c) => c.id === activeConfigId) || null;
  },

  // ========== Legacy Methods (backward compat) ==========

  /**
   * Set API configuration (legacy)
   */
  setApiConfig: async (config: ApiConfig) => {
    const { apiConfigs } = get();
    const existing = apiConfigs.find((c) => c.id === config.id);

    if (existing) {
      await get().updateApiConfig(config.id, config);
    } else {
      await get().addApiConfig(config);
    }
  },

  /**
   * Get API configuration (legacy)
   */
  getApiConfig: async () => {
    return get().getActiveConfig();
  },

  // ========== Other Methods ==========

  /**
   * Fetch available models from provider
   */
  fetchAvailableModels: async (params?: { provider: ApiConfig['provider'], apiKey: string, baseUrl?: string }) => {
    let provider: ApiConfig['provider'];
    let apiKey: string;
    let baseUrl: string | null = null;

    if (params) {
      provider = params.provider;
      apiKey = params.apiKey;
      baseUrl = params.baseUrl || null;
    } else {
      const activeConfig = get().getActiveConfig();
      if (!activeConfig?.apiKey) {
        throw new Error('API key is required to fetch models');
      }
      provider = activeConfig.provider;
      apiKey = activeConfig.apiKey;
      baseUrl = activeConfig.baseUrl || null;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const models = await invoke<string[]>('fetch_available_models', {
        provider,
        apiKey,
        baseUrl,
      });

      const remoteEntries = models.map((id) => ({ id, source: 'remote' as const }));

      set((state) => ({
        availableModels: {
          ...state.availableModels,
          [provider]: models,
        },
        availableModelEntries: {
          ...state.availableModelEntries,
          [provider]: remoteEntries,
        },
      }));

      return models;
    } catch (error) {
      console.error('Failed to fetch models:', error);
      throw error;
    }
  },

  /**
   * Set Telegram token and persist
   */
  setTelegramToken: async (token: string) => {
    try {
      localStorage.setItem(TELEGRAM_TOKEN_STORAGE_KEY, obfuscate(token));
      set({ telegramToken: token });
    } catch (error) {
      console.error('Failed to save Telegram token:', error);
      throw error;
    }
  },

  /**
   * Set theme
   */
  setTheme: (theme: 'light' | 'dark') => {
    set({ theme });
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.error('Failed to persist theme:', error);
    }
  },

  /**
   * Set language
   */
  setLanguage: (language: 'en' | 'zh') => {
    const locale = convertOldLanguageCode(language);
    setLocale(locale);
    set({ language });
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (error) {
      console.error('Failed to persist language:', error);
    }
  },

  /**
   * Clear API key for active config
   */
  clearApiKey: async () => {
    const { activeConfigId } = get();
    if (activeConfigId) {
      await get().updateApiConfig(activeConfigId, { apiKey: '' });
    }
  },

  /**
   * Add imported files
   */
  addImportedFiles: (files: { name: string; path: string }[]) => {
    const newFiles: ImportedFile[] = files.map((f) => ({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      path: f.path,
      addedAt: Date.now(),
    }));

    const updatedFiles = [...get().importedFiles, ...newFiles];
    set({ importedFiles: updatedFiles });

    try {
      localStorage.setItem(IMPORTED_FILES_STORAGE_KEY, JSON.stringify(updatedFiles));
    } catch (error) {
      console.error('Failed to persist imported files:', error);
    }
  },

  /**
   * Remove imported file by ID
   */
  removeImportedFile: (id: string) => {
    const updatedFiles = get().importedFiles.filter((f) => f.id !== id);
    set({ importedFiles: updatedFiles });

    try {
      localStorage.setItem(IMPORTED_FILES_STORAGE_KEY, JSON.stringify(updatedFiles));
    } catch (error) {
      console.error('Failed to persist imported files:', error);
    }
  },

  /**
   * Clear all imported files
   */
  clearImportedFiles: () => {
    set({ importedFiles: [] });

    try {
      localStorage.removeItem(IMPORTED_FILES_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear imported files:', error);
    }
  },

  /**
   * Update budget settings
   */
  updateBudgetSettings: (settings: Partial<BudgetSettings>) => {
    const currentSettings = get().budgetSettings;
    const newSettings = { ...currentSettings, ...settings };

    set({ budgetSettings: newSettings });

    try {
      localStorage.setItem(BUDGET_SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    } catch (error) {
      console.error('Failed to persist budget settings:', error);
    }
  },

  updateAgentSettings: (settings: Partial<AgentSettings>) => {
    const currentSettings = get().agentSettings;
    const newSettings = { ...currentSettings, ...settings };

    set({ agentSettings: newSettings });

    try {
      localStorage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    } catch (error) {
      console.error('Failed to persist agent settings:', error);
    }
  },

  /**
   * Get pricing for a specific model (custom or default)
   */
  getModelPricing: (model: string, _provider: ApiConfig['provider']) => {
    const { apiConfigs, activeConfigId } = get();
    const activeConfig = apiConfigs.find(c => c.id === activeConfigId);
    const providerScope = activeConfig?.model === model
      ? (activeConfig.modelProviderId || activeConfig.provider)
      : _provider;
    const defaultPricing = resolvePricing(model, providerScope) || resolvePricing(model, _provider);

    // First check if the active config has custom pricing for this model
    if (activeConfig && activeConfig.pricing && activeConfig.model === model) {
      const resolvedProvider = (providerScope === 'anthropic-compatible' || providerScope === 'openai-compatible')
        ? 'other' as const
        : providerScope;
      return {
        model,
        provider: resolvedProvider,
        inputPrice: activeConfig.pricing.inputPrice ?? defaultPricing?.inputPrice ?? 0,
        outputPrice: activeConfig.pricing.outputPrice ?? defaultPricing?.outputPrice ?? 0,
        cacheReadPrice: activeConfig.pricing.cacheReadPrice ?? defaultPricing?.cacheReadPrice,
        cacheWritePrice: activeConfig.pricing.cacheWritePrice ?? defaultPricing?.cacheWritePrice,
        maxTokens: activeConfig.pricing.maxTokens ?? defaultPricing?.maxTokens,
        contextWindow: activeConfig.pricing.contextWindow ?? defaultPricing?.contextWindow ?? 200000,
      };
    }

    // Fall back to default pricing from registry
    if (defaultPricing) {
      // Map compatible provider names to the ModelPricing union
      const pricingProvider = (_provider === 'anthropic-compatible' || _provider === 'openai-compatible')
        ? 'other' as const
        : _provider;
      return {
        model,
        provider: pricingProvider,
        ...defaultPricing,
      };
    }
    return null;
  },
}));

// ========== Initialize from localStorage ==========

const initializeSettings = () => {
  try {
    // Load theme
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') {
      useSettingsStore.setState({ theme: storedTheme });
    }

    // Load language
    const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (storedLanguage === 'en' || storedLanguage === 'zh') {
      useSettingsStore.setState({ language: storedLanguage });
      // 同时更新 i18n 系统的语言
      const locale = convertOldLanguageCode(storedLanguage);
      setLocale(locale);
    } else {
      // 尝试从新的 locale 存储加载
      const currentLocale = getCurrentLocale();
      const oldLanguage = convertToOldLanguageCode(currentLocale);
      useSettingsStore.setState({ language: oldLanguage });
    }

    // Load Telegram token
    const storedTelegramToken = localStorage.getItem(TELEGRAM_TOKEN_STORAGE_KEY);
    if (storedTelegramToken) {
      useSettingsStore.setState({ telegramToken: deobfuscate(storedTelegramToken) });
    }

    // Load imported files
    const storedImportedFiles = localStorage.getItem(IMPORTED_FILES_STORAGE_KEY);
    if (storedImportedFiles) {
      useSettingsStore.setState({ importedFiles: JSON.parse(storedImportedFiles) });
    }

    // Load budget settings
    const storedBudgetSettings = localStorage.getItem(BUDGET_SETTINGS_STORAGE_KEY);
    if (storedBudgetSettings) {
      try {
        const budgetSettings = JSON.parse(storedBudgetSettings);
        useSettingsStore.setState({ budgetSettings: { ...DEFAULT_BUDGET_SETTINGS, ...budgetSettings } });
      } catch (error) {
        console.error('Failed to parse budget settings:', error);
      }
    }

    // Load agent settings
    const storedAgentSettings = localStorage.getItem(AGENT_SETTINGS_STORAGE_KEY);
    if (storedAgentSettings) {
      try {
        const agentSettings = JSON.parse(storedAgentSettings);
        // If the user hasn't explicitly changed it from the old default of 10, implicitly bump it to 50
        if (agentSettings.maxToolRounds === 10) {
          agentSettings.maxToolRounds = 50;
        }
        useSettingsStore.setState({ agentSettings: { maxToolRounds: 50, ...agentSettings } });
      } catch (error) {
        console.error('Failed to parse agent settings:', error);
      }
    }

    // Load API configs (new format)
    const storedConfigs = localStorage.getItem(API_CONFIGS_STORAGE_KEY);
    const storedActiveId = localStorage.getItem(ACTIVE_CONFIG_STORAGE_KEY);

    if (storedConfigs) {
      // New multi-config format — deobfuscate API keys
      const raw = loadPersistedConfigs();
      // Back-fill modelProviderId for configs saved before P1-1 migration
      const configs = raw.map((c) => ({
        ...c,
        modelProviderId: c.modelProviderId ?? c.provider,
      }));
      const activeId = storedActiveId && configs.some((c) => c.id === storedActiveId)
        ? storedActiveId
        : configs.length > 0 ? configs[0].id : null;
      const activeConfig = activeId
        ? configs.find((c) => c.id === activeId) || null
        : null;

      useSettingsStore.setState({
        apiConfigs: configs,
        activeConfigId: activeId,
        apiConfig: activeConfig,
      });
    } else {
      // Try migrating from legacy single-config format
      const legacyStored = localStorage.getItem(LEGACY_API_CONFIG_KEY);
      if (legacyStored) {
        const legacyConfig = JSON.parse(legacyStored) as Omit<ApiConfig, 'id' | 'name'>;
        const migratedConfig: ApiConfig = {
          ...legacyConfig,
          id: generateConfigId(),
          name: legacyConfig.provider.charAt(0).toUpperCase() + legacyConfig.provider.slice(1),
        };

        const configs = [migratedConfig];
        useSettingsStore.setState({
          apiConfigs: configs,
          activeConfigId: migratedConfig.id,
          apiConfig: migratedConfig,
        });

        // Persist in new format and clean up legacy
        persistConfigs(configs, migratedConfig.id);
        localStorage.removeItem(LEGACY_API_CONFIG_KEY);
      }
    }
  } catch (error) {
    console.error('Failed to initialize settings:', error);
  }
};

// Initialize on module load
initializeSettings();

export type { ApiConfig } from '../types/settings';
