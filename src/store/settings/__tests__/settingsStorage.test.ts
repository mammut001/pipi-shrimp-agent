import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import type { ApiConfig } from '../../../types/settings';
import {
  loadPersistedApiConfigs,
  persistApiConfigs,
  persistSettingsJson,
  removeSettingsItem,
  SETTINGS_STORAGE_KEYS,
} from '../settingsStorage';

const storage = {
  data: {} as Record<string, string>,
  getItem: jest.fn((key: string) => storage.data[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    storage.data[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete storage.data[key];
  }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

function createConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    id: 'config-1',
    name: 'Anthropic',
    provider: 'anthropic',
    apiKey: 'secret-key',
    model: 'claude-3-5-sonnet-20241022',
    modelProviderId: 'anthropic',
    ...overrides,
  };
}

describe('settingsStorage', () => {
  beforeEach(() => {
    storage.data = {};
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();
  });

  it('persists API configs without storing raw API keys', () => {
    persistApiConfigs([createConfig()], 'config-1');

    const raw = storage.data[SETTINGS_STORAGE_KEYS.apiConfigs];
    expect(raw).toBeDefined();
    expect(raw).not.toContain('secret-key');
    expect(storage.data[SETTINGS_STORAGE_KEYS.activeConfig]).toBe('config-1');
    expect(loadPersistedApiConfigs()[0]?.apiKey).toBe('secret-key');
  });

  it('clears the active config key when there is no active config', () => {
    storage.data[SETTINGS_STORAGE_KEYS.activeConfig] = 'old-config';

    persistApiConfigs([], null);

    expect(storage.removeItem).toHaveBeenCalledWith(SETTINGS_STORAGE_KEYS.activeConfig);
  });

  it('persists and removes generic settings values', () => {
    persistSettingsJson(SETTINGS_STORAGE_KEYS.agentSettings, { maxToolRounds: 50 }, 'failed');
    expect(JSON.parse(storage.data[SETTINGS_STORAGE_KEYS.agentSettings])).toEqual({ maxToolRounds: 50 });

    removeSettingsItem(SETTINGS_STORAGE_KEYS.agentSettings, 'failed');
    expect(storage.data[SETTINGS_STORAGE_KEYS.agentSettings]).toBeUndefined();
  });
});
