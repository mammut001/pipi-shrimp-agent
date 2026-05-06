import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseWorkflowStore = jest.fn();
const mockUseUIStore = jest.fn();
const mockUseSettingsStore = jest.fn();
const mockInvoke = jest.fn();

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, payload?: unknown) => mockInvoke(command, payload),
}));

jest.mock('@xyflow/react/dist/style.css', () => ({}), { virtual: true });

jest.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, className }: { children: ReactNode; className?: string }) =>
    createElement('div', { className }, children),
  Controls: () => createElement('div', null, 'Controls'),
  Background: () => createElement('div', null, 'Background'),
  BackgroundVariant: { Dots: 'dots' },
  useNodesState: (nodes: unknown[]) => [nodes, jest.fn(), jest.fn()],
  useEdgesState: (edges: unknown[]) => [edges, jest.fn(), jest.fn()],
  addEdge: (_edge: unknown, edges: unknown[]) => edges,
  MarkerType: { ArrowClosed: 'arrow' },
  Panel: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  useNodesInitialized: () => false,
  useReactFlow: () => ({ fitView: jest.fn() }),
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: (selector?: unknown) => mockUseWorkflowStore(selector),
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: (selector: unknown) => mockUseUIStore(selector),
}));

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: unknown) => mockUseSettingsStore(selector),
}));

jest.mock('@/services/workflowEngine', () => ({
  workflowEngine: {
    getWorkingDirectory: () => '',
  },
}));

jest.mock('../AgentNode', () => ({
  AgentNode: () => null,
}));

jest.mock('../CustomEdge', () => ({
  CustomEdge: () => null,
}));

jest.mock('../AgentTemplateDrawer', () => ({
  AgentTemplateDrawer: () => null,
}));

import { WorkflowCanvas } from '../WorkflowCanvas';

function createWorkflowState() {
  return {
    currentInstanceId: 'workflow-1',
    instances: [
      {
        id: 'workflow-1',
        agents: [],
        connections: [],
      },
    ],
    addAgent: jest.fn(),
    removeAgent: jest.fn(),
    updateAgentPosition: jest.fn(),
    createA_B_C_Workflow: jest.fn(),
    clearCanvas: jest.fn(),
  };
}

describe('WorkflowCanvas', () => {
  beforeEach(() => {
    mockUseWorkflowStore.mockImplementation((selector?: (state: ReturnType<typeof createWorkflowState>) => unknown) => {
      const state = createWorkflowState();
      return selector ? selector(state) : state;
    });
    mockUseUIStore.mockImplementation((selector: (state: { currentView: string; addNotification: jest.Mock }) => unknown) =>
      selector({ currentView: 'workflow', addNotification: jest.fn() })
    );
    mockUseSettingsStore.mockImplementation((selector: (state: { apiConfigs: unknown[] }) => unknown) =>
      selector({ apiConfigs: [] })
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows a canvas empty state even when there are zero agents', () => {
    const markup = renderToStaticMarkup(
      createElement(WorkflowCanvas, {
        selectedAgentId: null,
        onAgentSelect: jest.fn(),
      })
    );

    expect(markup).toContain('workflow.canvas.emptyState');
    expect(markup).toContain('h-full w-full bg-gray-50');
    expect(markup).toContain('pointer-events-none absolute inset-0');
  });
});
