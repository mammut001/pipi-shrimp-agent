/**
 * @jest-environment jsdom
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { Diagnostics } from '../pages/Diagnostics';
import {
  registerDiagnosticsTask,
  registerDiagnosticsTaskCancel,
  useTaskRegistryStore,
} from '../store/taskRegistryStore';

jest.mock('../i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../layout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderDiagnostics() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(React.createElement(Diagnostics));
  });

  return { container, root };
}

function getSelects(container: HTMLElement): HTMLSelectElement[] {
  return Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
}

function getButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(text));
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button as HTMLButtonElement;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('Diagnostics tasks panel', () => {
  beforeEach(() => {
    useTaskRegistryStore.getState().clearTasks();
  });

  afterEach(() => {
    useTaskRegistryStore.getState().clearTasks();
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
    jest.clearAllMocks();
  });

  it('filters tasks by kind and state', async () => {
    registerDiagnosticsTask({
      id: 'chat-task',
      kind: 'chat',
      source: 'session:1',
      state: 'running',
      createdAt: 10,
      cancelable: true,
    });
    registerDiagnosticsTask({
      id: 'browser-task',
      kind: 'browser',
      source: 'https://example.com',
      state: 'completed',
      createdAt: 20,
      cancelable: false,
    });

    const view = renderDiagnostics();
    const [kindSelect, stateSelect] = getSelects(view.container);

    act(() => {
      kindSelect.value = 'browser';
      kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
      stateSelect.value = 'completed';
      stateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await flush();

    expect(view.container.textContent).toContain('browser-task');
    expect(view.container.textContent).not.toContain('chat-task');
  });

  it('cancels tasks through the diagnostics actions column', async () => {
    const cancelHandler = jest.fn(async () => undefined);

    registerDiagnosticsTask({
      id: 'workflow-task',
      kind: 'workflow',
      source: 'instance:demo',
      state: 'running',
      createdAt: 10,
      cancelable: true,
    });
    registerDiagnosticsTaskCancel('workflow-task', cancelHandler);

    const view = renderDiagnostics();

    await act(async () => {
      getButton(view.container, 'diagnostics.cancelTask').click();
      await Promise.resolve();
    });

    expect(cancelHandler).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('diagnostics.taskState.cancelled');
  });
});