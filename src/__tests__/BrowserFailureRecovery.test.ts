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

jest.mock('../i18n', () => ({
  t: (key: string) => key,
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
});