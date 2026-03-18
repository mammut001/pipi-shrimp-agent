/**
 * Settings store - Zustand state management for app settings
 * Supports multiple API configurations with active config switching
 */

import { create } from 'zustand';
import type { SettingsState, ApiConfig, ImportedFile } from '../types/settings';
import { DEFAULT_WORKING_DIRECTORY } from '../types/settings';

/**
 * Storage keys for persisting settings
 */
const API_CONFIGS_STORAGE_KEY = 'ai-agent-api-configs';
const ACTIVE_CONFIG_STORAGE_KEY = 'ai-agent-active-config';
const WORKING_DIR_STORAGE_KEY = 'ai-agent-working-dir';
const TELEGRAM_TOKEN_STORAGE_KEY = 'ai-agent-telegram-token';
const THEME_STORAGE_KEY = 'ai-agent-theme';
const LANGUAGE_STORAGE_KEY = 'ai-agent-language';
const IMPORTED_FILES_STORAGE_KEY = 'ai-agent-imported-files';

/** Legacy storage key (for migration) */
const LEGACY_API_CONFIG_KEY = 'ai-agent-api-config';

/**
 * Generate a unique ID for API configs
 */
function generateConfigId(): string {
  return `config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persist all API configs to localStorage
 */
function persistConfigs(configs: ApiConfig[], activeId: string | null) {
  try {
    localStorage.setItem(API_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    if (activeId) {
      localStorage.setItem(ACTIVE_CONFIG_STORAGE_KEY, activeId);
    }
  } catch (error) {
    console.error('Failed to persist API configs:', error);
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
  workingDirectory: DEFAULT_WORKING_DIRECTORY,
  telegramToken: undefined,
  theme: 'dark',
  language: 'en',
  importedFiles: [],

  // ========== Imported Files Methods ==========

  /**
   * Add a new API configuration
   */
  addApiConfig: async (configData) => {
    const newConfig: ApiConfig = {
      ...configData,
      id: generateConfigId(),
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
      const { invoke } = await import('@tauri-apps/api/tauri');
      const models = await invoke<string[]>('fetch_available_models', {
        provider,
        apiKey,
        baseUrl,
      });

      set((state) => ({
        availableModels: {
          ...state.availableModels,
          [provider]: models,
        },
      }));

      return models;
    } catch (error) {
      console.error('Failed to fetch models:', error);
      throw error;
    }
  },

  /**
   * Set working directory and persist
   */
  setWorkingDirectory: async (path: string) => {
    try {
      localStorage.setItem(WORKING_DIR_STORAGE_KEY, path);
      set({ workingDirectory: path });
    } catch (error) {
      console.error('Failed to save working directory:', error);
      throw error;
    }
  },

  /**
   * Set Telegram token and persist
   */
  setTelegramToken: async (token: string) => {
    try {
      localStorage.setItem(TELEGRAM_TOKEN_STORAGE_KEY, token);
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
    }

    // Load working directory
    const storedWorkingDir = localStorage.getItem(WORKING_DIR_STORAGE_KEY);
    if (storedWorkingDir) {
      useSettingsStore.setState({ workingDirectory: storedWorkingDir });
    }

    // Load Telegram token
    const storedTelegramToken = localStorage.getItem(TELEGRAM_TOKEN_STORAGE_KEY);
    if (storedTelegramToken) {
      useSettingsStore.setState({ telegramToken: storedTelegramToken });
    }

    // Load imported files
    const storedImportedFiles = localStorage.getItem(IMPORTED_FILES_STORAGE_KEY);
    if (storedImportedFiles) {
      useSettingsStore.setState({ importedFiles: JSON.parse(storedImportedFiles) });
    }

    // Load API configs (new format)
    const storedConfigs = localStorage.getItem(API_CONFIGS_STORAGE_KEY);
    const storedActiveId = localStorage.getItem(ACTIVE_CONFIG_STORAGE_KEY);

    if (storedConfigs) {
      // New multi-config format
      const configs = JSON.parse(storedConfigs) as ApiConfig[];
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
