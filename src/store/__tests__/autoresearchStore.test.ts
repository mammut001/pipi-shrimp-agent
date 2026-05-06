import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  getSelectedAutoResearchRun,
  useAutoResearchStore,
} from '../autoresearchStore';

describe('autoresearchStore history behavior', () => {
  beforeEach(() => {
    const store = useAutoResearchStore.getState();
    store.resetSession();
    useAutoResearchStore.setState({ runHistory: [], selectedRunId: null });
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('pipi-shrimp-autoresearch-history-v1');
    }
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
});
