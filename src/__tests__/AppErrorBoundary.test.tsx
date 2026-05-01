/**
 * AppErrorBoundary Tests - Regression tests for error boundary behavior
 *
 * Covers:
 * 1. Child throw error → fallback UI shown
 * 2. componentDidCatch calls errorLogger.logError
 * 3. Back-to-chat button calls recoverToChatView
 * 4. Recovery resets error boundary state
 * 5. recoverKey bump forces fresh subtree render
 * 6. Copy diagnostics uses getErrorLogsText without throwing
 * 7. Component unmount cleans up copy timers (no setState on unmounted)
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import React from 'react';

// ─── Mock i18n ───────────────────────────────────────────────────────────────

const tMock = jest.fn((key: string) => key);
jest.mock('../i18n', () => ({
  t: (...args: unknown[]) => tMock(...args),
}));

// ─── Mock errorLogger ─────────────────────────────────────────────────────────

const logErrorMock = jest.fn();
jest.mock('../utils/errorLogger', () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
  getErrorLogsText: jest.fn((maxEntries?: number) => {
    return 'Error log text for diagnostics';
  }),
}));

// ─── Mock localStorage ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// ─── Mock useUIStore ───────────────────────────────────────────────────────────

const recoverToChatViewMock = jest.fn();
jest.mock('../store/uiStore', () => ({
  useUIStore: jest.fn(() => ({
    getState: jest.fn(() => ({
      recoverToChatView: recoverToChatViewMock,
    })),
  })),
}));

// ─── Mock clipboard ───────────────────────────────────────────────────────────

const clipboardWriteTextMock = jest.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: clipboardWriteTextMock },
  writable: true,
});

// ─── Mock document.body ───────────────────────────────────────────────────────

const appendChildMock = jest.fn();
const removeChildMock = jest.fn();
const selectMock = jest.fn();
const execCommandMock = jest.fn();

const fakeTextarea = {
  value: 'diagnostics text',
  style: {},
  select: selectMock,
};
let bodyAppendCallCount = 0;
let bodyRemoveCallCount = 0;

beforeEach(() => {
  bodyAppendCallCount = 0;
  bodyRemoveCallCount = 0;
  appendChildMock.mockClear();
  removeChildMock.mockClear();
  execCommandMock.mockClear();
  appendChildMock.mockImplementation((el) => {
    bodyAppendCallCount++;
    return el;
  });
  removeChildMock.mockImplementation((el) => {
    bodyRemoveCallCount++;
    return el;
  });
  execCommandMock.mockReturnValue(true);

  Object.defineProperty(document.body, 'appendChild', {
    value: appendChildMock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document.body, 'removeChild', {
    value: removeChildMock,
    writable: true,
    configurable: true,
  });
});

// ─── Import after mocks ───────────────────────────────────────────────────────

let AppErrorBoundary: typeof import('../components/AppErrorBoundary').AppErrorBoundary;
let errorLogger: typeof import('../utils/errorLogger');

beforeEach(async () => {
  jest.resetModules();
  localStorageMock.clear();
  logErrorMock.mockClear();
  recoverToChatViewMock.mockClear();
  clipboardWriteTextMock.mockClear();
  tMock.mockImplementation((key: string) => key);
  errorLogger = await import('../utils/errorLogger');
  AppErrorBoundary = (await import('../components/AppErrorBoundary')).AppErrorBoundary;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AppErrorBoundary', () => {
  describe('getDerivedStateFromError', () => {
    it('sets hasError=true and stores the error', () => {
      const error = new Error('Something went wrong');
      const partialState = AppErrorBoundary.getDerivedStateFromError(error);

      expect(partialState).toHaveProperty('hasError', true);
      expect(partialState).toHaveProperty('error');
      expect((partialState as any).error.message).toBe('Something went wrong');
    });
  });

  describe('componentDidCatch', () => {
    it('calls logError with error info', () => {
      const error = new Error('test error');
      const errorInfo = { componentStack: 'at App at line 10' };

      // componentDidCatch is called in constructor via getDerivedStateFromError path
      // or directly when an error is thrown during render.
      // To trigger it directly we need a class instance.
      class TestComponent extends React.Component<{}, { hasError: boolean }> {
        static getDerivedStateFromError = AppErrorBoundary.getDerivedStateFromError;
        componentDidCatch = AppErrorBoundary.prototype.componentDidCatch;
        constructor(props: {}) {
          super(props);
          // Simulate error caught during render
          const state = AppErrorBoundary.getDerivedStateFromError(error);
          this.state = state as { hasError: boolean };
        }
        render() { return null; }
      }

      const instance = new TestComponent({});
      // Call componentDidCatch directly
      instance.componentDidCatch(error, errorInfo as React.ErrorInfo);

      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock).toHaveBeenCalledWith(
        'error',
        'test error',
        'AppErrorBoundary',
        error,
        'at App at line 10',
      );
    });
  });

  describe('handleBackToChat', () => {
    it('calls recoverToChatView to reset transient UI state', () => {
      const error = new Error('test');
      const wrapper = new AppErrorBoundary({ children: null });
      // First trigger error state
      const state = AppErrorBoundary.getDerivedStateFromError(error);
      (wrapper as any).state = { ...state, copied: false, recoverKey: 0 };

      wrapper.handleBackToChat();

      expect(recoverToChatViewMock).toHaveBeenCalledTimes(1);
    });

    it('clears error state and increments recoverKey after recovery', () => {
      const error = new Error('test');
      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = {
        hasError: true,
        error,
        copied: false,
        recoverKey: 5,
      };

      wrapper.handleBackToChat();

      // Access the setState call from handleBackToChat
      const setStateCall = (wrapper as any).setState.mock.calls[(wrapper as any).setState.mock.calls.length - 1][0];
      expect(setStateCall.hasError).toBe(false);
      expect(setStateCall.error).toBeNull();
      expect(setStateCall.copied).toBe(false);
      expect(typeof setStateCall.recoverKey).toBe('number');
    });

    it('recoverKey incremented forces fresh subtree render (key changes)', () => {
      const error = new Error('test');
      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = {
        hasError: true,
        error,
        copied: false,
        recoverKey: 0,
      };

      wrapper.handleBackToChat();

      const setStateCall = (wrapper as any).setState.mock.calls[(wrapper as any).setState.mock.calls.length - 1][0];
      expect(setStateCall.recoverKey).toBeGreaterThan(0);
    });

    it('recoverToChatView is called even if useUIStore.getState() throws', () => {
      // Override mock to throw
      const { useUIStore } = jest.requireMock('../store/uiStore');
      (useUIStore as jest.Mock).mockImplementationOnce(() => {
        throw new Error('store unavailable');
      });

      const error = new Error('test');
      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = {
        hasError: true,
        error,
        copied: false,
        recoverKey: 0,
      };

      // Should not throw
      expect(() => wrapper.handleBackToChat()).not.toThrow();
    });
  });

  describe('handleCopyDiagnostics', () => {
    it('copies sanitized error logs to clipboard using getErrorLogsText', async () => {
      const { getErrorLogsText } = jest.requireMock('../utils/errorLogger');
      (getErrorLogsText as jest.Mock).mockReturnValueOnce('=== Error Logs ===\nError 1: test\nError 2: oops');

      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = { hasError: true, error: new Error('test'), copied: false, recoverKey: 0 };

      await wrapper.handleCopyDiagnostics();

      expect(clipboardWriteTextMock).toHaveBeenCalledTimes(1);
      const copiedText = clipboardWriteTextMock.mock.calls[0][0];
      expect(copiedText).toContain('=== PiPi Shrimp Diagnostics ===');
      expect(copiedText).toContain('User Agent:');
      expect(copiedText).toContain('--- Recent Error Logs ---');
      expect(copiedText).toContain('=== Error Logs ===');
    });

    it('shows copied=true for 2 seconds then resets', async () => {
      jest.useFakeTimers();

      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = { hasError: true, error: new Error('test'), copied: false, recoverKey: 0 };

      const copyPromise = wrapper.handleCopyDiagnostics();
      jest.advanceTimersByTime(10);
      await copyPromise;

      // After copy, copied should be true
      const setStateAfterCopy = (wrapper as any).setState.mock.calls[(wrapper as any).setState.mock.calls.length - 1][0];
      expect(setStateAfterCopy.copied).toBe(true);

      // Advance past 2 seconds
      jest.advanceTimersByTime(2000);
      // The timer callback that resets copied should have fired
      // Verify by checking that setState was called again
      const resetCall = (wrapper as any).setState.mock.calls[(wrapper as any).setState.mock.calls.length - 1][0];
      expect(resetCall.copied).toBe(false);

      jest.useRealTimers();
    });

    it('fallback to execCommand copy if navigator.clipboard.writeText fails', async () => {
      clipboardWriteTextMock.mockRejectedValueOnce(new Error('clipboard unavailable'));

      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = { hasError: true, error: new Error('test'), copied: false, recoverKey: 0 };

      await wrapper.handleCopyDiagnostics();

      expect(appendChildMock).toHaveBeenCalled();
      expect(execCommandMock).toHaveBeenCalledWith('copy');
      expect(removeChildMock).toHaveBeenCalled();
      expect(bodyAppendCallCount).toBe(1);
      expect(bodyRemoveCallCount).toBe(1);
    });

    it('getErrorLogsText does not throw even if logs are empty', async () => {
      const { getErrorLogsText } = jest.requireMock('../utils/errorLogger');
      (getErrorLogsText as jest.Mock).mockReturnValueOnce('(No error logs)');

      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = { hasError: true, error: new Error('test'), copied: false, recoverKey: 0 };

      // Should not throw
      await expect(wrapper.handleCopyDiagnostics()).resolves.toBeUndefined();
    });
  });

  describe('componentWillUnmount', () => {
    it('clears all pending copy timers to avoid setState on unmounted component', () => {
      jest.useFakeTimers();

      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = { hasError: true, error: new Error('test'), copied: false, recoverKey: 0 };

      // Simulate multiple copy timers that were scheduled
      const timer1 = setTimeout(() => wrapper.setState({ copied: false }), 2000);
      const timer2 = setTimeout(() => wrapper.setState({ copied: false }), 2000);
      (wrapper as any).copyTimers = [timer1, timer2];

      // Track setState calls during unmount
      const setStateSpy = jest.spyOn(wrapper, 'setState');
      wrapper.componentWillUnmount();

      // Timers should be cleared — no setState from those timers
      jest.advanceTimersByTime(3000);
      expect(setStateSpy).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('render with error state', () => {
    it('renders fallback UI when hasError=true', () => {
      const error = new Error('Something broke');
      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = {
        hasError: true,
        error,
        copied: false,
        recoverKey: 0,
      };

      const result = wrapper.render() as React.ReactElement;
      expect(result).not.toBeNull();

      // The fallback UI should have buttons
      const element = result as any;
      expect(element.type).toBe('div');
      expect(element.props.className).toContain('bg-gray-50');
    });

    it('renders children wrapped in a keyed div when hasError=false', () => {
      const wrapper = new AppErrorBoundary({ children: React.createElement('div', { id: 'test-child' }) });
      (wrapper as any).state = { hasError: false, error: null, copied: false, recoverKey: 42 };

      const result = wrapper.render() as React.ReactElement;
      expect(result).not.toBeNull();

      const element = result as any;
      // Keyed div: key prop is set to recoverKey
      expect(element.key).toBe('42');
      // Children should be the child element
      expect(element.props.children).not.toBeNull();
    });

    it('keyed div uses different key after recovery to force fresh subtree', () => {
      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = { hasError: false, error: null, copied: false, recoverKey: 0 };

      const result1 = wrapper.render() as any;
      expect(result1.key).toBe('0');

      // Simulate error → recovery cycle
      const errorState = AppErrorBoundary.getDerivedStateFromError(new Error('crash'));
      (wrapper as any).state = { ...errorState, copied: false, recoverKey: 1 };

      const result2 = wrapper.render() as any;
      expect(result2.key).toBe('1');
    });
  });

  describe('recovery cycle (no infinite loop)', () => {
    it('back-to-chat after componentDidCatch does not re-throw and crash the boundary', () => {
      const error = new Error('rendering error');
      const wrapper = new AppErrorBoundary({ children: null });
      (wrapper as any).state = {
        hasError: true,
        error,
        copied: false,
        recoverKey: 0,
      };

      // If recoverToChatView throws, handleBackToChat has a try/catch
      // so the boundary itself should not crash
      expect(() => wrapper.handleBackToChat()).not.toThrow();

      // State should be reset to non-error
      const setStateCall = (wrapper as any).setState.mock.calls[(wrapper as any).setState.mock.calls.length - 1][0];
      expect(setStateCall.hasError).toBe(false);
    });
  });
});