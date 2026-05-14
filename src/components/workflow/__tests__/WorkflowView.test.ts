import { createElement, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { clickElement, createDomHarness, flushEffects } from './domHarness';

const listeners = new Set<() => void>();

interface WorkflowViewAgent {
  id: string;
  name: string;
  task?: string;
  taskPrompt?: string;
  taskInstruction?: string;
  inputFrom?: string | null;
}

interface WorkflowViewInstance {
  id: string;
  agents: WorkflowViewAgent[];
}

interface WorkflowViewState {
  currentInstanceId: string | null;
  instances: WorkflowViewInstance[];
  createInstance: () => void;
  updateAgent: jest.Mock;
}

let workflowState: WorkflowViewState;

function emitWorkflowState(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setWorkflowState(updater: (state: WorkflowViewState) => WorkflowViewState): void {
  workflowState = updater(workflowState);
  emitWorkflowState();
}

const useWorkflowStoreMock = Object.assign(
  (selector?: (state: WorkflowViewState) => unknown) => {
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

jest.mock('../WorkflowGoalPanel', () => ({
  WorkflowGoalPanel: () => createElement('div', { 'data-testid': 'goal-panel' }, 'goal-panel'),
}));

jest.mock('../WorkflowExecutionBar', () => ({
  WorkflowExecutionBar: () => createElement('div', { 'data-testid': 'execution-bar' }, 'execution-bar'),
}));

jest.mock('../WorkflowCanvas', () => ({
  WorkflowCanvas: ({
    selectedAgentId,
    onAgentSelect,
  }: {
    selectedAgentId: string | null;
    onAgentSelect: (id: string | null) => void;
  }) => createElement(
    'div',
    { 'data-testid': 'workflow-canvas' },
    createElement('span', null, `selected:${selectedAgentId ?? 'none'}`),
    createElement('button', { onClick: () => onAgentSelect('agent-1') }, 'select-agent-1'),
  ),
}));

jest.mock('../WorkflowOutputPanel', () => ({
  WorkflowOutputPanel: () => createElement('div', { 'data-testid': 'workflow-output' }, 'workflow-output'),
}));

jest.mock('../WorkflowRunHistory', () => ({
  WorkflowRunHistory: () => createElement('div', { 'data-testid': 'workflow-history' }, 'workflow-history'),
}));

jest.mock('../AgentConfigPanel', () => ({
  AgentConfigPanel: ({ agentId }: { agentId: string }) => createElement('div', { 'data-testid': 'agent-config-panel' }, `agent-config-panel:${agentId}`),
}));

import { WorkflowView } from '../WorkflowView';

function buildWorkflowInstance() {
  return {
    id: 'workflow-1',
    agents: [
      {
        id: 'agent-1',
        name: 'Agent One',
        task: 'Ship the feature',
        taskPrompt: 'Implement the requested workflow behavior',
        taskInstruction: 'Keep the workflow stable.',
      },
    ],
  };
}

function createWorkflowState(hasInstance: boolean = true) {
  return {
    currentInstanceId: hasInstance ? 'workflow-1' : null,
    instances: hasInstance ? [buildWorkflowInstance()] : [],
    createInstance: () => {
      setWorkflowState((state) => ({
        ...state,
        currentInstanceId: 'workflow-1',
        instances: [buildWorkflowInstance()],
      }));
    },
    updateAgent: jest.fn(),
  };
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text)) as HTMLButtonElement;
}

describe('WorkflowView', () => {
  let harness: ReturnType<typeof createDomHarness>;

  beforeEach(() => {
    workflowState = createWorkflowState(true);
    listeners.clear();
    harness = createDomHarness();
  });

  afterEach(async () => {
    listeners.clear();
    await harness.cleanup();
    jest.clearAllMocks();
  });

  it('renders the empty state and transitions into the workflow layout after creating an instance', async () => {
    workflowState = createWorkflowState(false);

    await harness.render(createElement(WorkflowView));
    expect(harness.container.textContent).toContain('No Active Workflow');

    await clickElement(findButtonByText(harness.container, 'workflow.newWorkflow'), harness.window);

    expect(harness.container.textContent).not.toContain('No Active Workflow');
    expect(harness.container.textContent).toContain('goal-panel');
    expect(harness.container.textContent).toContain('execution-bar');
    expect(harness.container.textContent).toContain('workflow-history');
  });

  it('clears the selected agent when that agent disappears from the current instance', async () => {
    await harness.render(createElement(WorkflowView));
    await clickElement(findButtonByText(harness.container, 'select-agent-1'), harness.window);

    expect(harness.container.textContent).toContain('agent-config-panel:agent-1');
    expect(harness.container.textContent).toContain('Agent One');

    setWorkflowState((state) => ({
      ...state,
      instances: [
        {
          ...state.instances[0],
          agents: [],
        },
      ],
    }));
    await flushEffects();

    expect(harness.container.textContent).not.toContain('agent-config-panel:agent-1');
    expect(harness.container.textContent).toContain('selected:none');
  });

  it('wires the main workflow regions together and expands the output panel on demand', async () => {
    await harness.render(createElement(WorkflowView));

    expect(harness.container.textContent).toContain('goal-panel');
    expect(harness.container.textContent).toContain('execution-bar');
    expect(harness.container.textContent).toContain('workflow-history');
    expect(harness.container.textContent).toContain('selected:none');
    expect(harness.container.textContent).not.toContain('workflow-output');

    await clickElement(findButtonByText(harness.container, 'workflow.output.expand'), harness.window);

    expect(harness.container.textContent).toContain('workflow-output');
  });
});
