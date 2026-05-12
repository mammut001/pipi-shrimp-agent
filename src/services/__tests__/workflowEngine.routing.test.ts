jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({}),
}));

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({}),
  },
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: {
    getState: () => ({}),
  },
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: {
    getState: () => ({ addNotification: jest.fn() }),
  },
}));

jest.mock('@/store/taskRegistryStore', () => ({
  registerDiagnosticsTask: jest.fn(),
  registerDiagnosticsTaskCancel: jest.fn(),
  updateDiagnosticsTask: jest.fn(),
}));

import WorkflowEngine from '../workflowEngine';
import type { WorkflowAgent } from '@/types/workflow';

function createAgent(overrides: Partial<WorkflowAgent>): WorkflowAgent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'Agent',
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    ...overrides,
  };
}

describe('WorkflowEngine routing', () => {
  it('terminates when a marker appears without an explicit output route', () => {
    const engine = new WorkflowEngine() as any;
    const reviewer = createAgent({ id: 'reviewer', name: '校对' });
    const editor = createAgent({ id: 'editor', name: '编辑' });
    const proofreader = createAgent({ id: 'proofreader', name: '审稿' });

    expect(
      engine.evaluateNextAgent(
        reviewer,
        'Please revise this.\n<NEEDS_REWORK>',
        [],
        [reviewer, editor, proofreader],
        'completed',
      ),
    ).toBeNull();
  });

  it('routes through an explicit outputContains rule when configured', () => {
    const engine = new WorkflowEngine() as any;
    const reviewer = createAgent({
      id: 'reviewer',
      name: '校对',
    });
    const editor = createAgent({ id: 'editor', name: '编辑' });
    const proofreader = createAgent({ id: 'proofreader', name: '审稿' });
    const connections = [{
      id: 'route-1',
      sourceAgentId: 'reviewer',
      targetAgentId: 'editor',
      condition: 'outputContains' as const,
      keyword: '<NEEDS_REWORK>',
      keywordMode: 'includes' as const,
      type: 'sequential' as const,
    }];

    expect(
      engine.evaluateNextAgent(
        reviewer,
        'Please revise this.\n<NEEDS_REWORK>',
        connections,
        [reviewer, editor, proofreader],
        'completed',
      ),
    ).toBe(editor);
  });
});
