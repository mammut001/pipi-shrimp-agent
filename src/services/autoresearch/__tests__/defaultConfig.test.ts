import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  AUTORESEARCH_FALLBACK_CONFIG,
  AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY,
  getAutoResearchDefaultConfig,
  loadPersistedAutoResearchLastUsedConfig,
  persistAutoResearchLastUsedConfig,
  resolveAutoResearchDefaultConfig,
} from '../defaultConfig';

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

function clearInjectedDefaults() {
  delete (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_WORKDIR__;
  delete (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_EXPERIMENT_DIR__;
  delete (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_METRIC__;
  delete (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_DIRECTION__;
  delete (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_ITERATIONS__;
}

describe('autoresearch default config', () => {
  beforeEach(() => {
    storage.data = {};
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();
    clearInjectedDefaults();
  });

  it('returns the shipped fallback config when no dev overrides are injected', () => {
    expect(getAutoResearchDefaultConfig()).toEqual(AUTORESEARCH_FALLBACK_CONFIG);
  });

  it('applies injected dev overrides and normalizes direction and iterations', () => {
    (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_WORKDIR__ = '~/autoresearch';
    (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_EXPERIMENT_DIR__ = '/Users/yuhansong/Documents/tiny-autoresearch-digits';
    (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_METRIC__ = 'cv_accuracy';
    (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_DIRECTION__ = 'Higher';
    (globalThis as Record<string, unknown>).__AUTORESEARCH_DEFAULT_ITERATIONS__ = '99';

    expect(getAutoResearchDefaultConfig()).toEqual({
      workdir: '~/autoresearch',
      experimentDir: '/Users/yuhansong/Documents/tiny-autoresearch-digits',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 50,
    });
  });

  it('prefers last-used config over defaults when resolving setup values', () => {
    const resolved = resolveAutoResearchDefaultConfig({
      workdir: '/tmp/workdir',
      experimentDir: '/tmp/exp',
      metric: 'accuracy',
      direction: 'lower',
      iterations: 3,
    });

    expect(resolved.source).toBe('last-used');
    expect(resolved.config).toEqual({
      workdir: '/tmp/workdir',
      experimentDir: '/tmp/exp',
      metric: 'accuracy',
      direction: 'lower',
      iterations: 3,
    });
  });

  it('persists and loads the last-used config through localStorage', () => {
    persistAutoResearchLastUsedConfig({
      workdir: '/tmp/workdir',
      experimentDir: '/tmp/exp',
      metric: 'f1',
      direction: 'higher',
      iterations: 7,
    });

    expect(storage.data[AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY]).toContain('"metric":"f1"');
    expect(loadPersistedAutoResearchLastUsedConfig()).toEqual({
      workdir: '/tmp/workdir',
      experimentDir: '/tmp/exp',
      metric: 'f1',
      direction: 'higher',
      iterations: 7,
    });

    persistAutoResearchLastUsedConfig(null);
    expect(storage.data[AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY]).toBeUndefined();
    expect(storage.removeItem).toHaveBeenCalledWith(AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY);
  });
});
