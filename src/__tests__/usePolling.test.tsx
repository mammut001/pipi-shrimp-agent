/**
 * @jest-environment jsdom
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { usePolling } from '../hooks/usePolling';

type PollingProps = {
  callback: () => void | Promise<void>;
  intervalMs: number;
  enabled?: boolean;
};

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
let documentHidden = false;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(document, 'hidden', {
  get: () => documentHidden,
  configurable: true,
});

Object.defineProperty(document, 'visibilityState', {
  get: () => (documentHidden ? 'hidden' : 'visible'),
  configurable: true,
});

function PollingHarness(props: PollingProps) {
  usePolling(props.callback, props.intervalMs, props.enabled ?? true);
  return null;
}

function renderPollingHook(props: PollingProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(<PollingHarness {...props} />);
  });

  return {
    rerender(nextProps: PollingProps) {
      act(() => {
        root.render(<PollingHarness {...nextProps} />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      const mountedIndex = mountedRoots.findIndex((mounted) => mounted.root === root);
      if (mountedIndex >= 0) {
        mountedRoots.splice(mountedIndex, 1);
      }
      container.remove();
    },
  };
}

function setDocumentHidden(hidden: boolean) {
  documentHidden = hidden;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('usePolling', () => {
  beforeEach(() => {
    documentHidden = false;
    jest.useFakeTimers();
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not start polling when disabled', () => {
    const callback = jest.fn();

    renderPollingHook({ callback, intervalMs: 5000, enabled: false });
    act(() => {
      jest.advanceTimersByTime(15000);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('ticks immediately and then on the configured interval', () => {
    const callback = jest.fn();

    renderPollingHook({ callback, intervalMs: 5000, enabled: true });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('stops polling when enabled changes to false', () => {
    const callback = jest.fn();
    const view = renderPollingHook({ callback, intervalMs: 1000, enabled: true });

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(2);

    view.rerender({ callback, intervalMs: 1000, enabled: false });
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('cleans up the interval on unmount', () => {
    const callback = jest.fn();
    const view = renderPollingHook({ callback, intervalMs: 1000, enabled: true });

    view.unmount();
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('pauses while hidden and resumes with an immediate tick when visible', () => {
    const callback = jest.fn();

    renderPollingHook({ callback, intervalMs: 1000, enabled: true });
    expect(callback).toHaveBeenCalledTimes(1);

    setDocumentHidden(true);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    setDocumentHidden(false);
    expect(callback).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('uses the latest callback without rebuilding the polling lifecycle', () => {
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();
    const addListenerSpy = jest.spyOn(document, 'addEventListener');
    const removeListenerSpy = jest.spyOn(document, 'removeEventListener');
    const view = renderPollingHook({ callback: firstCallback, intervalMs: 1000, enabled: true });

    view.rerender({ callback: secondCallback, intervalMs: 1000, enabled: true });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(1);
    expect(addListenerSpy.mock.calls.filter(([eventName]) => eventName === 'visibilitychange')).toHaveLength(1);
    expect(removeListenerSpy.mock.calls.filter(([eventName]) => eventName === 'visibilitychange')).toHaveLength(0);
  });

  it('does not overlap async callback executions', async () => {
    let resolveFirstCall: (() => void) | undefined;
    const asyncCallback = jest.fn(() => new Promise<void>((resolve) => {
      resolveFirstCall = resolve;
    }));

    renderPollingHook({ callback: asyncCallback, intervalMs: 1000, enabled: true });
    expect(asyncCallback).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(asyncCallback).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstCall?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(asyncCallback).toHaveBeenCalledTimes(2);
  });
});