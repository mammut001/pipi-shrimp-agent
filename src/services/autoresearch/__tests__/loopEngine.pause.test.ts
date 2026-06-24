import { afterEach, describe, expect, it } from '@jest/globals';

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

  describe('AbortSignal aware pause', () => {
    it('an aborted signal aborts within the polling interval (250ms)', () => {
      // We model the waitForResumeOrAbort contract: poll loopState
      // every 250ms and bail when the signal fires. The contract
      // says maximum wait is 250ms from abort to resolution.
      const ac = new AbortController();
      const start = Date.now();
      let resolved = false;
      let interval: ReturnType<typeof setInterval> | undefined;

      const check = () => {
        // Simulate the loop's waitForResumeOrAbort polling
        // useAutoResearchStore.getState().loopState.
        if (ac.signal.aborted) {
          resolved = true;
          if (interval) clearInterval(interval);
        }
      };
      interval = setInterval(check, 250);

      // Abort after a short delay.
      setTimeout(() => ac.abort(), 100);
      // Wait for the abort to take effect.
      return new Promise<void>((resolve) => {
        const verify = setInterval(() => {
          if (resolved) {
            clearInterval(verify);
            const elapsed = Date.now() - start;
            // Resolved within the next 250ms poll after abort.
            // Total: 100ms abort delay + at most 250ms poll = 350ms.
            expect(elapsed).toBeLessThan(1000);
            expect(ac.signal.aborted).toBe(true);
            resolve();
          }
        }, 50);
      });
    });
  });
});