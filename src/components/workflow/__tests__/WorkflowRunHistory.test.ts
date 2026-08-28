/** @jest-environment jsdom */

import { createElement, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WorkflowRun } from '@/types/workflow';
import { clickElement, createDomHarness } from './domHarness';

const listeners = new Set<() => void>();

interface WorkflowRunHistoryAgent {
  id: string;
  name: string;
}

interface WorkflowRunHistoryInstance {
  id: string;
  agents: WorkflowRunHistoryAgent[];
  workflowRuns: WorkflowRun[];
  activeRunId?: string | null;
}

interface WorkflowRunHistoryState {
  currentInstanceId: string | null;
  selectedRunId: string | null;
  instances: WorkflowRunHistoryInstance[];
  selectRun: (id: string | null) => void;
  renameWorkflowRun: (id: string, title: string) => void;
  deleteWorkflowRun: (id: string) => void;
}

let workflowState: WorkflowRunHistoryState;

function emitWorkflowState(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setWorkflowState(updater: (state: WorkflowRunHistoryState) => WorkflowRunHistoryState): void {
  workflowState = updater(workflowState);
  emitWorkflowState();
}

const useWorkflowStoreMock = Object.assign(
  (selector?: (state: WorkflowRunHistoryState) => unknown) => {
    return useSyncExternalStore(
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

import { WorkflowRunHistory } from '../WorkflowRunHistory';

function createRun(id: string, title: string, startTime: number): WorkflowRun {
  return {
    id,
    title,
    projectGoal: title,
    successCriteria: [],
    status: 'completed',
    startTime,
    endTime: startTime + 1000,
    agents: [
      {
        agentId: `agent-${id}`,
        agentName: `Agent ${title}`,
        status: 'completed',
      },
    ],
    currentIteration: 1,
    goalEvaluations: [],
    reachedGoal: true,
  };
}

function createWorkflowState(selectedRunId: string | null = 'run-2') {
  return {
    currentInstanceId: 'workflow-1',
    selectedRunId,
    instances: [
      {
        id: 'workflow-1',
        agents: [
          {
            id: 'agent-run-1',
            name: 'Agent Run 1',
          },
          {
            id: 'agent-run-2',
            name: 'Agent Run 2',
          },
        ],
        workflowRuns: [
          createRun('run-2', 'Run 2', 2),
          createRun('run-1', 'Run 1', 1),
        ],
      },
    ],
    selectRun: (id: string | null) => {
      setWorkflowState((state) => ({
        ...state,
        selectedRunId: id,
      }));
    },
    renameWorkflowRun: (id: string, title: string) => {
      setWorkflowState((state) => ({
        ...state,
        instances: state.instances.map((instance) => (
          instance.id === state.currentInstanceId
            ? {
                ...instance,
                workflowRuns: instance.workflowRuns.map((run: WorkflowRun) => (
                  run.id === id ? { ...run, title } : run
                )),
              }
            : instance
        )),
      }));
    },
    deleteWorkflowRun: (id: string) => {
      setWorkflowState((state) => {
        const currentInstance = state.instances.find((instance) => instance.id === state.currentInstanceId);
        const workflowRuns = currentInstance?.workflowRuns ?? [];
        const remainingRuns = workflowRuns.filter((run: WorkflowRun) => run.id !== id);
        const deletedIndex = workflowRuns.findIndex((run: WorkflowRun) => run.id === id);
        const nextRunId = remainingRuns[deletedIndex]?.id
          ?? remainingRuns[remainingRuns.length - 1]?.id
          ?? null;

        return {
          ...state,
          selectedRunId: state.selectedRunId === id ? nextRunId : state.selectedRunId,
          instances: state.instances.map((instance) => (
            instance.id === state.currentInstanceId
              ? {
                  ...instance,
                  workflowRuns: remainingRuns,
                  activeRunId: instance.activeRunId === id ? nextRunId : instance.activeRunId,
                }
              : instance
          )),
        };
      });
    },
  };
}

function findToggleButton(container: HTMLElement): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('历史')) as HTMLButtonElement;
}

function findRunEntry(container: HTMLElement, title: string): HTMLDivElement {
  return Array.from(container.querySelectorAll('[role="button"]')).find((item) => item.textContent?.includes(title)) as HTMLDivElement;
}

function findNestedButton(runEntry: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(runEntry.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as HTMLButtonElement;
}

describe('WorkflowRunHistory', () => {
  let harness: ReturnType<typeof createDomHarness>;

  beforeEach(() => {
    workflowState = createWorkflowState();
    harness = createDomHarness();
    listeners.clear();
    Object.defineProperty(harness.window, 'prompt', {
      configurable: true,
      writable: true,
      value: jest.fn(() => 'Renamed Run 1'),
    });
    Object.defineProperty(harness.window, 'confirm', {
      configurable: true,
      writable: true,
      value: jest.fn(() => true),
    });
  });

  afterEach(async () => {
    listeners.clear();
    await harness.cleanup();
    jest.clearAllMocks();
  });

  it('selects a run and reflects the selected styling', async () => {
    await harness.render(createElement(WorkflowRunHistory));
    await clickElement(findToggleButton(harness.container), harness.window);

    await clickElement(findRunEntry(harness.container, 'Run 1'), harness.window);

    const selectedEntry = findRunEntry(harness.container, 'Run 1');
    expect(workflowState.selectedRunId).toBe('run-1');
    expect(selectedEntry.className).toContain('bg-blue-50/70');
  });

  it('renames a run through the prompt flow', async () => {
    await harness.render(createElement(WorkflowRunHistory));
    await clickElement(findToggleButton(harness.container), harness.window);

    const runEntry = findRunEntry(harness.container, 'Run 1');
    await clickElement(findNestedButton(runEntry, '重命名'), harness.window);

    expect(harness.window.prompt).toHaveBeenCalledWith('重命名运行记录', 'Run 1');
    expect(workflowState.instances[0].workflowRuns[1].title).toBe('Renamed Run 1');
    expect(harness.container.textContent).toContain('Renamed Run 1');
  });

  it('deletes the selected run and falls back to the nearest remaining run', async () => {
    await harness.render(createElement(WorkflowRunHistory));
    await clickElement(findToggleButton(harness.container), harness.window);

    const selectedRunEntry = findRunEntry(harness.container, 'Run 2');
    await clickElement(findNestedButton(selectedRunEntry, '删除'), harness.window);

    expect(harness.window.confirm).toHaveBeenCalledWith('删除运行记录“Run 2”？');
    expect(workflowState.selectedRunId).toBe('run-1');
    expect(harness.container.textContent).not.toContain('Run 2');
    expect(findRunEntry(harness.container, 'Run 1').className).toContain('bg-blue-50/70');
  });
});
