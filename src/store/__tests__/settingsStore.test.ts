import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ApiConfig } from '@/types/settings';
import { DEFAULT_AUTORESEARCH_LLM_SETTINGS } from '@/types/settings';

const mockLoadSecret = jest.fn(async (_key: string): Promise<string | null> => null);
const mockMigrateLegacySecret = jest.fn(async (_legacyKey: string, _key: string): Promise<string | null> => null);
const mockSaveSecret = jest.fn(async (_key: string, _value: string): Promise<void> => undefined);

jest.mock('../../utils/secureSecrets', () => {
  const actual = jest.requireActual('../../utils/secureSecrets') as typeof import('../../utils/secureSecrets');
  return {
    ...actual,
    loadSecret: (...args: [string]) => mockLoadSecret(...args),
    migrateLegacySecret: (...args: [string, string]) => mockMigrateLegacySecret(...args),
    saveSecret: (...args: [string, string]) => mockSaveSecret(...args),
  };
});

const storage = {
  data: {} as Record<string, string>,
  getItem: jest.fn((key: string) => storage.data[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    storage.data[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete storage.data[key];
  }),
  clear() {
    storage.data = {};
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

function createConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    id: 'cfg-1',
    name: 'Primary Config',
    provider: 'openai',
    apiKey: 'secret-key',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    modelProviderId: 'openai',
    ...overrides,
  };
}

function createRun() {
  return {
    id: 'run-1',
    title: 'digits · accuracy',
    status: 'running' as const,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:01.000Z',
    config: {
      experimentDir: '/tmp/exp',
      workdir: '/tmp/work',
      metric: 'accuracy',
      direction: 'higher' as const,
      iterations: 5,
      configSnapshot: {
        configName: 'Primary Config',
        provider: 'openai',
        model: 'gpt-4.1',
        keyPresent: true,
        source: 'settings.activeConfig' as const,
      },
    },
    currentIteration: 1,
    bestMetricValue: null,
    bestIteration: null,
    failureCount: 0,
    iterations: [],
    events: [],
  };
}

describe('settingsStore AutoResearch mutation guard', () => {
  let useSettingsStore: typeof import('../settingsStore').useSettingsStore;
  let useAutoResearchStore: typeof import('../autoresearchStore').useAutoResearchStore;

  beforeEach(async () => {
    jest.resetModules();
    storage.clear();

    ({ useAutoResearchStore } = await import('../autoresearchStore'));
    ({ useSettingsStore } = await import('../settingsStore'));

    useAutoResearchStore.getState().resetSession();
    useAutoResearchStore.setState({
      runHistory: [],
      selectedRunId: null,
      statusMessage: undefined,
      reason: undefined,
      errorMessage: undefined,
    });

    const config = createConfig();
    useSettingsStore.setState({
      apiConfigs: [config],
      activeConfigId: config.id,
      apiConfig: config,
      autoResearchLlmSettings: DEFAULT_AUTORESEARCH_LLM_SETTINGS,
    });
  });

  it('blocks updateApiConfig while AutoResearch is active', async () => {
    useAutoResearchStore.setState({
      id: 'run-1',
      loopState: 'running',
      runHistory: [createRun()],
      selectedRunId: 'run-1',
      statusMessage: undefined,
    });

    await useSettingsStore.getState().updateApiConfig('cfg-1', { model: 'gpt-4.1-mini' });

    expect(useSettingsStore.getState().apiConfigs[0]?.model).toBe('gpt-4.1');
    expect(useAutoResearchStore.getState().statusMessage).toBe(
      'AutoResearch is still running. Stop the active run before you change the AutoResearch provider configuration.',
    );
  });

  it('allows updateApiConfig after the active run has stopped', async () => {
    useAutoResearchStore.setState({
      id: 'run-1',
      loopState: 'stopped',
      runHistory: [{
        ...createRun(),
        status: 'stopped',
      }],
      selectedRunId: 'run-1',
      statusMessage: undefined,
    });

    await useSettingsStore.getState().updateApiConfig('cfg-1', { model: 'gpt-4.1-mini' });

    expect(useSettingsStore.getState().apiConfigs[0]?.model).toBe('gpt-4.1-mini');
    expect(useAutoResearchStore.getState().statusMessage).toBeUndefined();
  });

  it('skips configs without API keys when resolving the active config fallback', async () => {
    const keyedConfig = createConfig({ id: 'cfg-keyed', apiKey: 'secret-key' });
    const emptyConfig = createConfig({ id: 'cfg-empty', apiKey: '', name: 'Empty Draft' });

    useSettingsStore.setState({
      apiConfigs: [emptyConfig, keyedConfig],
      activeConfigId: 'missing-active-id',
      apiConfig: null,
    });

    expect(useSettingsStore.getState().getActiveConfig()?.id).toBe('cfg-keyed');
  });

  it('returns null active config when no keyed configs exist', async () => {
    const emptyConfig = createConfig({ id: 'cfg-empty', apiKey: '' });

    useSettingsStore.setState({
      apiConfigs: [emptyConfig],
      activeConfigId: null,
      apiConfig: null,
    });

    expect(useSettingsStore.getState().getActiveConfig()).toBeNull();
  });

  it('persists the Windows shell profile selection', async () => {
    useSettingsStore.getState().setWindowsShellProfile('wsl');

    expect(useSettingsStore.getState().windowsShellProfile).toBe('wsl');
    expect(storage.setItem).toHaveBeenCalledWith('ai-agent-windows-shell-profile', 'wsl');
  });
});

describe('initializeSettings telegram secret isolation', () => {
  let useSettingsStore: typeof import('../settingsStore').useSettingsStore;
  let initializeSettings: typeof import('../settingsStore').initializeSettings;

  beforeEach(async () => {
    jest.resetModules();
    storage.clear();
    mockLoadSecret.mockReset();
    mockMigrateLegacySecret.mockReset();
    mockSaveSecret.mockReset();
    mockLoadSecret.mockResolvedValue(null);
    mockMigrateLegacySecret.mockResolvedValue(null);
    mockSaveSecret.mockResolvedValue(undefined);
  });

  it('still hydrates budget/agent/importedFiles when loadSecret rejects', async () => {
    mockLoadSecret.mockRejectedValue(new Error('keychain unavailable'));

    const importedFiles = [
      { id: 'file-1', name: 'notes.md', path: '/tmp/notes.md', addedAt: 1_700_000_000_000 },
    ];
    storage.data['ai-agent-imported-files'] = JSON.stringify(importedFiles);
    storage.data['ai-agent-budget-settings'] = JSON.stringify({
      monthlyLimit: 42,
      enabled: true,
    });
    storage.data['ai-agent-agent-settings'] = JSON.stringify({
      maxToolRounds: 9,
    });

    ({ useSettingsStore, initializeSettings } = await import('../settingsStore'));
    await initializeSettings();

    const state = useSettingsStore.getState();
    expect(state.importedFiles).toEqual(importedFiles);
    expect(state.budgetSettings.monthlyLimit).toBe(42);
    expect(state.budgetSettings.enabled).toBe(true);
    expect(state.agentSettings.maxToolRounds).toBe(9);
    expect(state.telegramToken).toBeUndefined();
    expect(mockLoadSecret).toHaveBeenCalledWith('telegram-token');
  });
});
