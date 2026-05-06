import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseWorkflowStore = jest.fn();
const mockWorkflowStart = jest.fn();
const mockWorkflowStop = jest.fn();
const mockWorkflowGetIsRunning = jest.fn(() => false);

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: unknown) => mockUseWorkflowStore(selector),
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
        maxGoalIterations: 5,
        activeRunId: null,
        workflowRuns: [],
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
  });
});
