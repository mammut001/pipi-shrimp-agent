/**
 * @jest-environment jsdom
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { BrowserFailureRecovery } from '../components/BrowserFailureRecovery';
import { useBrowserAgentStore } from '../store/browserAgentStore';
import { useBrowserObservabilityStore } from '../store/browserObservabilityStore';
import { useUIStore } from '../store/uiStore';

const mockSafeInvoke = jest.fn();
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const mockClipboardWriteText = jest.fn<() => Promise<void>>(() => Promise.resolve());

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function disposeView(root: Root, container: HTMLDivElement) {
  const index = mountedRoots.findIndex((mounted) => mounted.root === root && mounted.container === container);
  if (index >= 0) {
    mountedRoots.splice(index, 1);
  }
  act(() => {
    root.unmount();
  });
  container.remove();
}

jest.mock('../i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  setLocale: jest.fn(),
  addLocaleChangeListener: jest.fn(() => jest.fn()),
  getSupportedLocales: () => [{ value: 'en-US', label: 'English', flag: 'US' }],
  convertOldLanguageCode: (code: string) => (code === 'en' ? 'en-US' : 'zh-CN'),
  convertToOldLanguageCode: (locale: string) => (locale === 'en-US' ? 'en' : 'zh'),
}));

jest.mock('../utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
}));

function renderRecovery() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(React.createElement(BrowserFailureRecovery));
  });

  return { container, root };
}

function getButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

describe('BrowserFailureRecovery', () => {
  beforeEach(() => {
    mockSafeInvoke.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
    });
    mockSafeInvoke.mockResolvedValue(null);

    useBrowserObservabilityStore.setState({
      activeFailureSnapshot: {
        taskId: 'failure-1',
        sessionId: 'session-1',
        lastSuccessAction: 'click',
        failedAction: 'type_text',
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
        screenshotPath: null,
        domSnapshotId: 'snapshot-1',
        errorKind: 'browser.execution_failed',
        errorMessage: 'input element went stale',
        ts: Date.now(),
      },
      failureSnapshots: [],
      failurePreviewSuppressed: false,
      dismissedFailureIds: [],
    });

    useUIStore.setState({
      addNotification: jest.fn(),
    });

    useBrowserAgentStore.setState({
      pendingTask: {
        id: 'task-1',
        connectorType: 'browser_web',
        siteProfileId: 'site-1',
        targetUrl: 'https://example.com/dashboard',
        userIntent: 'sync the dashboard',
        executionPrompt: 'sync the dashboard',
        requiresLogin: false,
        authPolicy: 'none',
        allowedControlMode: 'agent_controlled',
      },
      executeTask: jest.fn(async () => undefined),
      resumePendingTask: jest.fn(async () => undefined),
      inspectCurrentPage: jest.fn(async () => undefined),
      switchToManualMode: jest.fn(),
      showMiniBrowser: jest.fn(),
    });
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
  });

  it('renders the four recovery actions and handles retry/copy/takeover flows', async () => {
    const view = renderRecovery();

    expect(view.container.textContent).toContain('browser.failureRecovery');
    expect(view.container.textContent).toContain('type_text');

    await act(async () => {
      getButton(view.container, 'browser.retryLastAction').click();
      await Promise.resolve();
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith('retry_browser_action', {
      taskId: 'failure-1',
      action: 'type_text',
    });
    expect(useBrowserAgentStore.getState().executeTask).toHaveBeenCalledWith('sync the dashboard');

    await act(async () => {
      getButton(view.container, 'browser.continueFromCurrentPage').click();
      await Promise.resolve();
    });
    expect(useBrowserAgentStore.getState().resumePendingTask).toHaveBeenCalled();

    await act(async () => {
      getButton(view.container, 'browser.takeOver').click();
      await Promise.resolve();
    });
    expect(mockSafeInvoke).toHaveBeenCalledWith('take_over_browser', { taskId: 'failure-1' });
    expect(useBrowserAgentStore.getState().switchToManualMode).toHaveBeenCalled();

    await act(async () => {
      getButton(view.container, 'browser.copyDiagnostics').click();
      await Promise.resolve();
    });
    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
  });

  it('renders normalized screenshots with object-contain and shows a fallback for invalid screenshot data', () => {
    useBrowserObservabilityStore.setState({
      activeFailureSnapshot: {
        taskId: 'failure-2',
        sessionId: 'session-1',
        lastSuccessAction: 'click',
        failedAction: 'type_text',
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
        screenshotPath: 'A'.repeat(64),
        domSnapshotId: 'snapshot-1',
        errorKind: 'browser.execution_failed',
        errorMessage: 'input element went stale',
        ts: Date.now(),
      },
    });

    const validView = renderRecovery();
    const screenshot = validView.container.querySelector('img');
    expect(screenshot?.getAttribute('src')).toContain('data:image/png;base64,');
    expect(screenshot?.getAttribute('class')).toContain('object-contain');

    disposeView(validView.root, validView.container);

    useBrowserObservabilityStore.setState({
      activeFailureSnapshot: {
        taskId: 'failure-3',
        sessionId: 'session-1',
        lastSuccessAction: 'click',
        failedAction: 'type_text',
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
        screenshotPath: 'broken-screenshot',
        domSnapshotId: 'snapshot-1',
        errorKind: 'browser.execution_failed',
        errorMessage: 'input element went stale',
        ts: Date.now(),
      },
    });

    const invalidView = renderRecovery();
    expect(invalidView.container.textContent).toContain('screenshot.invalid');
    expect(invalidView.container.querySelector('img')).toBeNull();
  });

  it('dismisses the active recovery card when closed', async () => {
    const view = renderRecovery();

    await act(async () => {
      getButton(view.container, 'common.close').click();
      await Promise.resolve();
    });

    expect(useBrowserObservabilityStore.getState().activeFailureSnapshot).toBeNull();
  });
});