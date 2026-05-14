import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { clickElement, createDomHarness, flushEffects } from './domHarness';

const listeners = new Set<() => void>();
let workflowState: any;
const addNotification = jest.fn();
const mockSetStreamChunkCallback = jest.fn();
const mockReadFile = jest.fn();
const mockListDirectory = jest.fn();

function emitWorkflowState(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setWorkflowState(updater: (state: any) => any): void {
  workflowState = updater(workflowState);
  emitWorkflowState();
}

const useWorkflowStoreMock = Object.assign(
  (selector?: (state: any) => unknown) => {
    const React = require('react') as typeof import('react');
    return React.useSyncExternalStore(
      (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => (selector ? selector(workflowState) : workflowState),
      () => (selector ? selector(workflowState) : workflowState),
    );
  },
  {
    getState: () => workflowState,
  },
);

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: useWorkflowStoreMock,
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: (selector: (state: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

jest.mock('@/services/workflowEngine', () => ({
  workflowEngine: {
    setStreamChunkCallback: (...args: unknown[]) => mockSetStreamChunkCallback(...args),
  },
}));

jest.mock('@/services/workflow', () => ({
  workflowService: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    listDirectory: (...args: unknown[]) => mockListDirectory(...args),
  },
}));

jest.mock('@/hooks/usePolling', () => ({
  usePolling: () => undefined,
}));

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

import { WorkflowOutputPanel } from '../WorkflowOutputPanel';

function createWorkflowState(selectedRunId: string) {
  return {
    currentInstanceId: 'workflow-1',
    isRunning: false,
    selectedRunId,
    selectedPreviewFile: null,
    setSelectedPreviewFile: (path: string | null) => {
      setWorkflowState((state) => ({
        ...state,
        selectedPreviewFile: path,
      }));
    },
    instances: [
      {
        id: 'workflow-1',
        activeRunId: null,
        agents: [
          {
            id: 'agent-current',
            name: 'Current Agent',
            status: 'legacy-status' as any,
            task: 'Current task',
          },
        ],
        workflowRuns: [
          {
            id: 'run-empty',
            title: 'Run Empty',
            projectGoal: 'Goal Empty',
            successCriteria: '',
            status: 'completed',
            startTime: 3,
            agents: [],
            currentIteration: 1,
            goalEvaluations: [],
            reachedGoal: true,
          },
          {
            id: 'run-output',
            title: 'Run Output',
            projectGoal: 'Goal Output',
            successCriteria: '',
            status: 'completed',
            startTime: 2,
            agents: [
              {
                agentId: 'agent-output',
                agentName: 'Output Agent',
                status: 'completed',
                outputFilePath: '/tmp/output-agent.md',
                output: 'summary output should not win',
              },
            ],
            currentIteration: 1,
            goalEvaluations: [],
            reachedGoal: true,
          },
          {
            id: 'run-fallback',
            title: 'Run Fallback',
            projectGoal: 'Goal Fallback',
            successCriteria: '',
            status: 'completed',
            startTime: 1,
            agents: [
              {
                agentId: 'agent-fallback',
                agentName: 'Fallback Agent',
                status: 'weird-status' as any,
                outputFilePath: '/tmp/missing-agent.md',
                output: 'fallback summary output',
              },
            ],
            currentIteration: 1,
            goalEvaluations: [],
            reachedGoal: true,
          },
        ],
      },
    ],
  };
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text)) as HTMLButtonElement;
}

describe('WorkflowOutputPanel', () => {
  let harness: ReturnType<typeof createDomHarness>;

  beforeEach(() => {
    workflowState = createWorkflowState('run-output');
    harness = createDomHarness();
    listeners.clear();
    mockSetStreamChunkCallback.mockReset();
    mockReadFile.mockReset();
    mockListDirectory.mockReset();
    addNotification.mockReset();
  });

  afterEach(async () => {
    listeners.clear();
    await harness.cleanup();
    jest.clearAllMocks();
  });

  it('prefers persisted output files over summary output and strips metadata comments', async () => {
    mockReadFile.mockResolvedValue({
      content: '<!--\nAgent: Output Agent\n-->\n\nrendered file output',
      path: '/tmp/output-agent.md',
    });

    await harness.render(createElement(WorkflowOutputPanel));
    await flushEffects();
    await clickElement(findButtonByText(harness.container, 'Output Agent'), harness.window);

    expect(mockReadFile).toHaveBeenCalledWith('/tmp/output-agent.md');
    expect(harness.container.textContent).toContain('rendered file output');
    expect(harness.container.textContent).not.toContain('summary output should not win');
    expect(harness.container.textContent).not.toContain('Agent: Output Agent');
  });

  it('falls back to stored summary output when reading the persisted file fails', async () => {
    workflowState = createWorkflowState('run-fallback');
    mockReadFile.mockRejectedValue(new Error('missing output file'));

    await harness.render(createElement(WorkflowOutputPanel));
    await flushEffects();
    await clickElement(findButtonByText(harness.container, 'Fallback Agent'), harness.window);

    expect(mockReadFile).toHaveBeenCalledWith('/tmp/missing-agent.md');
    expect(harness.container.textContent).toContain('fallback summary output');
    expect(harness.container.textContent).not.toContain('weird-status');
  });

  it('falls back to current agents when the selected historical run has no agent entries', async () => {
    workflowState = createWorkflowState('run-empty');

    await harness.render(createElement(WorkflowOutputPanel));
    await flushEffects();
    await clickElement(findButtonByText(harness.container, 'Current Agent'), harness.window);

    expect(harness.container.textContent).toContain('Current Agent');
    expect(harness.container.textContent).toContain('workflow.output.noOutput');
    expect(harness.container.textContent).not.toContain('legacy-status');
  });
});
