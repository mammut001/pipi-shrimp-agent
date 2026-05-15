/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { create } from 'zustand';

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

const mockInvoke = jest.fn();
const mockSetAgentPanelTab = jest.fn();
const mockSetAgentInstructions = jest.fn();
const mockAddNotification = jest.fn();
const mockRemoveImportedFile = jest.fn();
const mockClearImportedFiles = jest.fn();
const mockRemoveSessionWorkingFile = jest.fn();
const mockUpdateSessionPermissionMode = jest.fn();
const mockLoadSkills = jest.fn();
const mockSetupCdpConnectionMonitor = jest.fn(() => () => undefined);
const mockAutoResearchSetShowSetupModal = jest.fn();

const mockUseUIStore = createMockHook((set) => ({
  agentInstructions: 'Agent soul',
  setAgentInstructions: (instructions: string) => {
    mockSetAgentInstructions(instructions);
    set({ agentInstructions: instructions });
  },
  taskProgress: [],
  addNotification: (type: string, message: string, sessionId?: string) => {
    mockAddNotification(type, message, sessionId);
  },
  updateTaskStep: (id: string, status: string) => set((state) => ({
    taskProgress: state.taskProgress.map((step: any) => (
      step.id === id ? { ...step, status } : step
    )),
  })),
  agentPanelTab: 'main',
  setAgentPanelTab: (tab: string) => {
    mockSetAgentPanelTab(tab);
    set({ agentPanelTab: tab });
  },
  currentArtifactId: undefined,
  activeSkill: null,
}));

const mockUseSettingsStore = createMockHook(() => ({
  importedFiles: [],
  removeImportedFile: mockRemoveImportedFile,
  clearImportedFiles: mockClearImportedFiles,
}));

const mockUseChatStore = createMockHook(() => ({
  currentMessages: () => [],
  currentSessionId: 'session-1',
  sessions: [{
    id: 'session-1',
    permissionMode: 'standard',
    workingFiles: [],
    workDir: '/tmp/workspace',
  }],
  removeSessionWorkingFile: mockRemoveSessionWorkingFile,
  updateSessionPermissionMode: mockUpdateSessionPermissionMode,
  isStreaming: false,
  pendingToolCalls: 1,
}));

const mockUseSkillStore = createMockHook(() => ({
  loadSkills: mockLoadSkills,
  getCoreSkills: () => [],
  getRemainingCount: () => 0,
  isLoaded: true,
}));

const mockBrowserAgentState = {
  status: 'idle',
  presentationMode: 'collapsed',
};
const mockUseBrowserAgentStore = ((selector?: (state: typeof mockBrowserAgentState) => unknown) => (
  selector ? selector(mockBrowserAgentState) : mockBrowserAgentState
)) as SelectorHook<typeof mockBrowserAgentState>;
mockUseBrowserAgentStore.getState = () => mockBrowserAgentState;
mockUseBrowserAgentStore.setState = () => undefined;

const mockCdpState = {
  status: 'disconnected',
  connectionState: null,
  setupConnectionMonitor: mockSetupCdpConnectionMonitor,
};
const mockUseCdpStore = ((selector?: (state: typeof mockCdpState) => unknown) => (
  selector ? selector(mockCdpState) : mockCdpState
)) as SelectorHook<typeof mockCdpState>;
mockUseCdpStore.getState = () => mockCdpState;
mockUseCdpStore.setState = () => undefined;

const mockUseAutoResearchStore = Object.assign(
  (() => ({
    loopState: 'running',
    setShowSetupModal: mockAutoResearchSetShowSetupModal,
  })) as SelectorHook<{ loopState: string; setShowSetupModal: typeof mockAutoResearchSetShowSetupModal }>,
  {
    getState: () => ({
      loopState: 'running',
      setShowSetupModal: mockAutoResearchSetShowSetupModal,
    }),
    setState: () => undefined,
  },
);

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@/store', () => ({
  useUIStore: mockUseUIStore,
  useSettingsStore: mockUseSettingsStore,
  useChatStore: mockUseChatStore,
  useSkillStore: mockUseSkillStore,
}));

jest.mock('@/hooks/usePolling', () => ({
  usePolling: jest.fn(),
}));

jest.mock('@/store/browserAgentStore', () => ({
  useBrowserAgentStore: mockUseBrowserAgentStore,
}));

jest.mock('@/store/cdpStore', () => ({
  useCdpStore: mockUseCdpStore,
}));

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: mockUseAutoResearchStore,
}));

jest.mock('../CdpConnectorModal', () => ({
  CdpConnectorModal: () => null,
}));

jest.mock('../BrowserMiniPreview', () => ({
  BrowserMiniPreview: () => null,
}));

jest.mock('../DocPanel', () => ({
  DocPanel: () => null,
}));

jest.mock('../ChatImage', () => ({
  ChatImage: () => null,
}));

jest.mock('../AutoResearchPanel', () => ({
  AutoResearchPanel: () => null,
}));

jest.mock('../ui/Section', () => {
  const React = require('react');
  return {
    Section: ({ title, children }: { title: string; children: React.ReactNode }) => React.createElement(
      'section',
      { 'data-section-title': title },
      React.createElement('h2', null, title),
      children,
    ),
  };
});

jest.mock('../ui/FileIcon', () => {
  const React = require('react');
  return {
    FileIcon: ({ filename }: { filename: string }) => React.createElement('span', null, filename),
  };
});

import { AgentPanel } from '../AgentPanel';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(createElement(AgentPanel));
  });

  return { container, root };
}

describe('AgentPanel', () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mockInvoke.mockReset();
    mockAddNotification.mockReset();
    mockUseUIStore.setState({
      agentInstructions: 'Agent soul',
      taskProgress: [{
        id: 'tool-1',
        label: 'execute_command',
        status: 'running',
        executionId: 'exec-1',
      }],
      agentPanelTab: 'main',
      currentArtifactId: undefined,
      activeSkill: null,
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

  it('shows a cancel button for running steps with execution ids and marks them cancelled after click', async () => {
    mockInvoke.mockResolvedValue({
      executionId: 'exec-1',
      cancelled: true,
      status: 'cancelled',
      message: 'Cancellation signal sent to the running process.',
    });

    const view = renderPanel();
    const cancelButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cancel');

    expect(cancelButton).toBeTruthy();

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockInvoke).toHaveBeenCalledWith('cancel_tool_execution', {
      executionId: 'exec-1',
    });
    expect(view.container.textContent).toContain('Cancelled');
    expect(view.container.textContent).not.toContain('Thinking');
  });

  it('does not show a cancel button when a running step has no execution id', () => {
    mockUseUIStore.setState({
      taskProgress: [{
        id: 'tool-2',
        label: 'read_file',
        status: 'running',
        executionId: null,
      }],
    });

    const view = renderPanel();
    const cancelButton = Array.from(view.container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cancel');

    expect(cancelButton).toBeUndefined();
    expect(view.container.textContent).toContain('Thinking');
  });
});