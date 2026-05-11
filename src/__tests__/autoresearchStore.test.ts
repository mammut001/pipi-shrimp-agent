import { beforeEach, describe, expect, it } from '@jest/globals';

import { useAutoResearchStore } from '@/store/autoresearchStore';

describe('autoresearchStore snapshots', () => {
  beforeEach(() => {
    useAutoResearchStore.setState({
      id: '',
      loopState: 'idle',
      currentIteration: 0,
      maxIterations: 50,
      bestMetric: null,
      metricDirection: 'lower',
      metricName: 'metric',
      consecutiveFailures: 0,
      experimentDir: '',
      sessionFilePath: '',
      livingDocPath: '',
      startedAt: '',
      experiments: [],
      sshConfig: null,
      agentConfigSnapshot: undefined,
      telegramConfig: {
        enabled: false,
        chatId: null,
        notifyOnImproved: true,
        notifyOnFailed: true,
        trendReportInterval: 10,
      },
      liveOutput: '',
      selectedExperiment: -1,
      terminalVisible: false,
      terminalReady: false,
      terminalSessionId: null,
      terminalCwd: '',
      errorMessage: undefined,
      statusMessage: undefined,
      runHistory: [],
      selectedRunId: null,
      lastUsedConfig: null,
      showSetupModal: false,
    });
  });

  it('keeps each run pinned to the snapshot captured at initSession time', () => {
    const store = useAutoResearchStore.getState();

    store.initSession({
      id: 'run-1',
      maxIterations: 3,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/one',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/one',
      agentConfigSnapshot: {
        configId: 'cfg-1',
        configName: 'Config One',
        provider: 'openai',
        providerLabel: 'OpenAI',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        keyPreview: 'sk-one',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
    });

    store.resetSession();

    store.initSession({
      id: 'run-2',
      maxIterations: 3,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/two',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/two',
      agentConfigSnapshot: {
        configId: 'cfg-2',
        configName: 'Config Two',
        provider: 'anthropic',
        providerLabel: 'Anthropic',
        apiFormat: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-5',
        keyPreview: 'sk-two',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
    });

    const state = useAutoResearchStore.getState();
    const firstRun = state.runHistory.find((run) => run.id === 'run-1');
    const secondRun = state.runHistory.find((run) => run.id === 'run-2');

    expect(firstRun?.config.configSnapshot.configName).toBe('Config One');
    expect(firstRun?.config.configSnapshot.model).toBe('gpt-4.1');
    expect(secondRun?.config.configSnapshot.configName).toBe('Config Two');
    expect(secondRun?.config.configSnapshot.model).toBe('claude-sonnet-4-5');
  });
});