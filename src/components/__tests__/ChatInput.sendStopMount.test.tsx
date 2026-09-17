/**
 * @jest-environment jsdom
 */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import { create } from 'zustand';

import {
  COMPOSER_SEND_CONTROL_TEST_ID,
  COMPOSER_STOP_CONTROL_TEST_ID,
} from '@/store/chat/chatSelectors';

type SelectorHook<T> = {
  (): T;
  <U>(selector: (state: T) => U): U;
  getState: () => T;
  setState: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void;
};

function createMockHook<T extends Record<string, unknown>>(
  initializer: Parameters<typeof create<T>>[0],
): SelectorHook<T> {
  const store = create<T>(initializer);
  const hook = ((selector?: (state: T) => unknown) => (
    selector ? store(selector) : store()
  )) as SelectorHook<T>;
  hook.getState = store.getState;
  hook.setState = store.setState;
  return hook;
}

const defaultChatState = {
  isStreaming: false,
  pendingToolCalls: 0,
  pendingToolResults: [] as Array<{ id: string; result?: unknown }>,
  sendMessage: jest.fn(),
  stopGeneration: jest.fn(),
  currentSessionId: 'session-1',
  sessions: [
    {
      id: 'session-1',
      permissionMode: 'standard',
      executionMode: 'ask',
      workDir: '/tmp/workspace',
      projectDir: null,
      pipiOutputDir: null,
      messages: [],
    },
  ],
  setSessionProjectDir: jest.fn(),
  setSessionPipiOutputDir: jest.fn(),
  clearSessionProjectDir: jest.fn(),
  clearSessionPipiOutputDir: jest.fn(),
  updateSessionExecutionMode: jest.fn(),
};

const mockUseChatStore = createMockHook(() => ({ ...defaultChatState }));

const defaultUIState = {
  toggleSettings: jest.fn(),
  addNotification: jest.fn(),
  toggleTerminalPanel: jest.fn(),
  terminalPanelVisible: false,
};

const mockUseUIStore = createMockHook(() => ({ ...defaultUIState }));

const defaultMCPState = {
  setDropdownOpen: jest.fn(),
};

const mockUseMCPStore = createMockHook(() => ({ ...defaultMCPState }));

const defaultSessionGoalState = {
  goalsBySession: {} as Record<string, { objective?: string }>,
  hydrate: jest.fn(),
  bindSession: jest.fn(),
  setObjective: jest.fn(),
  clearGoal: jest.fn(),
};

const mockUseSessionGoalStore = createMockHook(() => ({ ...defaultSessionGoalState }));

const mockInvoke = jest.fn().mockResolvedValue(undefined);

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@/utils/safeInvoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeOrNull: jest.fn(),
}));

jest.mock('@/store', () => ({
  useChatStore: mockUseChatStore,
  useUIStore: mockUseUIStore,
}));

jest.mock('@/store/mcpStore', () => ({
  useMCPStore: mockUseMCPStore,
}));

jest.mock('@/store/sessionGoalStore', () => ({
  useSessionGoalStore: mockUseSessionGoalStore,
}));

jest.mock('@/components/mcp', () => ({
  MCPChatButton: () => null,
  MCPDropdown: () => null,
}));

jest.mock('../BrowserIntentConfirm', () => ({
  BrowserIntentConfirm: () => null,
}));

jest.mock('../chatInput/ExecutionModeDropdown', () => ({
  ExecutionModeDropdown: () => null,
  BypassWarningDialog: () => null,
}));

jest.mock('../chatInput/ExecutionModeDropdownErrorBoundary', () => ({
  ExecutionModeDropdownErrorBoundary: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

jest.mock('../chatInput/SessionFolderChip', () => ({
  SessionFolderChip: () => null,
}));

jest.mock('../chatInput/BlockComposer', () => ({
  BlockComposer: () => null,
}));

import { ChatInput } from '../ChatInput';

describe('ChatInput send/stop control mount exclusivity', () => {
  beforeEach(() => {
    mockUseChatStore.setState({ ...defaultChatState });
    mockUseUIStore.setState({ ...defaultUIState });
    mockUseMCPStore.setState({ ...defaultMCPState });
    mockUseSessionGoalStore.setState({ ...defaultSessionGoalState });
    mockInvoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe('case B: idle state', () => {
    it('mounts Send control and unmounts Stop control when idle', () => {
      mockUseChatStore.setState({
        isStreaming: false,
        pendingToolCalls: 0,
        pendingToolResults: [],
      });

      render(<ChatInput />);

      expect(screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeNull();
    });
  });

  describe('case A: busy states', () => {
    it('mounts Stop control and unmounts Send control when streaming', () => {
      mockUseChatStore.setState({
        isStreaming: true,
        pendingToolCalls: 0,
        pendingToolResults: [],
      });

      render(<ChatInput />);

      expect(screen.getByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeNull();
    });

    it('mounts Stop control and unmounts Send control when pendingToolCalls > 0', () => {
      mockUseChatStore.setState({
        isStreaming: false,
        pendingToolCalls: 1,
        pendingToolResults: [],
      });

      render(<ChatInput />);

      expect(screen.getByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeNull();
    });

    it('mounts Stop control and unmounts Send control when pendingToolResults is non-empty', () => {
      mockUseChatStore.setState({
        isStreaming: false,
        pendingToolCalls: 0,
        pendingToolResults: [{ id: 'tool-call-1' }],
      });

      render(<ChatInput />);

      expect(screen.getByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeNull();
    });
  });

  describe('dynamic transition between idle and busy', () => {
    it('switches between Send and Stop when busy state toggles', () => {
      mockUseChatStore.setState({
        isStreaming: false,
        pendingToolCalls: 0,
        pendingToolResults: [],
      });

      render(<ChatInput />);

      expect(screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeNull();

      act(() => {
        mockUseChatStore.setState({ isStreaming: true });
      });
      expect(screen.getByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeNull();

      act(() => {
        mockUseChatStore.setState({ isStreaming: false });
      });
      expect(screen.getByTestId(COMPOSER_SEND_CONTROL_TEST_ID)).toBeTruthy();
      expect(screen.queryByTestId(COMPOSER_STOP_CONTROL_TEST_ID)).toBeNull();
    });
  });
});
