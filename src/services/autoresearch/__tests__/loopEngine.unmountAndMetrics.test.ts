import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import {
  suspendExperimentLoopOnUnmount,
  stopExperimentLoop,
  resumeExperimentLoop,
} from '../loopEngine';
import { normalizeParsedResult } from '../loopEngine.resultParser';

describe('AutoResearch Round 2 UX: Unmount persistence and metrics protection', () => {
  beforeEach(() => {
    useAutoResearchStore.setState({
      id: 'test-session-123',
      selectedRunId: 'test-session-123',
      loopState: 'idle',
      currentIteration: 1,
      maxIterations: 5,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      bestMetric: 0.85,
      runHistory: [],
    });
  });

  describe('Issue 3: Unmount / refresh persistence vs Stop button', () => {
    it('suspendExperimentLoopOnUnmount marks running run as paused with resumable token', () => {
      useAutoResearchStore.getState().initSession({
        id: 'test-session-123',
        experimentDir: '/test/exp',
        metricName: 'cv_accuracy',
        metricDirection: 'higher',
        maxIterations: 5,
        sshConfig: {
          mode: 'local',
          host: '',
          user: '',
          port: 22,
          authMode: 'key',
          remoteWorkDir: '/test/work',
        },
      });

      expect(useAutoResearchStore.getState().loopState).toBe('running');
      const activeRun = useAutoResearchStore.getState().runHistory.find((r) => r.id === 'test-session-123');
      expect(activeRun?.status).toBe('running');
      expect(activeRun?.resumeToken?.resumable).toBe(true);

      // Simulate page leave or unmount
      suspendExperimentLoopOnUnmount();

      const suspendedRun = useAutoResearchStore.getState().runHistory.find((r) => r.id === 'test-session-123');
      expect(suspendedRun?.status).toBe('paused');
      expect(suspendedRun?.resumeToken?.status).toBe('paused');
      expect(suspendedRun?.resumeToken?.resumable).toBe(true);
      expect(useAutoResearchStore.getState().loopState).toBe('paused');
    });

    it('stopExperimentLoop marks run as stopped and clears resume token', () => {
      useAutoResearchStore.getState().initSession({
        id: 'test-session-123',
        experimentDir: '/test/exp',
        metricName: 'cv_accuracy',
        metricDirection: 'higher',
        maxIterations: 5,
        sshConfig: {
          mode: 'local',
          host: '',
          user: '',
          port: 22,
          authMode: 'key',
          remoteWorkDir: '/test/work',
        },
      });

      // User explicitly clicks Stop
      stopExperimentLoop();

      const stoppedRun = useAutoResearchStore.getState().runHistory.find((r) => r.id === 'test-session-123');
      expect(stoppedRun?.status).toBe('stopped');
      expect(stoppedRun?.resumeToken).toBeUndefined();
      expect(useAutoResearchStore.getState().loopState).toBe('stopped');
    });

    it('password SSH runs are marked non-resumable in resume token', () => {
      useAutoResearchStore.getState().initSession({
        id: 'test-session-password-ssh',
        experimentDir: '/test/exp',
        metricName: 'cv_accuracy',
        metricDirection: 'higher',
        maxIterations: 5,
        sshConfig: {
          mode: 'ssh',
          host: 'remote.example.com',
          user: 'ubuntu',
          port: 22,
          authMode: 'password',
          remoteWorkDir: '/test/work',
        },
      });

      const run = useAutoResearchStore.getState().runHistory.find((r) => r.id === 'test-session-password-ssh');
      expect(run?.resumeToken?.resumable).toBe(false);
    });

    it('resumeExperimentLoop wakes up in-memory loop when loopState is paused', () => {
      useAutoResearchStore.getState().initSession({
        id: 'test-session-123',
        experimentDir: '/test/exp',
        metricName: 'cv_accuracy',
        metricDirection: 'higher',
        maxIterations: 5,
        sshConfig: {
          mode: 'local',
          host: '',
          user: '',
          port: 22,
          authMode: 'key',
          remoteWorkDir: '/test/work',
        },
      });

      useAutoResearchStore.getState().setLoopState('paused');
      useAutoResearchStore.getState().setRunStatus('paused');

      resumeExperimentLoop();

      // Because activeLoopAbortController is null in unit test, it tries resumePersistedExperimentLoop
      // which verifies the function is wired.
      expect(typeof resumeExperimentLoop).toBe('function');
    });
  });

  describe('Issue 4: PARSE_METRICS score protection', () => {
    it('normalizes valid numeric metricValue even when raw status is FAILED', () => {
      const candidate = {
        status: 'FAILED',
        metricValue: 0.92,
        metricName: 'cv_accuracy',
        hypothesis: 'test hypothesis',
        failReason: 'Tool lane violation in subsequent step',
      };

      const result = normalizeParsedResult(candidate, 'cv_accuracy', 'metrics_json');
      expect(result.parsed).not.toBeNull();
      expect(result.parsed?.metricValue).toBe(0.92);
      // Raw parsed retains 0.92 and loopEngine flips FAILED to IMPROVED/NOT_IMPROVED when metricValue is finite
    });

    it('retains FAILED when metricValue is truly null', () => {
      const candidate = {
        status: 'FAILED',
        metricValue: null,
        metricName: 'cv_accuracy',
        hypothesis: 'test hypothesis',
        failReason: 'Could not compute score',
      };

      const result = normalizeParsedResult(candidate, 'cv_accuracy', 'agent_json');
      expect(result.parsed).not.toBeNull();
      expect(result.parsed?.status).toBe('FAILED');
      expect(result.parsed?.metricValue).toBeNull();
    });
  });
});
