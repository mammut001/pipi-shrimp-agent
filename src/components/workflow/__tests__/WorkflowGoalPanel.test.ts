import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseWorkflowStore = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: unknown) => mockUseWorkflowStore(selector),
}));

import { WorkflowGoalPanel } from '../WorkflowGoalPanel';

function createStoreState() {
  return {
    currentInstanceId: 'workflow-1',
    instances: [
      {
        id: 'workflow-1',
        projectGoal: 'Ship workflow layout fix',
        successCriteria: 'Canvas stays visible',
        goalEvaluatorAgentId: 'agent-goal',
        maxGoalIterations: 5,
        agents: [
          {
            id: 'agent-goal',
            name: 'Goal Evaluator',
            role: 'goal-evaluator',
          },
        ],
      },
    ],
    updateInstanceMeta: jest.fn(),
  };
}

describe('WorkflowGoalPanel', () => {
  beforeEach(() => {
    mockUseWorkflowStore.mockImplementation((selector: (state: ReturnType<typeof createStoreState>) => unknown) =>
      selector(createStoreState())
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the project goal form controls in a normal top panel layout', () => {
    const markup = renderToStaticMarkup(createElement(WorkflowGoalPanel));

    expect(markup).toContain('workflow.goalPanel.projectGoal');
    expect(markup.match(/<textarea/g)?.length).toBe(1);
    expect(markup).not.toContain('<select');
    expect(markup).not.toContain('type="number"');
    expect(markup).toContain('workflow.goalPanel.expandConfig');
    expect(markup).toContain('h-20');
  });
});
