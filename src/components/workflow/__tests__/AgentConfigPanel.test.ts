import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseWorkflowStore = jest.fn();
const mockUseSettingsStore = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: unknown) => mockUseSettingsStore(selector),
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: (selector: unknown) => mockUseWorkflowStore(selector),
  selectAgentIncomingConnections: (instance: { connections?: Array<{ targetAgentId: string }> } | null, agentId: string) =>
    (instance?.connections ?? []).filter((connection) => connection.targetAgentId === agentId),
  selectAgentOutputRoutes: (instance: { connections?: Array<{ id: string; sourceAgentId: string; condition: string; keyword?: string; keywordMode?: string; targetAgentId: string }> } | null, agentId: string) =>
    (instance?.connections ?? [])
      .filter((connection) => connection.sourceAgentId === agentId)
      .map((connection) => ({
        id: connection.id,
        condition: connection.condition,
        keyword: connection.keyword,
        keywordMode: connection.keywordMode,
        targetAgentId: connection.targetAgentId,
      })),
}));

import { AgentConfigPanel } from '../AgentConfigPanel';

function createWorkflowState() {
  return {
    currentInstanceId: 'workflow-1',
    isRunning: true,
    instances: [
      {
        id: 'workflow-1',
        name: 'Workflow 1',
        projectGoal: 'Ship workflow hardening',
        successCriteria: '',
        goalEvaluatorAgentId: null,
        maxGoalIterations: 5,
        workflowRuns: [],
        activeRunId: null,
        dirtyAgentIds: [],
        createdAt: 0,
        updatedAt: 0,
        connections: [
          {
            id: 'c1',
            sourceAgentId: 'agent-1',
            targetAgentId: 'agent-2',
            condition: 'onComplete',
            type: 'sequential',
          },
        ],
        agents: [
          {
            id: 'agent-1',
            name: 'Writer',
            position: { x: 0, y: 0 },
            status: 'idle',
            outputRoutes: [],
            execution: { mode: 'single' },
            role: 'writer',
            notifyOnComplete: [],
            retryPolicy: { maxAttempts: 3, backoffMs: 1500, fallbackConfigIds: [] },
            visionPolicy: 'inherit',
          },
          {
            id: 'agent-2',
            name: 'Developer',
            position: { x: 0, y: 0 },
            status: 'idle',
            outputRoutes: [],
            execution: { mode: 'single' },
            role: 'developer',
            notifyOnComplete: [],
            retryPolicy: { maxAttempts: 3, backoffMs: 1500, fallbackConfigIds: [] },
            visionPolicy: 'inherit',
          },
        ],
      },
    ],
    updateAgent: jest.fn(),
    addOutputRoute: jest.fn(),
    removeOutputRoute: jest.fn(),
    setAgentInputFrom: jest.fn(),
  };
}

describe('AgentConfigPanel', () => {
  beforeEach(() => {
    mockUseWorkflowStore.mockImplementation((selector: (state: ReturnType<typeof createWorkflowState>) => unknown) =>
      selector(createWorkflowState())
    );
    mockUseSettingsStore.mockImplementation((selector: (state: { apiConfigs: Array<{ id: string; name: string; provider: string; model: string }>; availableModels: Record<string, string[]> }) => unknown) =>
      selector({ apiConfigs: [], availableModels: {} })
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows a topology lock warning and disables route controls during a run', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentConfigPanel, {
        agentId: 'agent-1',
        onClose: jest.fn(),
      })
    );

    expect(markup).toContain('工作流运行中，当前不能修改上下游连接与输出路由。');
    expect((markup.match(/disabled=""/g) || []).length).toBeGreaterThan(0);
  });
});
