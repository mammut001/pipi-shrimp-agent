/** @jest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mockGetApiConfig = jest.fn(async () => undefined);
const mockInitChat = jest.fn(async () => undefined);
const mockInitSwarm = jest.fn(async () => undefined);
const mockShowWindow = jest.fn(async () => undefined);
const mockSetShowShortcuts = jest.fn();
const mockInitializeTelegramStore = jest.fn(async () => undefined);
const mockSetupBrowserObservabilityWiring = jest.fn(() => jest.fn());
const mockSetupTaskDiagnosticsWiring = jest.fn(() => jest.fn());
const mockUiState = {
  settingsOpen: false,
  currentView: 'workflow',
  setCurrentView: jest.fn(),
  setBrowserDockMode: jest.fn(),
  focusChatPane: jest.fn(),
};

jest.mock('@/store', () => ({
  useSettingsStore: () => ({ getApiConfig: mockGetApiConfig }),
  useChatStore: () => ({ init: mockInitChat }),
  useUIStore: (selector: (state: typeof mockUiState) => unknown) => selector(mockUiState),
}));

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: (selector: (state: { showSetupModal: boolean }) => unknown) =>
    selector({ showSetupModal: false }),
}));

jest.mock('@/store/swarmStore', () => ({
  useSwarmStore: (selector: (state: { init: typeof mockInitSwarm }) => unknown) =>
    selector({ init: mockInitSwarm }),
}));

jest.mock('@/store/browserObservabilityWiring', () => ({
  setupBrowserObservabilityWiring: () => mockSetupBrowserObservabilityWiring(),
}));

jest.mock('@/services/taskDiagnosticsWiring', () => ({
  setupTaskDiagnosticsWiring: () => mockSetupTaskDiagnosticsWiring(),
}));

jest.mock('@/store/telegramStore', () => ({
  initializeTelegramStore: () => mockInitializeTelegramStore(),
}));

jest.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: mockShowWindow }),
}));

jest.mock('@/components/ChatBrowserWorkspaceShell', () => {
  const ReactRuntime = require('react');
  return {
    ChatBrowserWorkspaceShell: () =>
      ReactRuntime.createElement('div', { 'data-testid': 'chat-workspace' }),
  };
});

jest.mock('@/components/KeyboardShortcutsModal', () => ({
  useKeyboardShortcuts: () => ({ showShortcuts: false, setShowShortcuts: mockSetShowShortcuts }),
  KeyboardShortcutsModal: () => null,
}));

jest.mock('@/components/NewChatProjectPickerModal', () => ({
  NewChatProjectPickerModal: () => null,
}));

jest.mock('@/pages/Workflow', () => {
  const ReactRuntime = require('react');
  return {
    __esModule: true,
    default: () => ReactRuntime.createElement('div', { 'data-testid': 'workflow-page' }),
  };
});

import App from '@/App';

describe('App bootstrap and routing (TOP-15-10)', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('initializes critical state and renders the selected workflow view', async () => {
    mockUiState.currentView = 'workflow';
    render(React.createElement(App));

    expect(await screen.findByTestId('workflow-page')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetApiConfig).toHaveBeenCalledTimes(1);
      expect(mockInitChat).toHaveBeenCalledTimes(1);
      expect(mockShowWindow).toHaveBeenCalledTimes(1);
    });
    expect(mockGetApiConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitChat.mock.invocationCallOrder[0],
    );
    expect(mockShowWindow.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockInitChat.mock.invocationCallOrder[0],
    );
  });
});
