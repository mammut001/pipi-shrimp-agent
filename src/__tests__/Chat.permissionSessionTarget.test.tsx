/**
 * @jest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { Chat } from '../pages/Chat';
import { useChatStore } from '../store';
import { useUIStore } from '../store/uiStore';
import { createSession } from '../types/chat';

jest.mock('../layout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

jest.mock('../components', () => {
  const actual = jest.requireActual<typeof import('../components/PermissionModal')>('../components/PermissionModal');
  return {
    ChatMessage: () => null,
    ChatInput: () => null,
    QuestionnaireCard: () => null,
    TerminalPanel: () => null,
    PermissionModal: actual.PermissionModal,
  };
});

jest.mock('../components/chat/ScrollToBottomButton', () => ({
  ScrollToBottomButton: () => null,
}));

jest.mock('../hooks/useChatMessageScroll', () => ({
  useChatMessageScroll: () => ({
    scrollContainerRef: { current: null },
    messagesEndRef: { current: null },
    userScrolledUp: false,
    handleScroll: jest.fn(),
    scrollToBottom: jest.fn(),
  }),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderChat() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(React.createElement(Chat));
  });

  return { container, root };
}

function getButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button as HTMLButtonElement;
}

describe('Legacy Chat permission session targeting', () => {
  beforeEach(() => {
    useUIStore.setState({
      permissionQueue: [],
      permissionLedger: [],
    });
    const sessionA = {
      ...createSession('Chat A'),
      id: 'session-A',
    };
    const sessionB = {
      ...createSession('Chat B'),
      id: 'session-B',
    };
    useChatStore.setState({
      sessions: [sessionA, sessionB],
      currentSessionId: 'session-A',
      isStreaming: false,
      error: null,
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
    useUIStore.getState().clearAllPermissions();
    jest.clearAllMocks();
  });

  it('approving permission in legacy Chat resolves selected session-A request, not queue[0] session-B', async () => {
    const promiseB = useUIStore.getState().waitForPermission({
      id: 'perm-b',
      name: 'execute_command',
      arguments: '{"cmd":"b"}',
      sessionId: 'session-B',
    });
    const promiseA = useUIStore.getState().waitForPermission({
      id: 'perm-a',
      name: 'execute_command',
      arguments: '{"cmd":"a"}',
      sessionId: 'session-A',
    });

    let settledA: boolean | null = null;
    void promiseA.then((res) => {
      settledA = res;
    });
    let settledB: boolean | null = null;
    void promiseB.then((res) => {
      settledB = res;
    });

    const view = renderChat();

    // Click Approve ('tool.allow')
    const approveButton = getButton(view.container, 'tool.allow');
    act(() => {
      approveButton.click();
    });

    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(settledA).toBe(true);
    expect(settledB).toBeNull();
    await expect(promiseA).resolves.toBe(true);
    expect(useUIStore.getState().permissionQueue).toEqual([
      expect.objectContaining({ id: 'perm-b', sessionId: 'session-B' }),
    ]);
  });

  it('denying permission in legacy Chat resolves selected session-A request, not queue[0] session-B', async () => {
    const promiseB = useUIStore.getState().waitForPermission({
      id: 'perm-b',
      name: 'execute_command',
      arguments: '{"cmd":"b"}',
      sessionId: 'session-B',
    });
    const promiseA = useUIStore.getState().waitForPermission({
      id: 'perm-a',
      name: 'execute_command',
      arguments: '{"cmd":"a"}',
      sessionId: 'session-A',
    });

    let settledA: boolean | null = null;
    void promiseA.then((res) => {
      settledA = res;
    });
    let settledB: boolean | null = null;
    void promiseB.then((res) => {
      settledB = res;
    });

    const view = renderChat();

    // Click Deny ('tool.deny')
    const denyButton = getButton(view.container, 'tool.deny');
    act(() => {
      denyButton.click();
    });

    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(settledA).toBe(false);
    expect(settledB).toBeNull();
    await expect(promiseA).resolves.toBe(false);
    expect(useUIStore.getState().permissionQueue).toEqual([
      expect.objectContaining({ id: 'perm-b', sessionId: 'session-B' }),
    ]);
  });
});
