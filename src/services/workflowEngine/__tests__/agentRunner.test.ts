import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WorkflowAgent } from '@/types/workflow';

const mockRunHeadlessAgentTurn = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: jest.fn(async () => () => undefined),
  }),
}));

const mockSettingsState = {
  apiConfigs: [
    {
      id: 'cfg-custom',
      provider: 'openai-compatible',
      apiKey: 'sk-test-key-12345',
      model: 'gpt-4o-custom',
      baseUrl: 'https://api.example.com/v1',
      apiFormat: 'openai',
    },
  ],
  getActiveConfig: jest.fn(() => ({
    id: 'cfg-default',
    provider: 'anthropic',
    apiKey: 'sk-ant-test-key',
    model: 'claude-3-5-sonnet',
    baseUrl: '',
    apiFormat: 'anthropic',
  })),
  windowsShellProfile: 'auto',
};

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (params: any) => mockRunHeadlessAgentTurn(params),
}));

import { runAgentWithRetry } from '../agentRunner';
import { WorkflowTranscriptManager } from '../transcript';

describe('workflowEngine agentRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunHeadlessAgentTurn.mockReset();
    mockRunHeadlessAgentTurn.mockResolvedValue({
      finalText: 'Agent execution finished successfully',
      finalReasoning: '',
      toolBudgetSummary: { totalRounds: 1 },
    });
  });

  it('passes typed provider and apiFormat to runHeadlessAgentTurn when resolving agent config', async () => {
    const agent: WorkflowAgent = {
      id: 'agent-1',
      name: 'Test Agent',
      position: { x: 0, y: 0 },
      status: 'idle',
      outputRoutes: [],
      execution: { mode: 'single' },
      model: {
        configId: 'cfg-custom',
      },
    };

    const transcript = new WorkflowTranscriptManager();
    const result = await runAgentWithRetry(
      agent,
      'Execute test task',
      {
        runId: 'run-123',
        transcript,
      },
    );

    expect(result).toBe('Agent execution finished successfully');
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(1);

    const callArg = mockRunHeadlessAgentTurn.mock.calls[0][0];
    expect(callArg.agentConfig).toEqual(
      expect.objectContaining({
        configId: 'cfg-custom',
        provider: 'openai-compatible',
        apiFormat: 'openai',
        apiKey: 'sk-test-key-12345',
        model: 'gpt-4o-custom',
        baseUrl: 'https://api.example.com/v1',
      }),
    );
  });

  it('falls back to active config with correct provider and apiFormat types', async () => {
    const agent: WorkflowAgent = {
      id: 'agent-2',
      name: 'Default Agent',
      position: { x: 0, y: 0 },
      status: 'idle',
      outputRoutes: [],
      execution: { mode: 'single' },
    };

    const transcript = new WorkflowTranscriptManager();
    await runAgentWithRetry(
      agent,
      'Execute default task',
      {
        runId: 'run-456',
        transcript,
      },
    );

    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(1);
    const callArg = mockRunHeadlessAgentTurn.mock.calls[0][0];
    expect(callArg.agentConfig).toEqual(
      expect.objectContaining({
        configId: 'cfg-default',
        provider: 'anthropic',
        apiFormat: 'anthropic',
        model: 'claude-3-5-sonnet',
      }),
    );
  });

  it('passes maxToolRounds into runHeadlessAgentTurn from agent execution configuration or fallback default', async () => {
    const agent: WorkflowAgent = {
      id: 'agent-capped',
      name: 'Capped Agent',
      position: { x: 0, y: 0 },
      status: 'idle',
      outputRoutes: [],
      execution: { mode: 'single' },
    };

    const transcript = new WorkflowTranscriptManager();
    await runAgentWithRetry(
      agent,
      'Execute capped task',
      {
        runId: 'run-789',
        transcript,
        maxToolRounds: 4,
      },
    );

    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledTimes(1);
    const callArg = mockRunHeadlessAgentTurn.mock.calls[0][0];
    expect(callArg.maxToolRounds).toBe(4);
  });
});
