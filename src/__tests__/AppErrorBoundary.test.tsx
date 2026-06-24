/**
 * @jest-environment jsdom
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const mockLogError = jest.fn();
const mockGetErrorLogsText = jest.fn(() => 'recent sanitized logs');
const mockRecoverToChatView = jest.fn();
const mockClipboardWriteText = jest.fn<() => Promise<void>>(() => Promise.resolve());
const existingExecCommand = document.execCommand ?? (() => false);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../utils/errorLogger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
  getErrorLogsText: (...args: unknown[]) => mockGetErrorLogsText(...args),
}));

const mockUseUIStore = Object.assign(jest.fn(), {
  getState: () => ({ recoverToChatView: mockRecoverToChatView }),
});

jest.mock('../store/uiStore', () => ({
  useUIStore: mockUseUIStore,
}));

import { AppErrorBoundary } from '../components/AppErrorBoundary';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function MaybeCrash({ shouldThrow }: { shouldThrow: () => boolean }) {
  if (shouldThrow()) {
    throw new Error('render boom');
  }

  return <div>healthy child</div>;
}

function renderBoundary(shouldThrow: () => boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(
      <AppErrorBoundary>
        <MaybeCrash shouldThrow={shouldThrow} />
      </AppErrorBoundary>,
    );
  });

  return {
    container,
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

function getButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    });
    Object.defineProperty(document, 'execCommand', {
      value: existingExecCommand,
      configurable: true,
    });
    mockLogError.mockClear();
    mockGetErrorLogsText.mockClear();
    mockRecoverToChatView.mockClear();
    mockClipboardWriteText.mockClear();
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
    try {
      jest.runOnlyPendingTimers();
    } catch {
      // Some tests use real timers; there may be nothing to flush.
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders fallback UI and logs context when a child throws', () => {
    const view = renderBoundary(() => true);

    expect(view.container.textContent).toContain('errorBoundary.title');
    expect(view.container.textContent).toContain('errorBoundary.description');
    expect(view.container.textContent).toContain('render boom');
    expect(mockLogError).toHaveBeenCalledWith(
      'error',
      'render boom',
      'AppErrorBoundary',
      expect.any(Error),
      expect.any(String),
    );
  });

  it('recovers to a fresh child tree when Back to Chat is clicked', () => {
    let shouldThrow = true;
    const view = renderBoundary(() => shouldThrow);
    expect(view.container.textContent).toContain('errorBoundary.title');

    shouldThrow = false;
    act(() => {
      getButton(view.container, 'errorBoundary.tryBackToChat').click();
    });

    expect(mockRecoverToChatView).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('healthy child');
    expect(view.container.textContent).not.toContain('errorBoundary.title');
  });

  it('copies diagnostics through the clipboard without exposing implementation internals', async () => {
    const view = renderBoundary(() => true);

    await act(async () => {
      getButton(view.container, 'errorBoundary.copyDiagnostics').click();
      await Promise.resolve();
    });

    expect(mockGetErrorLogsText).toHaveBeenCalledWith(30);
    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    const copiedText = mockClipboardWriteText.mock.calls[0][0] as string;
    expect(copiedText).toContain('PiPi Shrimp Diagnostics');
    expect(copiedText).toContain('recent sanitized logs');
  });

  it('falls back to execCommand copy when clipboard write fails', async () => {
    const execCommandImpl = jest.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      value: execCommandImpl,
      configurable: true,
      writable: true,
    });
    mockClipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const view = renderBoundary(() => true);

    await act(async () => {
      getButton(view.container, 'errorBoundary.copyDiagnostics').click();
      await Promise.resolve();
    });

    expect(execCommandImpl).toHaveBeenCalledWith('copy');
    expect(view.container.textContent).toContain('errorBoundary.copySuccess');
  });

  it('clears pending copy timers on unmount', async () => {
    jest.useFakeTimers();
    const view = renderBoundary(() => true);

    await act(async () => {
      getButton(view.container, 'errorBoundary.copyDiagnostics').click();
      await Promise.resolve();
    });

    expect(() => {
      view.unmount();
      act(() => {
        jest.runOnlyPendingTimers();
      });
    }).not.toThrow();
  });
});