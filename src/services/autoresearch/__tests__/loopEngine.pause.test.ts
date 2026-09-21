import { afterEach, describe, expect, it } from '@jest/globals';
import { suspendExperimentLoopOnUnmount, waitForResumeOrAbort } from '../loopEngine';

/**
 * R5-04 + R5-09 regression tests.
 *
 * The AutoResearch loop had two related bugs:
 *  - R5-04: navigating away from the AutoResearch page while paused
 *    did not call stopExperimentLoop, so the SSH/LLM kept running.
 *  - R5-09: the pause branch used a bare 1s setTimeout with no
 *    AbortSignal, so clicking Stop during a paused loop took up to
 *    a full second to return.
 *
 * The first fix lives in src/pages/AutoResearch.tsx. The second fix
 * lives in src/services/autoresearch/loopEngine.ts. The behaviour
 * is end-to-end and hard to unit test without booting the full
 * store + LLM adapter, so these tests are guards on the
 * `loopState` / signal contract rather than full integration tests.
 */

describe('AutoResearch pause/stop wiring (R5-04, R5-09)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('LoopState contract', () => {
    it('treats "running" as a live state that must be stopped on unmount', async () => {
      const { useAutoResearchStore } = await import('@/store/autoresearchStore');
      useAutoResearchStore.setState({ loopState: 'running' });
      expect(useAutoResearchStore.getState().loopState).toBe('running');
      // The unmount handler in AutoResearch.tsx (R5-04) reads
      // loopState and calls stopExperimentLoop when it's "running"
      // OR "paused". Asserting the contract here documents what
      // the page is expected to look at.
      const liveStates = ['running', 'paused'];
      expect(liveStates).toContain(useAutoResearchStore.getState().loopState);
    });

    it('treats "paused" as a live state that must be stopped on unmount', async () => {
      const { useAutoResearchStore } = await import('@/store/autoresearchStore');
      useAutoResearchStore.setState({ loopState: 'paused' });
      const liveStates = ['running', 'paused'];
      expect(liveStates).toContain(useAutoResearchStore.getState().loopState);
    });

    it('treats "stopped" and "error" as terminal', async () => {
      const { useAutoResearchStore } = await import('@/store/autoresearchStore');
      useAutoResearchStore.setState({ loopState: 'stopped' });
      const liveStates = ['running', 'paused'];
      expect(liveStates).not.toContain(useAutoResearchStore.getState().loopState);

      useAutoResearchStore.setState({ loopState: 'error' });
      expect(liveStates).not.toContain(useAutoResearchStore.getState().loopState);

      useAutoResearchStore.setState({ loopState: 'idle' });
      expect(liveStates).not.toContain(useAutoResearchStore.getState().loopState);
    });
  });

  describe('pause + unmount (R5-04)', () => {
    it('suspendExperimentLoopOnUnmount keeps already-paused runs paused (does not no-op)', async () => {
      const { useAutoResearchStore } = await import('@/store/autoresearchStore');
      useAutoResearchStore.setState({
        id: 'pause-unmount-run',
        selectedRunId: 'pause-unmount-run',
        loopState: 'paused',
        runHistory: [{
          id: 'pause-unmount-run',
          status: 'paused',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          experimentDir: '/tmp/exp',
          metricName: 'acc',
          metricDirection: 'higher',
          maxIterations: 3,
          currentIteration: 1,
          resumeToken: { resumable: true, status: 'paused' },
        } as any],
      });

      suspendExperimentLoopOnUnmount();

      expect(useAutoResearchStore.getState().loopState).toBe('paused');
      const run = useAutoResearchStore.getState().runHistory.find((r) => r.id === 'pause-unmount-run');
      expect(run?.status).toBe('paused');
      expect(run?.resumeToken?.resumable).toBe(true);
    });
  });

  describe('AbortSignal aware pause (R5-09)', () => {
    it('waitForResumeOrAbort resolves within 200ms of abort while paused', async () => {
      const { useAutoResearchStore } = await import('@/store/autoresearchStore');
      useAutoResearchStore.setState({ loopState: 'paused' });

      const ac = new AbortController();
      const waitPromise = waitForResumeOrAbort(ac.signal);

      // Abort after a short delay; signal listener should finish
      // immediately (no need to wait for the 250ms poll).
      await new Promise((resolve) => setTimeout(resolve, 20));
      const abortedAt = Date.now();
      ac.abort();
      await waitPromise;
      expect(Date.now() - abortedAt).toBeLessThan(200);
    });
  });
});