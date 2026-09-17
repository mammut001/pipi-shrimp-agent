/**
 * @jest-environment jsdom
 *
 * TOP-15-02 / T-02 / R1-03 regression:
 * browserDockMode=split must still mount the chat panel + ChatInput and allow send.
 * (Historical bug: split rendered only BrowserWorkspacePane — no ChatInput.)
 */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { COMPOSER_SEND_CONTROL_TEST_ID } from '@/store/chat/chatSelectors';
import { useChatStore } from '@/store';
import { useUIStore } from '@/store/uiStore';
import { createSession } from '@/types/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSendMessage = jest.fn(async () => undefined);
const mockSetupEventListeners = jest.fn(async () => () => undefined);

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  convertToOldLanguageCode: (code: string) => code,
}));

jest.mock('@/layout', () => ({
  MainLayout: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'main-layout' }, children),
  MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS: '',
}));

jest.mock('@/hooks/useChatMessageScroll', () => ({
  useChatMessageScroll: () => ({
    scrollContainerRef: { current: null },
    messagesEndRef: { current: null },
    userScrolledUp: false,
    handleScroll: jest.fn(),
    scrollToBottom: jest.fn(),
  }),
}));

jest.mock('../BrowserWorkspacePane', () => ({
  BrowserWorkspacePane: () =>
    React.createElement('div', { 'data-testid': 'browser-workspace-pane' }, 'browser-pane'),
}));

jest.mock('../TerminalPanel', () => ({
  TerminalPanel: () => null,
}));

jest.mock('../SwarmPanel', () => ({
  SwarmPanel: () => null,
}));

jest.mock('../SessionGoalTraceBar', () => ({
  SessionGoalTraceBar: () => null,
}));

jest.mock('../ChatWorkspaceModeToggle', () => ({
  ChatWorkspaceModeToggle: () => null,
}));

jest.mock('../SessionWorkspacePreview', () => ({
  SessionWorkspaceFileManagerPane: () => null,
  SessionWorkspacePreviewPane: () => null,
  useSessionWorkspacePreview: () => ({
    entries: [],
    selectedFilePath: null,
    setSelectedFilePath: jest.fn(),
    selectedContent: null,
    fileLoading: false,
    fileError: null,
    isRefreshing: false,
    isTruncated: false,
    refreshEntries: jest.fn(),
    revealInFinder: jest.fn(),
  }),
  workspacePreviewChrome: {
    statusValue: '',
    statusBadge: '',
    terminalDivider: '',
    terminalDividerThumb: '',
  },
}));

jest.mock('../chat/ScrollToBottomButton', () => ({
  ScrollToBottomButton: () => null,
}));

jest.mock('@/components', () => ({
  ChatMessage: () => null,
  // Focused stub: proves shell mounts ChatInput in split and send reaches the store.
  // Real ChatInput send/stop mount exclusivity is covered by ChatInput.sendStopMount.test.tsx.
  ChatInput: function ChatInputStub() {
    const { useChatStore: useStore } = jest.requireActual('@/store') as typeof import('@/store');
    const sendMessage = useStore((s: { sendMessage: typeof mockSendMessage }) => s.sendMessage);
    const currentSessionId = useStore((s: { currentSessionId: string | null }) => s.currentSessionId);
    return React.createElement(
      'div',
      { 'data-testid': 'chat-input' },
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'composer-send-control',
          onClick: () => {
            void sendMessage('hello from split', currentSessionId ?? undefined);
          },
        },
        'Send',
      ),
    );
  },
}));

// Shell imports useBrowserAgentStore from '@/store' — stub setupEventListeners used on mount.
jest.mock('@/store', () => {
  const actual = jest.requireActual('@/store') as typeof import('@/store');
  return {
    ...actual,
    useBrowserAgentStore: Object.assign(
      (selector?: (s: { setupEventListeners: typeof mockSetupEventListeners }) => unknown) => {
        const state = { setupEventListeners: mockSetupEventListeners };
        return selector ? selector(state) : state;
      },
      {
        getState: () => ({ setupEventListeners: mockSetupEventListeners }),
      },
    ),
  };
});

import { ChatBrowserWorkspaceShell } from '../ChatBrowserWorkspaceShell';

describe('ChatBrowserWorkspaceShell split ChatInput (TOP-15-02 / T-02 / R1-03)', () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    mockSetupEventListeners.mockClear();
    mockSetupEventListeners.mockResolvedValue(() => undefined);

    const session = {
      ...createSession('Split chat'),
      id: 'session-split-1',
    };

    useChatStore.setState({
      sessions: [session],
      currentSessionId: session.id,
      isStreaming: false,
      error: null,
      pendingToolCalls: 0,
      pendingToolResults: [],
      // Override send with test spy (layout regression only — not full send pipeline).
      sendMessage: mockSendMessage as never,
    });

    useUIStore.setState({
      browserDockMode: 'split',
      browserSplitFocus: 'chat',
      permissionQueue: [],
      permissionLedger: [],
      activeQuestionnaire: null,
      activeQuestionnaireSessionId: null,
      terminalPanelVisible: false,
      terminalPanelHeight: 200,
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('in split mode mounts BrowserWorkspacePane and ChatInput together', () => {
    render(React.createElement(ChatBrowserWorkspaceShell));

    expect(screen.getByTestId('browser-workspace-pane')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeInTheDocument();
  });

  it('in split mode ChatInput send reaches sendMessage for the current session', () => {
    render(React.createElement(ChatBrowserWorkspaceShell));

    fireEvent.click(screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID));

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith('hello from split', 'session-split-1');
  });

  it('keeps ChatInput when leaving split (hidden dock) — chat-only layout still composable', () => {
    useUIStore.setState({ browserDockMode: 'hidden' });

    render(React.createElement(ChatBrowserWorkspaceShell));

    expect(screen.queryByTestId('browser-workspace-pane')).toBeNull();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  it('re-exposes ChatInput after toggling into split from hidden', () => {
    useUIStore.setState({ browserDockMode: 'hidden' });
    const { rerender } = render(React.createElement(ChatBrowserWorkspaceShell));

    expect(screen.queryByTestId('browser-workspace-pane')).toBeNull();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();

    act(() => {
      useUIStore.setState({ browserDockMode: 'split' });
    });
    rerender(React.createElement(ChatBrowserWorkspaceShell));

    expect(screen.getByTestId('browser-workspace-pane')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID));
    expect(mockSendMessage).toHaveBeenCalledWith('hello from split', 'session-split-1');
  });
});
