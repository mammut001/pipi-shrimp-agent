import { beforeEach, describe, expect, it } from '@jest/globals';
import { AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY } from '@/services/autoresearch/defaultConfig';
import {
  getSelectedAutoResearchRunContext,
  getSelectedAutoResearchRun,
  useAutoResearchStore,
} from '../autoresearchStore';

const storage = {
  data: {} as Record<string, string>,
  getItem(key: string) {
    return this.data[key] ?? null;
  },
  setItem(key: string, value: string) {
    this.data[key] = value;
  },
  removeItem(key: string) {
    delete this.data[key];
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

describe('autoresearchStore history behavior', () => {
  beforeEach(() => {
    const store = useAutoResearchStore.getState();
    store.resetSession();
    useAutoResearchStore.setState({ runHistory: [], selectedRunId: null, lastUsedConfig: null });
    storage.data = {};
  });

  it('creates a persistent run record when a session starts', () => {
    useAutoResearchStore.getState().initSession({
      id: 'run-1',
      maxIterations: 5,
      metricName: 'val_loss',
      metricDirection: 'lower',
      baseline: 0.75,
      sshConfig: {
        mode: 'local',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/workdir',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/experiment',
      sessionFilePath: '/tmp/workdir/session.md',
      livingDocPath: '/tmp/workdir/runs/run-1/autoresearch.md',
      agentConfigSnapshot: {
        configName: 'MiniMax',
        provider: 'minimax',
        apiFormat: 'openai',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
        keyPreview: 'secret...',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
    });

    const state = useAutoResearchStore.getState();
    expect(state.runHistory).toHaveLength(1);
    expect(state.runHistory[0]?.id).toBe('run-1');
    expect(state.runHistory[0]?.status).toBe('running');
    expect(state.runHistory[0]?.config.baseline).toBe(0.75);
    expect(state.runHistory[0]?.bestMetricValue).toBe(0.75);
    expect(state.runHistory[0]?.bestIteration).toBe(0);
    expect(state.selectedRunId).toBe('run-1');
  });

  it('appends a new run instead of overwriting history when another run starts', () => {
    const store = useAutoResearchStore.getState();
    const baseInput = {
      maxIterations: 5,
      metricName: 'val_loss',
      metricDirection: 'lower' as const,
      sshConfig: {
        mode: 'local' as const,
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/workdir',
        authMode: 'agent' as const,
        password: '',
      },
      experimentDir: '/tmp/experiment',
      agentConfigSnapshot: {
        configName: 'MiniMax',
        provider: 'minimax',
        apiFormat: 'openai',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
        keyPreview: 'secret...',
        keyPresent: true,
        source: 'settings.activeConfig' as const,
      },
    };

    store.initSession({ ...baseInput, id: 'run-a' });
    store.initSession({ ...baseInput, id: 'run-b', metricName: 'accuracy', metricDirection: 'higher' });

    const state = useAutoResearchStore.getState();
    expect(state.runHistory).toHaveLength(2);
    expect(state.runHistory.map((run) => run.id)).toContain('run-a');
    expect(state.runHistory.map((run) => run.id)).toContain('run-b');
    expect(state.selectedRunId).toBe('run-b');
  });

  it('keeps history after resetting the active session', () => {
    const store = useAutoResearchStore.getState();
    store.initSession({
      id: 'run-2',
      maxIterations: 3,
      metricName: 'accuracy',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: '',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/workdir',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/experiment',
      agentConfigSnapshot: {
        configName: 'MiniMax',
        provider: 'minimax',
        apiFormat: 'openai',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
        keyPreview: 'secret...',
        keyPresent: true,
        source: 'settings.activeConfig',
      },
    });
    store.addExperiment({
      iteration: 1,
      hypothesis: 'reduce lr',
      change: 'changed optimizer settings',
      metricValue: 0.91,
      status: 'IMPROVED',
      reasoning: 'better stability',
      timestamp: '2026-05-05T00:00:00.000Z',
      durationMs: 1000,
    });

    store.resetSession();

    const nextState = useAutoResearchStore.getState();
    expect(nextState.id).toBe('');
    expect(nextState.runHistory).toHaveLength(1);
    expect(getSelectedAutoResearchRun(nextState)?.id).toBe('run-2');
    expect(getSelectedAutoResearchRun(nextState)?.iterations[0]?.hypothesis).toBe('reduce lr');
  });

  it('persists the last used setup config and keeps it across session resets', () => {
    const store = useAutoResearchStore.getState();

    store.setLastUsedConfig({
      workdir: '~/autoresearch',
      experimentDir: '/tmp/experiment',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
    });

    expect(useAutoResearchStore.getState().lastUsedConfig).toEqual({
      workdir: '~/autoresearch',
      experimentDir: '/tmp/experiment',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
    });
    expect(localStorage.getItem(AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY)).toContain('"cv_accuracy"');

    store.resetSession();
    expect(useAutoResearchStore.getState().lastUsedConfig?.experimentDir).toBe('/tmp/experiment');

    store.clearLastUsedConfig();
    expect(useAutoResearchStore.getState().lastUsedConfig).toBeNull();
    expect(localStorage.getItem(AUTORESEARCH_LAST_USED_CONFIG_STORAGE_KEY)).toBeNull();
  });

  it('builds a single selected-run context for active and historical runs', () => {
    useAutoResearchStore.setState({
      id: 'run-active',
      loopState: 'running',
      liveOutput: 'live active output',
      errorMessage: 'active error',
      statusMessage: 'active status',
      reason: 'active reason',
      selectedExperiment: 0,
      runHistory: [
        {
          id: 'run-active',
          title: 'active',
          status: 'running',
          createdAt: '2026-05-05T00:00:00.000Z',
          updatedAt: '2026-05-05T00:00:01.000Z',
          config: {
            experimentDir: '/tmp/active-exp',
            workdir: '/tmp/active-work',
            metric: 'cv_accuracy',
            direction: 'higher',
            iterations: 5,
            configSnapshot: {
              configName: 'Primary',
              provider: 'openai',
              model: 'gpt-4.1',
              keyPresent: true,
              source: 'settings.activeConfig',
            },
          },
          currentIteration: 1,
          bestMetricValue: null,
          bestIteration: null,
          failureCount: 0,
          iterations: [{ id: 'run-active-iter-1', index: 1, status: 'running' }],
          events: [],
          liveOutputExcerpt: 'stale excerpt',
        },
        {
          id: 'run-old',
          title: 'history',
          status: 'completed',
          createdAt: '2026-05-04T00:00:00.000Z',
          updatedAt: '2026-05-04T00:00:01.000Z',
          config: {
            experimentDir: '/tmp/history-exp',
            workdir: '/tmp/history-work',
            metric: 'cv_accuracy',
            direction: 'higher',
            iterations: 5,
            configSnapshot: {
              configName: 'Primary',
              provider: 'openai',
              model: 'gpt-4.1',
              keyPresent: true,
              source: 'settings.activeConfig',
            },
          },
          currentIteration: 5,
          bestMetricValue: 0.97,
          bestIteration: 5,
          failureCount: 0,
          iterations: [{ id: 'run-old-iter-1', index: 1, status: 'completed' }],
          events: [],
          reason: 'historical reason',
          liveOutputExcerpt: 'historical excerpt',
        },
      ],
      selectedRunId: 'run-active',
    });

    const activeContext = getSelectedAutoResearchRunContext(useAutoResearchStore.getState());
    expect(activeContext.isActive).toBe(true);
    expect(activeContext.liveOutput).toBe('live active output');
    expect(activeContext.reason).toBe('active reason');
    expect(activeContext.statusMessage).toBe('active status');
    expect(activeContext.selectedIterationIndex).toBe(0);

    useAutoResearchStore.setState({ selectedRunId: 'run-old' });
    const historicalContext = getSelectedAutoResearchRunContext(useAutoResearchStore.getState());
    expect(historicalContext.isActive).toBe(false);
    expect(historicalContext.liveOutput).toBe('historical excerpt');
    expect(historicalContext.reason).toBe('historical reason');
    expect(historicalContext.statusMessage).toBeUndefined();
    expect(historicalContext.loopState).toBe('stopped');
  });
});
