/**
 * @jest-environment jsdom
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  AgentPanelTabBar,
  AgentPanelProgressSection,
  AgentPanelWorkingFoldersSection,
  AgentPanelContextSection,
  AgentPanelFooter,
  AgentPanelBrowserTab,
  AgentPanelArtifactTab,
} from '@/components/agentPanelSections';
import type { TaskStep } from '@/types/ui';
import type { ImportedFile } from '@/types/settings';
import type { SkillInfo } from '@/store/skillStore';
import type { SyncedWorkspaceEntry } from '@/components/agentPanelUi';

jest.mock('@/components/BrowserMiniPreview', () => ({
  BrowserMiniPreview: () => createElement('div', { 'data-testid': 'mock-browser-mini-preview' }, 'BrowserMiniPreview'),
}));

jest.mock('@/components/agentPanelUi', () => {
  const actual = jest.requireActual('@/components/agentPanelUi') as Record<string, unknown>;
  return {
    ...actual,
    ArtifactRenderer: ({ artifactId }: { artifactId?: string }) =>
      createElement('div', { 'data-testid': 'mock-artifact-renderer' }, `Artifact: ${artifactId ?? 'none'}`),
  };
});

describe('agentPanelSections', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  describe('AgentPanelTabBar', () => {
    it('renders Main, Browser, and Goal tabs and handles clicks', () => {
      const setActiveTab = jest.fn();
      act(() => {
        root.render(
          createElement(AgentPanelTabBar, {
            activeTab: 'main',
            setActiveTab,
            currentArtifactId: null,
          }),
        );
      });

      expect(container.textContent).toContain('Main');
      const buttons = container.querySelectorAll('button');
      // Main, Browser, Goal buttons
      expect(buttons.length).toBe(3);

      act(() => {
        buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(setActiveTab).toHaveBeenCalledWith('main');

      act(() => {
        buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(setActiveTab).toHaveBeenCalledWith('browser');

      act(() => {
        buttons[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(setActiveTab).toHaveBeenCalledWith('goal');
    });

    it('renders Artifact Preview button when currentArtifactId is present', () => {
      const setActiveTab = jest.fn();
      act(() => {
        root.render(
          createElement(AgentPanelTabBar, {
            activeTab: 'artifact-preview',
            setActiveTab,
            currentArtifactId: 'art-123',
          }),
        );
      });

      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(4);
      const artifactBtn = container.querySelector('button[title="Artifact Preview"]');
      expect(artifactBtn).toBeTruthy();

      act(() => {
        artifactBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(setActiveTab).toHaveBeenCalledWith('artifact-preview');
    });
  });

  describe('AgentPanelProgressSection', () => {
    it('renders empty state when taskProgress is empty and section is expanded', () => {
      act(() => {
        root.render(
          createElement(AgentPanelProgressSection, {
            taskProgress: [],
            onCancelToolExecution: jest.fn(),
          }),
        );
      });

      expect(container.textContent).toContain('Progress');
      // When taskProgress is empty, defaultExpanded is false. Click Section toggle to expand.
      const sectionToggle = container.querySelector('button');
      expect(sectionToggle).toBeTruthy();
      act(() => {
        sectionToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(container.textContent).toContain('No Active Task');
    });

    it('renders task steps with status and cancel button when running with executionId', () => {
      const onCancel = jest.fn();
      const steps: TaskStep[] = [
        {
          id: 'step-1',
          label: 'read_file index.ts',
          status: 'done',
        },
        {
          id: 'step-2',
          label: 'execute_command cargo test',
          status: 'running',
          executionId: 'exec-42',
        },
        {
          id: 'step-3',
          label: 'await confirmation',
          status: 'awaiting_confirmation',
        },
      ];

      act(() => {
        root.render(
          createElement(AgentPanelProgressSection, {
            taskProgress: steps,
            onCancelToolExecution: onCancel,
          }),
        );
      });

      expect(container.textContent).toContain('1 of 3');
      expect(container.textContent).toContain('read_file index.ts');
      expect(container.textContent).toContain('execute_command cargo test');
      expect(container.textContent).toContain('Thinking');
      expect(container.textContent).toContain('Awaiting confirmation');

      const cancelBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Cancel',
      );
      expect(cancelBtn).toBeTruthy();

      act(() => {
        cancelBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onCancel).toHaveBeenCalledWith('step-2', 'exec-42');
    });

    it('renders cancelling, validating, approved, cancelled, timed_out, rejected statuses', () => {
      const steps: TaskStep[] = [
        { id: 's1', label: 'Step Cancelling', status: 'cancelling' },
        { id: 's2', label: 'Step Validating', status: 'validating' },
        { id: 's3', label: 'Step Approved', status: 'approved' },
        { id: 's4', label: 'Step Cancelled', status: 'cancelled' },
        { id: 's5', label: 'Step Timed Out', status: 'timed_out' },
        { id: 's6', label: 'Step Rejected', status: 'rejected' },
      ];

      act(() => {
        root.render(
          createElement(AgentPanelProgressSection, {
            taskProgress: steps,
            onCancelToolExecution: jest.fn(),
          }),
        );
      });

      expect(container.textContent).toContain('Cancelling');
      expect(container.textContent).toContain('Validating');
      expect(container.textContent).toContain('Approved');
      expect(container.textContent).toContain('Cancelled');
      expect(container.textContent).toContain('Timed out');
      expect(container.textContent).toContain('Rejected');
    });
  });

  describe('AgentPanelWorkingFoldersSection', () => {
    it('renders empty state when no files exist', () => {
      act(() => {
        root.render(
          createElement(AgentPanelWorkingFoldersSection, {
            syncedFiles: [],
            allWorkingFiles: [],
            sessionWorkingFiles: [],
            globalImportedFiles: [],
            currentSessionId: 'sess-1',
            onRemoveSessionWorkingFile: jest.fn(),
            onRemoveImportedFile: jest.fn(),
            onClearImportedFiles: jest.fn(),
          }),
        );
      });

      const empty = container.querySelector('[data-testid="working-folders-empty"]');
      expect(empty).toBeTruthy();
      expect(empty?.textContent).toContain('agentPanel.workingFolders.emptyTitle');
      expect(empty?.textContent).toContain('agentPanel.workingFolders.emptyHint');
    });

    it('renders synced disk files and triggers onRevealInFinder on click', () => {
      const onReveal = jest.fn();
      const synced: SyncedWorkspaceEntry[] = [
        {
          name: 'src',
          is_directory: true,
          path: '/repo/src',
          depth: 0,
          displayName: 'src',
        },
        {
          name: 'main.rs',
          is_directory: false,
          path: '/repo/src/main.rs',
          depth: 1,
          displayName: 'src/main.rs',
        },
      ];

      act(() => {
        root.render(
          createElement(AgentPanelWorkingFoldersSection, {
            syncedFiles: synced,
            allWorkingFiles: [],
            sessionWorkingFiles: [],
            globalImportedFiles: [],
            currentSessionId: 'sess-1',
            onRemoveSessionWorkingFile: jest.fn(),
            onRemoveImportedFile: jest.fn(),
            onClearImportedFiles: jest.fn(),
            onRevealInFinder: onReveal,
          }),
        );
      });

      expect(container.textContent).toContain('src');
      expect(container.textContent).toContain('src/main.rs');
      expect(container.textContent).toContain('disk');

      const diskItems = container.querySelectorAll('.cursor-pointer');
      expect(diskItems.length).toBe(2);
      act(() => {
        diskItems[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onReveal).toHaveBeenCalledWith('/repo/src');
    });

    it('renders working files with session/global badges and delete buttons', () => {
      const onRemoveSession = jest.fn();
      const onRemoveImported = jest.fn();
      const onClearGlobal = jest.fn();

      const sessionFile: ImportedFile = { id: 'sf-1', name: 'session.txt', path: '/path/session.txt' };
      const globalFile: ImportedFile = { id: 'gf-1', name: 'global.txt', path: '/path/global.txt' };

      act(() => {
        root.render(
          createElement(AgentPanelWorkingFoldersSection, {
            syncedFiles: [],
            allWorkingFiles: [sessionFile, globalFile],
            sessionWorkingFiles: [sessionFile],
            globalImportedFiles: [globalFile],
            currentSessionId: 'sess-1',
            onRemoveSessionWorkingFile: onRemoveSession,
            onRemoveImportedFile: onRemoveImported,
            onClearImportedFiles: onClearGlobal,
          }),
        );
      });

      expect(container.textContent).toContain('session.txt');
      expect(container.textContent).toContain('session');
      expect(container.textContent).toContain('global.txt');
      expect(container.textContent).toContain('global');
      expect(container.textContent).toContain('1 global file (all sessions)');

      const removeBtns = container.querySelectorAll('div.group button');
      expect(removeBtns.length).toBe(2);

      act(() => {
        removeBtns[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onRemoveSession).toHaveBeenCalledWith('sess-1', 'sf-1');

      act(() => {
        removeBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onRemoveImported).toHaveBeenCalledWith('gf-1');

      const clearGlobalBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Clear global',
      );
      expect(clearGlobalBtn).toBeTruthy();
      act(() => {
        clearGlobalBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onClearGlobal).toHaveBeenCalledTimes(1);
    });
  });

  describe('AgentPanelContextSection', () => {
    const coreSkills: SkillInfo[] = [
      { id: 'browse', name: 'browse', displayName: 'Web Browser', description: 'Browse the web', category: 'web' },
      { id: 'read_file', name: 'read_file', displayName: 'File Reader', description: 'Read files', category: 'filesystem' },
    ];

    it('renders skills, connectors, and agent soul', () => {
      const onOpenConnector = jest.fn();
      const onSaveSoul = jest.fn();
      const onChangeInstructions = jest.fn();

      act(() => {
        root.render(
          createElement(AgentPanelContextSection, {
            activeSkill: 'custom_skill',
            coreSkills,
            remainingCount: 2,
            cdpStatus: 'disconnected',
            cdpConnectionState: null,
            onOpenConnectorModal: onOpenConnector,
            agentInstructions: 'Initial soul',
            localInstructions: 'Changed soul',
            onChangeLocalInstructions: onChangeInstructions,
            onSaveSoul,
            isSavingSoul: false,
          }),
        );
      });

      expect(container.textContent).toContain('Skills');
      expect(container.textContent).toContain('Custom_skill');
      expect(container.textContent).toContain('Web Browser');
      expect(container.textContent).toContain('+ 2 more');
      expect(container.textContent).toContain('Connectors');
      expect(container.textContent).toContain('Chrome Browser');
      expect(container.textContent).toContain('Click to Connect');

      // Click connector modal button
      const connectorBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('Chrome Browser'),
      );
      expect(connectorBtn).toBeTruthy();
      act(() => {
        connectorBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onOpenConnector).toHaveBeenCalledTimes(1);

      // Save changes button when local != agent instructions
      const saveBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Save Changes',
      );
      expect(saveBtn).toBeTruthy();
      act(() => {
        saveBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onSaveSoul).toHaveBeenCalledTimes(1);

      // Textarea typing
      const textarea = container.querySelector('textarea');
      expect(textarea?.value).toBe('Changed soul');
      act(() => {
        textarea?.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    it('does not trigger connector modal if already connected', () => {
      const onOpenConnector = jest.fn();
      act(() => {
        root.render(
          createElement(AgentPanelContextSection, {
            activeSkill: null,
            coreSkills: [],
            remainingCount: 0,
            cdpStatus: 'connected',
            cdpConnectionState: {
              launch_mode: 'launch',
              health_status: 'healthy',
              current_url: 'https://example.com',
              health_failures: 0,
            },
            onOpenConnectorModal: onOpenConnector,
            agentInstructions: 'Soul',
            localInstructions: 'Soul',
            onChangeLocalInstructions: jest.fn(),
            onSaveSoul: jest.fn(),
            isSavingSoul: false,
          }),
        );
      });

      expect(container.textContent).toContain('Pipi Shrimp in Chrome');
      expect(container.textContent).toContain('Healthy');
      expect(container.textContent).toContain('Launched by PiPi');

      const connectorBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('Pipi Shrimp in Chrome'),
      );
      expect(connectorBtn).toBeTruthy();
      act(() => {
        connectorBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onOpenConnector).not.toHaveBeenCalled();
    });
  });

  describe('AgentPanelFooter', () => {
    it('renders system ready when no running or cancelling steps', () => {
      act(() => {
        root.render(
          createElement(AgentPanelFooter, {
            taskProgress: [{ status: 'done' }],
          }),
        );
      });
      expect(container.textContent).toContain('System Ready');
      expect(container.textContent).toContain('v0.1.0-alpha');
    });

    it('renders processing when running', () => {
      act(() => {
        root.render(
          createElement(AgentPanelFooter, {
            taskProgress: [{ status: 'running' }],
            version: 'v0.2.0',
          }),
        );
      });
      expect(container.textContent).toContain('Processing');
      expect(container.textContent).toContain('v0.2.0');
    });

    it('renders cancelling when cancelling', () => {
      act(() => {
        root.render(
          createElement(AgentPanelFooter, {
            taskProgress: [{ status: 'cancelling' }],
          }),
        );
      });
      expect(container.textContent).toContain('Cancelling');
    });
  });

  describe('tab wrappers', () => {
    it('renders AgentPanelBrowserTab without crashing', () => {
      act(() => {
        root.render(createElement(AgentPanelBrowserTab));
      });
      expect(container.querySelector('[data-testid="mock-browser-mini-preview"]')).toBeTruthy();
    });

    it('renders AgentPanelArtifactTab with given artifactId', () => {
      act(() => {
        root.render(
          createElement(AgentPanelArtifactTab, {
            artifactId: 'art-99',
            messages: [],
          }),
        );
      });
      expect(container.querySelector('[data-testid="mock-artifact-renderer"]')?.textContent).toBe(
        'Artifact: art-99',
      );
    });
  });
});
