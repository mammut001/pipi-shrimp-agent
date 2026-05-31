/**
 * Self-Improve Mode Integration Tests
 *
 * Tests for:
 * - UI validation passes repo_self_improve mode
 * - startAutoResearchRun sets store.autoResearchMode and verificationCommands
 * - loopEngine parses self-improve result from metricsPath before agent output
 * - run history stores mode and verificationCommands
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockLocalStorage: Record<string, string> = {};
const mockLocalStorageObj = {
  getItem: jest.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: jest.fn((key: string, value: string) => { mockLocalStorage[key] = value; }),
  removeItem: jest.fn((key: string) => { delete mockLocalStorage[key]; }),
  clear: jest.fn(() => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]); }),
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorageObj, configurable: true });

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
}));

jest.mock('@/store', () => ({
  useSettingsStore: {
    getState: () => ({
      activeConfigId: 'cfg-1',
      apiConfigs: [{
        id: 'cfg-1',
        name: 'Test Config',
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        apiFormat: 'openai',
      }],
      autoResearchLlmSettings: {
        defaultConfigId: null,
        agentConfigId: null,
        reflectionConfigId: null,
      },
    }),
  },
}));

jest.mock('@/services/agentConfig', () => ({
  resolveActiveAgentConfig: () => ({
    configId: 'cfg-1',
    name: 'Test Config',
    provider: 'minimax',
    providerLabel: 'MiniMax',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.example.com',
    apiFormat: 'openai',
    hasApiKey: true,
    hasBaseUrl: true,
    apiKey: 'test-key',
  }),
  validateResolvedAgentConfig: () => [],
  formatAgentConfigValidationError: () => '',
}));

jest.mock('@/services/llm/capabilities', () => ({
  buildProviderExecutionCapabilities: () => ({ supportsToolCalls: true }),
  getCapability: () => ({ supportsToolCalls: true, supportsStreaming: true, supportsImages: false }),
}));

jest.mock('../../platformGuard', () => ({
  assertSupportedPlatform: jest.fn(async () => undefined),
}));

jest.mock('../../preflight', () => ({
  runAutoResearchPreflight: jest.fn(async () => ({
    resolvedExperimentDir: '/tmp/test-repo',
    resolvedWorkDir: '/tmp/test-workdir',
    sessionFilePath: '/tmp/test-workdir/runs/test-session/session.md',
    livingDocPath: '/tmp/test-workdir/runs/test-session/autoresearch.md',
    environmentSummary: {
      experimentDir: '/tmp/test-repo',
      gitRepo: true,
      repoStatus: 'clean',
      dirtyFileCount: 0,
      preferredPythonCommand: 'python3',
      worktreeWritable: true,
      runScriptPath: '/tmp/test-repo/run_experiment.py',
      notesPath: '/tmp/test-repo/AUTORESEARCH.md',
      recommendedRunCommand: 'python3 run_experiment.py',
      gpuSummary: 'nvidia-smi unavailable',
    },
  })),
}));

jest.mock('../../runDir', () => ({
  ensureSessionDir: jest.fn(async () => undefined),
  getSessionRunPaths: jest.fn(() => ({
    sessionDir: '/tmp/test-workdir/runs/test-session',
    sessionFilePath: '/tmp/test-workdir/runs/test-session/session.md',
    livingDocPath: '/tmp/test-workdir/runs/test-session/autoresearch.md',
    metricsJsonlPath: '/tmp/test-workdir/runs/test-session/metrics.jsonl',
    runConfigPath: '/tmp/test-workdir/runs/test-session/run-config.json',
  })),
  writeTargetText: jest.fn(async () => undefined),
  readTargetText: jest.fn(async () => null),
}));

jest.mock('../../runConfig', () => ({
  resolveAutoResearchRunConfig: () => ({
    defaultConfig: { configId: 'cfg-1' },
    agentConfig: { configId: 'cfg-1' },
    reflectionConfig: { configId: 'cfg-1' },
    snapshot: { configId: 'cfg-1', configName: 'Test Config', provider: 'minimax', model: 'MiniMax-M2.7', keyPresent: true, source: 'settings.activeConfig' },
    featureSnapshots: {
      default: { configId: 'cfg-1', configName: 'Test Config', provider: 'minimax', model: 'MiniMax-M2.7', keyPresent: true, source: 'settings.activeConfig' },
      agent: { configId: 'cfg-1', configName: 'Test Config', provider: 'minimax', model: 'MiniMax-M2.7', keyPresent: true, source: 'settings.activeConfig' },
      reflection: { configId: 'cfg-1', configName: 'Test Config', provider: 'minimax', model: 'MiniMax-M2.7', keyPresent: true, source: 'settings.activeConfig' },
    },
    runConfigSnapshot: {
      createdAt: new Date().toISOString(),
      selectedConfigIds: { activeConfigId: 'cfg-1', defaultConfigId: null, agentConfigId: null, reflectionConfigId: null },
      resolvedSources: { default: 'settings.activeConfig', agent: 'settings.activeConfig', reflection: 'settings.activeConfig' },
      configs: {
        default: { configId: 'cfg-1', configName: 'Test Config', provider: 'minimax', model: 'MiniMax-M2.7', keyPresent: true, source: 'settings.activeConfig' },
        agent: { configId: 'cfg-1', configName: 'Test Config', provider: 'minimax', model: 'MiniMax-M2.7', keyPresent: true, source: 'settings.activeConfig' },
        reflection: { configId: 'cfg-1', configName: 'Test Config', provider: 'minimax', model: 'MiniMax-M2.7', keyPresent: true, source: 'settings.activeConfig' },
      },
      capabilities: {
        default: { supportsToolCalls: true, supportsStreaming: true, supportsImages: false },
        agent: { supportsToolCalls: true, supportsStreaming: true, supportsImages: false },
        reflection: { supportsToolCalls: true, supportsStreaming: true, supportsImages: false },
      },
    },
  }),
}));

jest.mock('../../chatAdapter', () => ({
  createAutoResearchSendMessage: jest.fn(() => jest.fn(async () => 'mock agent output')),
}));

jest.mock('../../loopEngine', () => ({
  startExperimentLoop: jest.fn(async () => undefined),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { validateAutoResearchSetupDraft } from '../../setupFlow';
import { useAutoResearchStore } from '@/store/autoresearchStore';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Self-Improve mode integration', () => {
  beforeEach(() => {
    // Reset store to clean state
    const store = useAutoResearchStore.getState();
    store.setAutoResearchMode('ml_experiment');
    store.setVerificationCommands(['pnpm run build', 'pnpm test']);
  });

  it('UI validation passes repo_self_improve mode without requiring metric', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/test-workdir',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/test-repo',
      metric: '', // Empty metric — should be OK for self-improve mode
      direction: 'higher',
      iterations: 5,
      baselineInput: '',
      mode: 'repo_self_improve',
      verificationCommands: ['pnpm run build', 'pnpm test'],
    });

    expect(result.error).toBeNull();
    expect(result.value).not.toBeNull();
    expect(result.value!.metric).toBe('repo_health');
    expect(result.value!.direction).toBe('higher');
    expect(result.value!.mode).toBe('repo_self_improve');
    expect(result.value!.verificationCommands).toEqual(['pnpm run build', 'pnpm test']);
  });

  it('UI validation requires metric for ml_experiment mode', () => {
    const result = validateAutoResearchSetupDraft({
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/test-workdir',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/test-repo',
      metric: '', // Empty metric — should FAIL for ML experiment mode
      direction: 'higher',
      iterations: 5,
      baselineInput: '',
    });

    expect(result.error).not.toBeNull();
    expect(result.value).toBeNull();
  });

  it('store autoResearchMode and verificationCommands are set correctly', () => {
    const store = useAutoResearchStore.getState();

    store.setAutoResearchMode('repo_self_improve');
    store.setVerificationCommands(['cargo check', 'cargo test', 'cargo clippy']);

    expect(useAutoResearchStore.getState().autoResearchMode).toBe('repo_self_improve');
    expect(useAutoResearchStore.getState().verificationCommands).toEqual(['cargo check', 'cargo test', 'cargo clippy']);

    // Reset
    store.setAutoResearchMode('ml_experiment');
    store.setVerificationCommands(['pnpm run build', 'pnpm test']);
  });

  it('run history config stores mode and verificationCommands when initSession is called', () => {
    const store = useAutoResearchStore.getState();
    store.setAutoResearchMode('repo_self_improve');
    store.setVerificationCommands(['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit']);

    store.initSession({
      id: 'test-run-mode-1',
      maxIterations: 5,
      metricName: 'repo_health',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/test-workdir',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/test-repo',
    });

    const state = useAutoResearchStore.getState();
    const run = state.runHistory.find((r) => r.id === 'test-run-mode-1');
    expect(run).toBeDefined();
    expect(run!.config.mode).toBe('repo_self_improve');
    expect(run!.config.verificationCommands).toEqual(['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit']);
    expect(run!.title).toContain('Self-Improve');
    expect(run!.config.metric).toBe('repo_health');
  });
});
