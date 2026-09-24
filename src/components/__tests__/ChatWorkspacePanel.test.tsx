/**
 * @jest-environment jsdom
 *
 * AG-15 PR2: ChatWorkspacePanel empty state + mode bar + error banner.
 */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useChatStore } from '@/store';
import { createMessage, createSession } from '@/types/chat';
import { ChatWorkspacePanel } from '../ChatWorkspacePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'en-US',
  convertToOldLanguageCode: (code: string) => code,
}));

jest.mock('@/layout/edgeToggleGutter', () => ({
  MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS: '',
}));

let mockUserScrolledUp = false;

jest.mock('@/hooks/useChatMessageScroll', () => ({
  useChatMessageScroll: () => ({
    scrollContainerRef: { current: null },
    messagesEndRef: { current: null },
    userScrolledUp: mockUserScrolledUp,
    handleScroll: jest.fn(),
    scrollToBottom: jest.fn(),
  }),
}));

jest.mock('../SessionGoalTraceBar', () => ({
  SessionGoalTraceBar: () => null,
}));

jest.mock('../ChatWorkspaceModeToggle', () => ({
  ChatWorkspaceModeToggle: () =>
    React.createElement('div', { 'data-testid': 'mode-toggle-mock' }),
}));

jest.mock('../ChatTerminalDock', () => ({
  ChatTerminalDock: ({ cwd }: { cwd?: string }) =>
    React.createElement('div', { 'data-testid': 'terminal-dock-mock', 'data-cwd': cwd ?? '' }),
}));

jest.mock('../ChatInput', () => ({
  ChatInput: () => React.createElement('div', { 'data-testid': 'chat-input-mock' }),
}));

jest.mock('../ChatMessage', () => ({
  ChatMessage: () => null,
}));

jest.mock('../SessionWorkspacePreview', () => ({
  workspacePreviewChrome: {
    toolbar: 'toolbar',
    statusStrip: 'status-strip',
    statusBadge: 'status-badge',
    statusValue: 'status-value',
  },
}));

jest.mock('@/components', () => ({
  ChatMessage: () => null,
  ChatInput: () => React.createElement('div', { 'data-testid': 'chat-input-mock' }),
}));

describe('ChatWorkspacePanel', () => {
  beforeEach(() => {
    mockUserScrolledUp = false;
    const session = createSession('Test');
    act(() => {
      useChatStore.setState({
        sessions: [session],
        currentSessionId: session.id,
        isStreaming: false,
        error: null,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows empty state, ChatInput, and forwards terminal cwd', () => {
    render(
      React.createElement(ChatWorkspacePanel, {
        showModeToggle: false,
        workspaceMode: 'chat',
        canPreviewWorkspace: false,
        onWorkspaceModeChange: jest.fn(),
        terminalCwd: '/tmp/work',
      }),
    );
    expect(screen.getByTestId('chat-workspace-panel')).toBeTruthy();
    expect(screen.getByText('PiPi Shrimp Agent')).toBeTruthy();
    expect(screen.getByTestId('chat-input-mock')).toBeTruthy();
    expect(screen.getByTestId('terminal-dock-mock').getAttribute('data-cwd')).toBe('/tmp/work');
    expect(screen.queryByTestId('chat-page-workspace-mode-bar')).toBeNull();
  });

  it('shows the scroll-to-bottom control for a populated chat when the user has scrolled up', () => {
    mockUserScrolledUp = true;
    const session = createSession('Test');
    session.messages = [createMessage('user', 'Earlier message')];
    act(() => {
      useChatStore.setState({
        sessions: [session],
        currentSessionId: session.id,
        isStreaming: false,
        error: null,
      });
    });

    render(
      React.createElement(ChatWorkspacePanel, {
        showModeToggle: false,
        workspaceMode: 'chat',
        canPreviewWorkspace: false,
        onWorkspaceModeChange: jest.fn(),
      }),
    );

    const scrollButton = screen.getByRole('button', { name: 'chat.scrollToBottom' });
    expect(scrollButton).toHaveTextContent('chat.scrollToBottom');
  });

  it('renders the page mode bar when showModeToggle is true', () => {
    render(
      React.createElement(ChatWorkspacePanel, {
        showModeToggle: true,
        workspaceMode: 'chat',
        canPreviewWorkspace: true,
        onWorkspaceModeChange: jest.fn(),
      }),
    );
    expect(screen.getByTestId('chat-page-workspace-mode-bar')).toBeTruthy();
    expect(screen.getByTestId('mode-toggle-mock')).toBeTruthy();
  });

  it('shows error banner with retry + clear', () => {
    const clearError = jest.fn();
    const retryLastMessage = jest.fn(async () => undefined);
    act(() => {
      useChatStore.setState({
        error: 'boom',
        clearError,
        retryLastMessage,
      } as Partial<ReturnType<typeof useChatStore.getState>>);
    });
    render(
      React.createElement(ChatWorkspacePanel, {
        showModeToggle: false,
        workspaceMode: 'chat',
        canPreviewWorkspace: false,
        onWorkspaceModeChange: jest.fn(),
      }),
    );
    expect(screen.getByText('boom')).toBeTruthy();
    fireEvent.click(screen.getByText('common.retry'));
    expect(retryLastMessage).toHaveBeenCalled();
    // clear button is the second button in the error row (icon-only)
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(clearError).toHaveBeenCalled();
  });
});
