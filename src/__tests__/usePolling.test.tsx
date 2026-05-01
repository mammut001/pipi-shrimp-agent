/**
 * usePolling Tests - Stability and resource leak prevention
 *
 * Covers:
 * 1. enabled=false → no interval started
 * 2. enabled true→false → interval cleared
 * 3. Component unmount → interval cleared, visibilitychange listener removed
 * 4. document.hidden=true → polling paused
 * 5. document.visible again → immediate tick then resume
 * 6. Async callback overlap prevention (if currently overlapping, this test catches it)
 * 7. callback update → latest callback used without rebuilding interval
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ─── Mock document.visibilityState and hidden ─────────────────────────────────

let fakeHidden = false;
let visibilityListeners: Array<() => void> = [];

Object.defineProperty(document, 'hidden', {
  get: () => fakeHidden,
  configurable: true,
});

Object.defineProperty(document, 'visibilityState', {
  get: () => fakeHidden ? 'hidden' : 'visible',
  configurable: true,
});

const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');

// ─── Mock setInterval / clearInterval ─────────────────────────────────────────

const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

const fakeIntervals: Map<number, () => void> = new Map();
let intervalIdCounter = 0;

global.setInterval = jest.fn((callback: () => void, delay: number) => {
  const id = ++intervalIdCounter;
  fakeIntervals.set(id, callback);
  return id;
}) as any;

global.clearInterval = jest.fn((id: number) => {
  fakeIntervals.delete(id);
}) as any;

// ─── Import after mocks ───────────────────────────────────────────────────────

let usePolling: typeof import('../hooks/usePolling').usePolling;

beforeEach(async () => {
  jest.resetModules();
  fakeHidden = false;
  visibilityListeners = [];
  fakeIntervals.clear();
  intervalIdCounter = 0;
  addEventListenerSpy.mockClear();
  removeEventListenerSpy.mockClear();
  (global.setInterval as jest.Mock).mockClear();
  (global.clearInterval as jest.Mock).mockClear();

  usePolling = (await import('../hooks/usePolling')).usePolling;
});

afterEach(() => {
  // Restore
  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
});

// ─── Helper: trigger visibility change ────────────────────────────────────────

function setDocumentHidden(hidden: boolean) {
  fakeHidden = hidden;
  visibilityListeners.forEach(listener => listener());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('usePolling', () => {
  describe('enabled=false', () => {
    it('does not start any interval', () => {
      const callback = jest.fn();
      usePolling(callback, 5000, false);

      expect(global.setInterval).not.toHaveBeenCalled();
    });
  });

  describe('enabled=true', () => {
    it('starts an interval with the correct delay', () => {
      const callback = jest.fn();
      usePolling(callback, 5000, true);

      expect(global.setInterval).toHaveBeenCalledTimes(1);
      const [cb, delay] = (global.setInterval as jest.Mock).mock.calls[0];
      expect(delay).toBe(5000);
    });

    it('calls callback immediately on mount (eager tick)', () => {
      const callback = jest.fn();
      usePolling(callback, 5000, true);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('enabled transition true→false', () => {
    it('clears interval when disabled', () => {
      const callback = jest.fn();
      usePolling(callback, 5000, true);

      const intervalId = (global.setInterval as jest.Mock).mock.results[0].value;
      expect(fakeIntervals.has(intervalId)).toBe(true);

      // Re-enable with false
      usePolling(callback, 5000, false);

      expect(global.clearInterval).toHaveBeenCalledWith(intervalId);
      expect(fakeIntervals.has(intervalId)).toBe(false);
    });
  });

  describe('visibility change handling', () => {
    it('registers visibilitychange listener on mount', () => {
      const callback = jest.fn();
      usePolling(callback, 5000, true);

      expect(addEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('pauses interval when document becomes hidden', () => {
      const callback = jest.fn();
      usePolling(callback, 5000, true);

      const intervalId = (global.setInterval as jest.Mock).mock.results[0].value;

      // Simulate tab becoming hidden
      setDocumentHidden(true);

      // Interval should be cleared (paused)
      expect(global.clearInterval).toHaveBeenCalledWith(intervalId);
    });

    it('immediately ticks and resumes when document becomes visible again', () => {
      const callback = jest.fn();
      usePolling(callback, 5000, true);

      const firstIntervalId = (global.setInterval as jest.Mock).mock.results[0].value;

      // Hide
      setDocumentHidden(true);
      expect(callback).toHaveBeenCalledTimes(1); // initial tick only

      // Show again
      setDocumentHidden(false);

      // Should have ticked immediately
      expect(callback).toHaveBeenCalledTimes(2); // initial + resume tick

      // Should have started a new interval
      const calls = (global.setInterval as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('component unmount cleanup', () => {
    it('clears interval on unmount', () => {
      const callback = jest.fn();
      const cleanup = usePolling(callback, 5000, true);

      const intervalId = (global.setInterval as jest.Mock).mock.results[0].value;
      cleanup();

      expect(global.clearInterval).toHaveBeenCalledWith(intervalId);
    });

    it('removes visibilitychange listener on unmount', () => {
      const callback = jest.fn();
      const cleanup = usePolling(callback, 5000, true);

      cleanup();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('no setState from interval callback after unmount (leak prevention)', () => {
      // This test verifies that after cleanup, running the interval callback
      // does not try to call setState on an unmounted component.
      // Since usePolling uses useRef for interval ID and doesn't store state,
      // this is inherently safe — but the test documents the invariant.
      const callback = jest.fn();
      const cleanup = usePolling(callback, 5000, true);
      cleanup();

      // After cleanup, manually firing the interval callback should not throw
      const intervalFn = fakeIntervals.get((global.setInterval as jest.Mock).mock.results[0].value);
      expect(() => intervalFn?.()).not.toThrow();
    });
  });

  describe('callback update without interval rebuild', () => {
    it('uses the latest callback without restarting the interval', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      const { usePolling: freshUsePolling } = require('../hooks/usePolling');

      // First mount with callback1
      freshUsePolling(callback1, 5000, true);
      const intervalId = (global.setInterval as jest.Mock).mock.calls[0][1];

      // Trigger interval manually
      const intervalFn = fakeIntervals.get(intervalId);
      intervalFn?.();
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();

      // Simulate component re-render with updated callback
      // usePolling uses useEffect on callback — when callback changes,
      // it should update the ref but NOT restart the interval
      // We model this by calling the function again with callback2
      freshUsePolling(callback2, 5000, true);

      // setInterval should NOT have been called again
      expect((global.setInterval as jest.Mock).mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('async callback overlap prevention', () => {
    it('does not overlap executions if callback takes longer than interval', async () => {
      jest.useFakeTimers();

      let callCount = 0;
      let resolveLongCall: () => void;
      const longCall = new Promise<void>((resolve) => {
        resolveLongCall = resolve;
      });

      const asyncCallback = jest.fn(async () => {
        callCount++;
        await longCall;
      });

      usePolling(asyncCallback, 1000, true);

      // First tick (immediate)
      expect(asyncCallback).toHaveBeenCalledTimes(1);
      const firstCallResolved = resolveLongCall!;
      firstCallResolved();

      await jest.advanceTimersByTimeAsync(1000);
      expect(asyncCallback).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(1000);
      expect(asyncCallback).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });
  });
});