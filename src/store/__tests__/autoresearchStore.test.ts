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

    expect(useAutoResearchStore.getState().lastUsedConfig).toEqual(expect.objectContaining({
      workdir: '~/autoresearch',
      experimentDir: '/tmp/experiment',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
    }));
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

  it('creates and reapplies a resume token when an interrupted run is reactivated', () => {
    const store = useAutoResearchStore.getState();

    store.initSession({
      id: 'run-resume',
      maxIterations: 4,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/resume-work',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/resume-exp',
      sessionFilePath: '/tmp/resume-work/session.md',
      livingDocPath: '/tmp/resume-work/runs/run-resume/autoresearch.md',
      baseline: 0.91,
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

    const initialRun = useAutoResearchStore.getState().runHistory.find((run) => run.id === 'run-resume');
    expect(initialRun?.resumeToken?.pendingIteration).toBe(1);
    expect(initialRun?.resumeToken?.resumable).toBe(true);

    useAutoResearchStore.setState((state) => ({
      id: '',
      loopState: 'idle',
      runHistory: state.runHistory.map((run) => (
        run.id === 'run-resume'
          ? {
            ...run,
            status: 'interrupted',
            resumeToken: run.resumeToken
              ? {
                ...run.resumeToken,
                status: 'interrupted',
                currentIteration: 1,
                pendingIteration: 2,
                replayIteration: true,
              }
              : run.resumeToken,
          }
          : run
      )),
    }));

    useAutoResearchStore.getState().activateHistoricalRun({
      runId: 'run-resume',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/resume-work',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/resume-exp',
      sessionFilePath: '/tmp/resume-work/session.md',
      livingDocPath: '/tmp/resume-work/runs/run-resume/autoresearch.md',
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      maxIterations: 4,
      baseline: 0.91,
      pendingIteration: 2,
      resumeToken: initialRun?.resumeToken
        ? {
          ...initialRun.resumeToken,
          status: 'interrupted',
          currentIteration: 1,
          pendingIteration: 2,
          replayIteration: true,
        }
        : undefined,
      experiments: [],
      liveOutput: 'restored live output',
    });

    const resumedState = useAutoResearchStore.getState();
    const resumedRun = resumedState.runHistory.find((run) => run.id === 'run-resume');
    expect(resumedState.id).toBe('run-resume');
    expect(resumedState.currentIteration).toBe(1);
    expect(resumedState.loopState).toBe('running');
    expect(resumedRun?.status).toBe('running');
    expect(resumedRun?.resumeToken?.pendingIteration).toBe(2);
    expect(resumedRun?.events.at(-1)?.message).toContain('resumed from recovery token');
  });

  it('stores mode=repo_self_improve on the run record when passed to initSession', () => {
    useAutoResearchStore.getState().initSession({
      id: 'run-self-improve',
      maxIterations: 3,
      metricName: 'repo_health',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/repo',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/repo',
      mode: 'repo_self_improve',
      verificationCommands: ['pnpm run build', 'pnpm test'],
    });

    const state = useAutoResearchStore.getState();
    expect(state.autoResearchMode).toBe('repo_self_improve');
    expect(state.verificationCommands).toEqual(['pnpm run build', 'pnpm test']);

    const run = state.runHistory.find((r) => r.id === 'run-self-improve');
    expect(run?.config.mode).toBe('repo_self_improve');
    expect(run?.config.verificationCommands).toEqual(['pnpm run build', 'pnpm test']);
    expect(run?.title).toContain('Self-Improve');
  });

  it('defaults mode to ml_experiment when not passed to initSession', () => {
    useAutoResearchStore.getState().initSession({
      id: 'run-ml',
      maxIterations: 3,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/ml',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/ml',
    });

    const state = useAutoResearchStore.getState();
    expect(state.autoResearchMode).toBe('ml_experiment');

    const run = state.runHistory.find((r) => r.id === 'run-ml');
    expect(run?.config.mode).toBe('ml_experiment');
    expect(run?.title).toContain('cv_accuracy');
  });

  it('preserves mode and verificationCommands in run history across resets', () => {
    const store = useAutoResearchStore.getState();

    store.initSession({
      id: 'run-persist',
      maxIterations: 2,
      metricName: 'repo_health',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/persist',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/persist',
      mode: 'repo_self_improve',
      verificationCommands: ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
    });

    store.resetSession();

    const state = useAutoResearchStore.getState();
    expect(state.id).toBe('');
    expect(state.runHistory).toHaveLength(1);

    const persistedRun = state.runHistory.find((r) => r.id === 'run-persist');
    expect(persistedRun?.config.mode).toBe('repo_self_improve');
    expect(persistedRun?.config.verificationCommands).toEqual([
      'pnpm run build',
      'pnpm test',
      'node_modules/.bin/tsc --noEmit',
    ]);
  });

  it('sets autoResearchMode and verificationCommands on the store state from initSession', () => {
    const store = useAutoResearchStore.getState();

    // First set a different mode to confirm it gets overwritten
    useAutoResearchStore.setState({
      autoResearchMode: 'ml_experiment',
      verificationCommands: ['old-command'],
    });

    store.initSession({
      id: 'run-mode-set',
      maxIterations: 3,
      metricName: 'repo_health',
      metricDirection: 'higher',
      sshConfig: {
        mode: 'local',
        host: '',
        user: 'root',
        keyPath: '',
        port: 22,
        remoteWorkDir: '/tmp/mode-set',
        authMode: 'agent',
        password: '',
      },
      experimentDir: '/tmp/mode-set',
      mode: 'repo_self_improve',
      verificationCommands: ['pnpm run build'],
    });

    const state = useAutoResearchStore.getState();
    expect(state.autoResearchMode).toBe('repo_self_improve');
    expect(state.verificationCommands).toEqual(['pnpm run build']);
  });
});
