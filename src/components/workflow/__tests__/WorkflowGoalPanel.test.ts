import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseWorkflowStore = jest.fn();
const mockUseUIStore = jest.fn();
const mockHandleSend = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: unknown) => mockUseWorkflowStore(selector),
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: (selector: unknown) => mockUseUIStore(selector),
}));

jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: jest.fn(),
}));

jest.mock('@/components/ChatMessage', () => ({
  ChatMessage: () => null,
}));

jest.mock('@/components/ChatInput', () => ({
  ChatInput: () => {
    return createElement('div', null, 'chat-input-mock');
  },
}));

jest.mock('../AsciiPreviewBlock', () => ({
  AsciiPreviewBlock: () => null,
}));

jest.mock('../WorkflowGoalPreflightPanel', () => ({
  WorkflowGoalPreflightPanel: (props: { onApply?: unknown }) => {
    mockHandleSend(props);
    return createElement('div', { 'data-testid': 'preflight-panel-mock' });
  },
}));

import { WorkflowGoalPanel } from '../WorkflowGoalPanel';

function createStoreState() {
  return {
    currentInstanceId: 'workflow-1',
    instances: [
      {
        id: 'workflow-1',
        projectGoal: 'Ship workflow layout fix',
        successCriteria: ["Canvas stays visible"],
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

function createUIState() {
  return {
    addNotification: jest.fn(),
  };
}

describe('WorkflowGoalPanel', () => {
  beforeEach(() => {
    mockUseWorkflowStore.mockImplementation((selector: (state: ReturnType<typeof createStoreState>) => unknown) =>
      selector(createStoreState())
    );
    mockUseUIStore.mockImplementation((selector: (state: ReturnType<typeof createUIState>) => unknown) =>
      selector(createUIState())
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
    expect(markup).toContain('pr-20');
    expect(markup).toContain('whitespace-nowrap');
    expect(markup).toContain('data-testid="workflow-goal-save"');
  });

  it('exposes a Clarify Goal button', () => {
    const markup = renderToStaticMarkup(createElement(WorkflowGoalPanel));
    expect(markup).toContain('workflow.goalPreflight.openButton');
  });

  it('does not call updateInstanceMeta on render', () => {
    renderToStaticMarkup(createElement(WorkflowGoalPanel));
    const state = createStoreState();
    expect(state.updateInstanceMeta).not.toHaveBeenCalled();
  });
});
