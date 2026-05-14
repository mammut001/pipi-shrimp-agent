import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseWorkflowStore = jest.fn();
const mockUseUIStore = jest.fn();
const mockWorkflowStart = jest.fn();
const mockWorkflowStop = jest.fn();
const mockWorkflowGetIsRunning = jest.fn(() => false);

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: unknown) => mockUseWorkflowStore(selector),
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: (selector: unknown) => mockUseUIStore(selector),
}));

jest.mock('@/services/workflowEngine', () => ({
  workflowEngine: {
    start: () => mockWorkflowStart(),
    stop: () => mockWorkflowStop(),
    getIsRunning: () => mockWorkflowGetIsRunning(),
  },
}));

import { WorkflowExecutionBar } from '../WorkflowExecutionBar';

function createStoreState() {
  return {
    currentInstanceId: 'workflow-1',
    instances: [
      {
        id: 'workflow-1',
        projectGoal: '',
        successCriteria: '',
        goalEvaluatorAgentId: null,
        maxGoalIterations: 5,
        activeRunId: null,
        workflowRuns: [],
        connections: [],
        dirtyAgentIds: [],
        name: 'Workflow 1',
        createdAt: 0,
        updatedAt: 0,
        agents: [],
      },
    ],
    isRunning: false,
    currentRunningAgentId: null,
    clearCanvas: jest.fn(),
  };
}

describe('WorkflowExecutionBar', () => {
  beforeEach(() => {
    mockUseWorkflowStore.mockImplementation((selector: (state: ReturnType<typeof createStoreState>) => unknown) =>
      selector(createStoreState())
    );
    mockUseUIStore.mockImplementation((selector: (state: { addNotification: jest.Mock }) => unknown) =>
      selector({ addNotification: jest.fn() })
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps disabled run controls inside the toolbar flow', () => {
    const markup = renderToStaticMarkup(createElement(WorkflowExecutionBar));

    expect(markup).toContain('shrink-0 border-b border-gray-200 bg-white px-4 py-2');
    expect(markup).toContain('workflow.run');
    expect(markup).toContain('workflow.stop');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('ml-auto flex shrink-0 items-center gap-3');
    expect(markup).toContain('至少需要一个可执行的 Agent');
  });

  it('shows the running agent label and sequence position while executing', () => {
    mockUseWorkflowStore.mockImplementation((selector: (state: ReturnType<typeof createStoreState>) => unknown) =>
      selector({
        ...createStoreState(),
        isRunning: true,
        currentRunningAgentId: 'agent-2',
        instances: [
          {
            ...createStoreState().instances[0],
            projectGoal: 'Ship workflow hardening',
            agents: [
              { id: 'agent-1', name: 'Writer', position: { x: 0, y: 0 }, status: 'completed', outputRoutes: [], execution: { mode: 'single' }, role: 'writer' },
              { id: 'agent-2', name: 'Developer', position: { x: 0, y: 0 }, status: 'running', outputRoutes: [], execution: { mode: 'single' }, role: 'developer' },
            ],
          },
        ],
      })
    );

    const markup = renderToStaticMarkup(createElement(WorkflowExecutionBar));

    expect(markup).toContain('2/2');
    expect(markup).toContain('Developer');
  });
});
