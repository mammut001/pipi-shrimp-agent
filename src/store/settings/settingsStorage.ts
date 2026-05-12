import type { ApiConfig } from '../../types/settings';
import { deobfuscateInline, obfuscateInline } from '../../utils/secureSecrets';

export const SETTINGS_STORAGE_KEYS = {
  apiConfigs: 'ai-agent-api-configs',
  activeConfig: 'ai-agent-active-config',
  autoResearchLlmSettings: 'ai-agent-autoresearch-llm-settings',
  telegramToken: 'ai-agent-telegram-token',
  theme: 'ai-agent-theme',
  language: 'ai-agent-language',
  importedFiles: 'ai-agent-imported-files',
  budgetSettings: 'ai-agent-budget-settings',
  agentSettings: 'ai-agent-agent-settings',
  visionSettings: 'ai-agent-vision-settings',
  legacyApiConfig: 'ai-agent-api-config',
} as const;

export function generateSettingsConfigId(): string {
  return `config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function persistApiConfigs(configs: ApiConfig[], activeId: string | null) {
  try {
    const safe = configs.map((config) => ({
      ...config,
      apiKey: config.apiKey ? obfuscateInline(config.apiKey) : '',
    }));
    localStorage.setItem(SETTINGS_STORAGE_KEYS.apiConfigs, JSON.stringify(safe));
    if (activeId) {
      localStorage.setItem(SETTINGS_STORAGE_KEYS.activeConfig, activeId);
    } else {
      localStorage.removeItem(SETTINGS_STORAGE_KEYS.activeConfig);
    }
  } catch (error) {
    console.error('Failed to persist API configs:', error);
  }
}

export function loadPersistedApiConfigs(): ApiConfig[] {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEYS.apiConfigs);
    if (!raw) return [];
    const configs = JSON.parse(raw) as ApiConfig[];
    return configs.map((config) => ({
      ...config,
      apiKey: config.apiKey ? deobfuscateInline(config.apiKey) : '',
    }));
  } catch {
    return [];
  }
}

export function persistSettingsJson(key: string, value: unknown, errorMessage: string) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(errorMessage, error);
  }
}

export function removeSettingsItem(key: string, errorMessage: string) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(errorMessage, error);
  }
}
