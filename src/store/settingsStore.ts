/**
 * Settings store - Zustand state management for app settings
 * Supports multiple API configurations with active config switching
 */

import { create } from 'zustand';
import type {
  SettingsState,
  ApiConfig,
  ImportedFile,
  BudgetSettings,
  AgentSettings,
  AutoResearchLlmSettings,
  WindowsShellProfile,
} from '../types/settings';
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_AUTORESEARCH_LLM_SETTINGS,
  DEFAULT_BUDGET_SETTINGS,
  DEFAULT_VISION_SETTINGS_STATE,
  DEFAULT_WINDOWS_SHELL_PROFILE,
} from '../types/settings';
import { resolvePricing } from '../shared/providers';
import { setLocale, getCurrentLocale, convertOldLanguageCode, convertToOldLanguageCode } from '../i18n';
import { saveSecret, loadSecret, migrateLegacySecret } from '../utils/secureSecrets';
import { normalizePersistedAgentSettings } from '../utils/storageMigrations';
import {
  generateSettingsConfigId,
  loadPersistedApiConfigs,
  persistApiConfigs,
  persistSettingsJson,
  removeSettingsItem,
  SETTINGS_STORAGE_KEYS,
} from './settings/settingsStorage';
import {
  mergeBootstrappedApiConfigs,
  resolveAutoResearchLlmSettingsOnBoot,
  resolvePreferredActiveConfigId,
} from './settings/apiConfigBootstrap';
import { useAutoResearchStore } from './autoresearchStore';
import {
  buildAutoResearchRunLockMessage,
  getAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';

function blockAutoResearchSettingsMutation(action: string): boolean {
  const lock = getAutoResearchLifecycleLock(useAutoResearchStore.getState());
  if (!lock.locked) {
    return false;
  }

  useAutoResearchStore.setState({
    statusMessage: buildAutoResearchRunLockMessage(action, lock),
  });
  return true;
}

function sanitizeAutoResearchLlmSettings(
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
  agentSettings: DEFAULT_AGENT_SETTINGS,
  autoResearchLlmSettings: DEFAULT_AUTORESEARCH_LLM_SETTINGS,
  visionSettings: DEFAULT_VISION_SETTINGS_STATE,
  windowsShellProfile: DEFAULT_WINDOWS_SHELL_PROFILE,

  // ========== Imported Files Methods ==========

  /**
   * Add a new API configuration
   */
  addApiConfig: async (configData) => {
    const newConfig: ApiConfig = {
      ...configData,
      id: generateSettingsConfigId(),
      // Back-fill modelProviderId so identity is always explicit
      modelProviderId: configData.modelProviderId ?? configData.provider,
    };

    const { apiConfigs } = get();
    const updatedConfigs = [...apiConfigs, newConfig];

    // If this is the first config, auto-activate it
    const activeId = resolvePreferredActiveConfigId(
      updatedConfigs,
      apiConfigs.length === 0 ? newConfig.id : get().activeConfigId,
    );
    const activeConfig = activeId === newConfig.id ? newConfig : get().apiConfig;
    const autoResearchLlmSettings = sanitizeAutoResearchLlmSettings(
      get().autoResearchLlmSettings,
      updatedConfigs,
    );

    set({
      apiConfigs: updatedConfigs,
      activeConfigId: activeId,
      apiConfig: activeConfig,
      autoResearchLlmSettings,
    });

    persistApiConfigs(updatedConfigs, activeId);
    persistSettingsJson(
      SETTINGS_STORAGE_KEYS.autoResearchLlmSettings,
      autoResearchLlmSettings,
      'Failed to persist AutoResearch LLM settings:',
    );
    return newConfig;
  },

  /**
   * Update an existing API configuration
   */
  updateApiConfig: async (id, updates) => {
    if (blockAutoResearchSettingsMutation('change the AutoResearch provider configuration')) {
      return;
    }

    const { apiConfigs, activeConfigId } = get();
    const updatedConfigs = apiConfigs.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    );

    const nextActiveConfigId = resolvePreferredActiveConfigId(updatedConfigs, activeConfigId);

    // Update apiConfig if the active one was modified
    const activeConfig = nextActiveConfigId
      ? updatedConfigs.find((c) => c.id === nextActiveConfigId) || null
      : null;
    const autoResearchLlmSettings = sanitizeAutoResearchLlmSettings(
      get().autoResearchLlmSettings,
      updatedConfigs,
    );

    set({
      apiConfigs: updatedConfigs,
      activeConfigId: nextActiveConfigId,
      apiConfig: activeConfig,
      autoResearchLlmSettings,
    });

    persistApiConfigs(updatedConfigs, nextActiveConfigId);
    persistSettingsJson(
      SETTINGS_STORAGE_KEYS.autoResearchLlmSettings,
      autoResearchLlmSettings,
      'Failed to persist AutoResearch LLM settings:',
    );
  },

  /**
   * Remove an API configuration
   */
  removeApiConfig: async (id) => {
    const { apiConfigs, activeConfigId } = get();
    const updatedConfigs = apiConfigs.filter((c) => c.id !== id);

    // If we removed the active config, switch to first remaining
    const newActiveId = resolvePreferredActiveConfigId(
      updatedConfigs,
      activeConfigId === id ? null : activeConfigId,
    );

    const activeConfig = newActiveId
      ? updatedConfigs.find((c) => c.id === newActiveId) || null
      : null;
    const autoResearchLlmSettings = sanitizeAutoResearchLlmSettings(
      get().autoResearchLlmSettings,
      updatedConfigs,
    );

    set({
      apiConfigs: updatedConfigs,
      activeConfigId: newActiveId,
      apiConfig: activeConfig,
      autoResearchLlmSettings,
    });

    persistApiConfigs(updatedConfigs, newActiveId);
    persistSettingsJson(
      SETTINGS_STORAGE_KEYS.autoResearchLlmSettings,
      autoResearchLlmSettings,
      'Failed to persist AutoResearch LLM settings:',
    );
  },

  /**
   * Set the active API configuration by ID
   */
  setActiveConfig: (id) => {
    if (blockAutoResearchSettingsMutation('change the AutoResearch provider selection')) {
      return;
    }

    const { apiConfigs } = get();
    const config = apiConfigs.find((c) => c.id === id);
    if (config) {
      set({
        activeConfigId: id,
        apiConfig: config,
      });
      localStorage.setItem(SETTINGS_STORAGE_KEYS.activeConfig, id);
    }
  },

  /**
   * Get the currently active API configuration
   */
  getActiveConfig: () => {
    const { apiConfigs, activeConfigId } = get();
    const resolvedActiveId = resolvePreferredActiveConfigId(apiConfigs, activeConfigId);
    if (!resolvedActiveId) {
      return null;
    }
    return apiConfigs.find((c) => c.id === resolvedActiveId) || null;
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
   * Set Telegram token and persist via secureSecrets. The active
   * secure storage provider (localStorage or OS keychain — see
   * AUDIT-FIX [R7-15]) is selected at runtime by
   * `getSecureStorage()`.
   */
  setTelegramToken: async (token: string) => {
    try {
      await saveSecret('telegram-token', token);
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
      localStorage.setItem(SETTINGS_STORAGE_KEYS.theme, theme);
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
      localStorage.setItem(SETTINGS_STORAGE_KEYS.language, language);
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
      persistSettingsJson(SETTINGS_STORAGE_KEYS.importedFiles, updatedFiles, 'Failed to persist imported files:');
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
      persistSettingsJson(SETTINGS_STORAGE_KEYS.importedFiles, updatedFiles, 'Failed to persist imported files:');
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
      removeSettingsItem(SETTINGS_STORAGE_KEYS.importedFiles, 'Failed to clear imported files:');
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
      persistSettingsJson(SETTINGS_STORAGE_KEYS.budgetSettings, newSettings, 'Failed to persist budget settings:');
    } catch (error) {
      console.error('Failed to persist budget settings:', error);
    }
  },

  updateAgentSettings: (settings: Partial<AgentSettings>) => {
    const currentSettings = get().agentSettings;
    const newSettings = { ...currentSettings, ...settings };

    set({ agentSettings: newSettings });

    try {
      persistSettingsJson(SETTINGS_STORAGE_KEYS.agentSettings, newSettings, 'Failed to persist agent settings:');
    } catch (error) {
      console.error('Failed to persist agent settings:', error);
    }
  },

  updateAutoResearchLlmSettings: (settings) => {
    if (blockAutoResearchSettingsMutation('change the AutoResearch provider selection')) {
      return;
    }

    const nextSettings = sanitizeAutoResearchLlmSettings(
      {
        ...get().autoResearchLlmSettings,
        ...settings,
      },
      get().apiConfigs,
    );

    set({ autoResearchLlmSettings: nextSettings });

    try {
      persistSettingsJson(
        SETTINGS_STORAGE_KEYS.autoResearchLlmSettings,
        nextSettings,
        'Failed to persist AutoResearch LLM settings:',
      );
    } catch (error) {
      console.error('Failed to persist AutoResearch LLM settings:', error);
    }
  },

  updateVisionSettings: (settings) => {
    const currentSettings = get().visionSettings;
    const newSettings = {
      ...currentSettings,
      ...settings,
      transcribe: {
        ...currentSettings.transcribe,
        ...settings.transcribe,
      },
      ocrLanguages: settings.ocrLanguages ?? currentSettings.ocrLanguages,
    };

    set({ visionSettings: newSettings });

    try {
      persistSettingsJson(SETTINGS_STORAGE_KEYS.visionSettings, newSettings, 'Failed to persist vision settings:');
    } catch (error) {
      console.error('Failed to persist vision settings:', error);
    }
  },

  setWindowsShellProfile: (profile: WindowsShellProfile) => {
    set({ windowsShellProfile: profile });
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEYS.windowsShellProfile, profile);
    } catch (error) {
      console.error('Failed to persist Windows shell profile:', error);
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

const initializeSettings = async () => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    // Load theme
    const storedTheme = localStorage.getItem(SETTINGS_STORAGE_KEYS.theme);
    if (storedTheme === 'light' || storedTheme === 'dark') {
      useSettingsStore.setState({ theme: storedTheme });
    }

    // Load language
    const storedLanguage = localStorage.getItem(SETTINGS_STORAGE_KEYS.language);
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

    const storedShellProfile = localStorage.getItem(SETTINGS_STORAGE_KEYS.windowsShellProfile);
    if (storedShellProfile === 'auto' || storedShellProfile === 'powershell' || storedShellProfile === 'wsl') {
      useSettingsStore.setState({ windowsShellProfile: storedShellProfile });
    }

    // Load API configs before any async secret hydration so Settings can
    // render the persisted active config on first paint.
    const storedActiveId = localStorage.getItem(SETTINGS_STORAGE_KEYS.activeConfig);
    const storedConfigs = loadPersistedApiConfigs();
    const configs = mergeBootstrappedApiConfigs(storedConfigs);

    const activeId = resolvePreferredActiveConfigId(configs, storedActiveId);
    const activeConfig = activeId
      ? configs.find((c) => c.id === activeId) || null
      : null;

    let storedAutoResearchLlmSettings: Partial<AutoResearchLlmSettings> | null = null;
    const storedAutoResearchLlmSettingsRaw = localStorage.getItem(SETTINGS_STORAGE_KEYS.autoResearchLlmSettings);
    if (storedAutoResearchLlmSettingsRaw) {
      try {
        storedAutoResearchLlmSettings = JSON.parse(storedAutoResearchLlmSettingsRaw) as Partial<AutoResearchLlmSettings>;
      } catch (error) {
        console.error('Failed to parse AutoResearch LLM settings:', error);
      }
    }

    const autoResearchLlmSettings = resolveAutoResearchLlmSettingsOnBoot({
      configs,
      stored: storedAutoResearchLlmSettings,
      activeConfigId: activeId,
    });

    useSettingsStore.setState({
      apiConfigs: configs,
      activeConfigId: activeId,
      apiConfig: activeConfig,
      autoResearchLlmSettings,
    });

    persistApiConfigs(configs, activeId);
    persistSettingsJson(
      SETTINGS_STORAGE_KEYS.autoResearchLlmSettings,
      autoResearchLlmSettings,
      'Failed to persist AutoResearch LLM settings:',
    );

    // Load Telegram token (migrate from legacy key if needed).
    // loadSecret / migrateLegacySecret are async because the active
    // secure storage provider may be the OS keychain
    // (AUDIT-FIX [R7-15]); awaiting them in the boot path lets the
    // token be hydrated from whichever backend is in use.
    const telegramToken = await loadSecret('telegram-token');
    if (!telegramToken) {
      const migrated = await migrateLegacySecret(SETTINGS_STORAGE_KEYS.telegramToken, 'telegram-token');
      if (migrated) {
        useSettingsStore.setState({ telegramToken: migrated });
      }
    } else {
      useSettingsStore.setState({ telegramToken });
    }

    // Load imported files
    const storedImportedFiles = localStorage.getItem(SETTINGS_STORAGE_KEYS.importedFiles);
    if (storedImportedFiles) {
      useSettingsStore.setState({ importedFiles: JSON.parse(storedImportedFiles) });
    }

    // Load budget settings
    const storedBudgetSettings = localStorage.getItem(SETTINGS_STORAGE_KEYS.budgetSettings);
    if (storedBudgetSettings) {
      try {
        const budgetSettings = JSON.parse(storedBudgetSettings);
        useSettingsStore.setState({ budgetSettings: { ...DEFAULT_BUDGET_SETTINGS, ...budgetSettings } });
      } catch (error) {
        console.error('Failed to parse budget settings:', error);
      }
    }

    // Load agent settings
    const storedAgentSettings = localStorage.getItem(SETTINGS_STORAGE_KEYS.agentSettings);
    if (storedAgentSettings) {
      const { agentSettings, migrated } = normalizePersistedAgentSettings(storedAgentSettings);
      useSettingsStore.setState({ agentSettings });
      if (migrated) {
        persistSettingsJson(
          SETTINGS_STORAGE_KEYS.agentSettings,
          agentSettings,
          'Failed to persist migrated agent settings:',
        );
      }
    }

    const storedVisionSettings = localStorage.getItem(SETTINGS_STORAGE_KEYS.visionSettings);
    if (storedVisionSettings) {
      try {
        const visionSettings = JSON.parse(storedVisionSettings);
        useSettingsStore.setState({
          visionSettings: {
            ...DEFAULT_VISION_SETTINGS_STATE,
            ...visionSettings,
            transcribe: {
              ...DEFAULT_VISION_SETTINGS_STATE.transcribe,
              ...(visionSettings?.transcribe ?? {}),
            },
            ocrLanguages: Array.isArray(visionSettings?.ocrLanguages)
              ? visionSettings.ocrLanguages
              : DEFAULT_VISION_SETTINGS_STATE.ocrLanguages,
          },
        });
      } catch (error) {
        console.error('Failed to parse vision settings:', error);
      }
    }
  } catch (error) {
    console.error('Failed to initialize settings:', error);
  }
};

// Initialize on module load. Fire-and-forget — any error in
// initialization must not block the rest of the app from booting.
void initializeSettings().catch((err) => {
  console.error('[settingsStore] initialize failed', err);
});

export type { ApiConfig } from '../types/settings';
