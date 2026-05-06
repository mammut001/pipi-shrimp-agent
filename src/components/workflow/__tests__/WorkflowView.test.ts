import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseWorkflowStore = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: unknown) => mockUseWorkflowStore(selector),
}));

jest.mock('../WorkflowGoalPanel', () => ({
  WorkflowGoalPanel: () => createElement('div', { 'data-testid': 'goal-panel' }, 'goal-panel'),
}));

jest.mock('../WorkflowExecutionBar', () => ({
  WorkflowExecutionBar: () => createElement('div', { 'data-testid': 'execution-bar' }, 'execution-bar'),
}));

jest.mock('../WorkflowCanvas', () => ({
  WorkflowCanvas: () => createElement('div', { 'data-testid': 'workflow-canvas' }, 'workflow.canvas.emptyState'),
}));

jest.mock('../WorkflowOutputPanel', () => ({
  WorkflowOutputPanel: () => createElement('div', { 'data-testid': 'workflow-output' }, 'workflow-output'),
}));

jest.mock('../WorkflowRunHistory', () => ({
  WorkflowRunHistory: () => createElement('div', { 'data-testid': 'workflow-history' }, 'workflow-history'),
}));

jest.mock('../AgentConfigPanel', () => ({
  AgentConfigPanel: () => createElement('div', { 'data-testid': 'agent-config-panel' }, 'agent-config'),
}));

import { WorkflowView } from '../WorkflowView';

function createStoreState() {
  return {
    currentInstanceId: 'workflow-1',
    instances: [
      {
        id: 'workflow-1',
        agents: [],
      },
    ],
  };
}

describe('WorkflowView', () => {
  beforeEach(() => {
    mockUseWorkflowStore.mockImplementation((selector: (state: ReturnType<typeof createStoreState>) => unknown) =>
      selector(createStoreState())
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the center flex stack with a visible canvas region when there are no agents', () => {
    const markup = renderToStaticMarkup(createElement(WorkflowView));

    expect(markup).toContain('flex h-full min-h-0 min-w-0 overflow-hidden bg-white');
    expect(markup).toContain('flex flex-1 min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden');
    expect(markup).toContain('workflow.canvas.emptyState');
    expect(markup).toContain('min-h-[420px]');
    expect(markup).toContain('h-12');
  });
});
