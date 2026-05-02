import { describe, expect, it, jest } from '@jest/globals';

import { handleToolBatchRequest, type ToolBatchExecutionDeps } from '../chatToolExecution';
import type { ChatState } from '../../../types/chat';
import type { EngineEvent } from '../../../core/types';

function createChatState(): ChatState {
  return {
    sessions: [{
      id: 'session-1',
      title: 'Chat 1',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      permissionMode: 'standard',
    }],
    projects: [],
    currentSessionId: 'session-1',
    isStreaming: false,
    isInitialized: true,
    streamingContent: '',
    streamingReasoning: '',
    error: null,
    streamingTimeoutId: null,
    lastUiUpdateTime: 0,
    pendingToolCalls: 0,
    pendingToolResults: [],
    streamingSessionId: null,
    currentSession: () => null,
    currentMessages: () => [],
    getSessionsByProject: () => [],
    init: jest.fn(async () => {}),
    startSession: jest.fn(async () => 'session-1'),
    sendMessage: jest.fn(async () => {}),
    generateBrowserResultResponse: jest.fn(async () => {}),
    stopGeneration: jest.fn(async () => {}),
    retryLastMessage: jest.fn(async () => {}),
    addMessage: jest.fn(),
    addMessageToSession: jest.fn(async () => {}),
    updateLastMessage: jest.fn(async () => {}),
    updateMessageContent: jest.fn(async () => {}),
    appendStreamingContent: jest.fn(),
    setStreaming: jest.fn(),
    setError: jest.fn(),
    clearError: jest.fn(),
    loadSessions: jest.fn(),
    selectSession: jest.fn(),
    deleteSession: jest.fn(async () => {}),
    deleteSessions: jest.fn(async () => {}),
    updateSessionCwd: jest.fn(async () => {}),
    updateSessionProject: jest.fn(async () => {}),
    createProject: jest.fn(async () => {}),
    deleteProject: jest.fn(async () => {}),
    renameProject: jest.fn(async () => {}),
    setSessionWorkDir: jest.fn(async () => null),
    clearSessionWorkDir: jest.fn(async () => {}),
    writeToWorkDir: jest.fn(async () => null),
    getWorkDirIndex: jest.fn(async () => []),
    addSessionWorkingFiles: jest.fn(async () => {}),
    removeSessionWorkingFile: jest.fn(async () => {}),
    clearSessionWorkingFiles: jest.fn(async () => {}),
    updateSessionPermissionMode: jest.fn(async () => {}),
    renameSession: jest.fn(async () => {}),
    getDailyTokenStats: jest.fn(async () => []),
    getMonthlyTokenStats: jest.fn(async () => []),
    getModelTokenStats: jest.fn(async () => []),
    getTotalTokenStats: jest.fn(async () => ({ input: 0, output: 0, total: 0 })),
    resetTokenEstimate: jest.fn(async () => {}),
  };
}

function createDeps(overrides: Partial<ToolBatchExecutionDeps> = {}): ToolBatchExecutionDeps {
  const mockUiState = {
    activeSkill: null,
    setActiveSkill: jest.fn(),
    setTaskProgress: jest.fn(),
    updateTaskStep: jest.fn(),
    showQuestionnaire: jest.fn(async () => 'user response'),
    waitForPermission: jest.fn(async () => true),
    addNotification: jest.fn(),
  };

  return {
    uiStore: { getState: () => mockUiState } as unknown as ToolBatchExecutionDeps['uiStore'],
    createExecutor: () => ({
      executeBatch: jest.fn(async () => ({
        results: [{ id: 'tool-1', content: 'tool output', is_error: false }],
        totalExecutionTime: 1,
        errors: [],
      })),
    }),
    partitionTools: jest.fn((tools) => ({ concurrent: tools, serial: [] })),
    runPreToolUseHooks: jest.fn(async () => ({ approved: true })),
    runPostToolUseHooks: jest.fn(async () => {}),
    normalizeResumeWorkspaceToolArgs: jest.fn((_, args) => args),
    normalizeCompileTypstArgs: jest.fn(async (args) => args),
    registerArtifactsFromToolResults: jest.fn(async () => {}),
    loadArtifactDetector: jest.fn(async () => ({ detectAndRegisterArtifacts: jest.fn() })),
    invoke: jest.fn(async () => 'invoke result') as ToolBatchExecutionDeps['invoke'],
    recordToolForReactiveCompact: jest.fn(),
    t: ((key: string) => key) as ToolBatchExecutionDeps['t'],
    getCurrentAgentContext: jest.fn(() => null),
    runAgentBackground: jest.fn(async () => 'bg-agent'),
    runAgentSync: jest.fn(async () => ({ success: true, content: 'sync-result' })),
    loadSwarmModule: jest.fn(async () => ({
      getActiveRunForChatSession: jest.fn(() => null),
      startRun: jest.fn(() => ({ id: 'run-1' })),
      getTeamByName: jest.fn(() => null),
      createTeam: jest.fn(async () => ({ team: { id: 'team-1', leaderId: 'leader-1' }, leader: { id: 'leader-1' } })),
      spawnAgent: jest.fn(async () => ({ agent: { id: 'agent-1' } })),
      enqueuePermissionInUI: jest.fn(async () => true),
      failAgent: jest.fn(),
      reconcileRunForChatSession: jest.fn(),
      createTask: jest.fn(() => ({ id: 'task-1' })),
      startAgent: jest.fn(),
      startTask: jest.fn(),
      recordUserPrompt: jest.fn(),
    })) as ToolBatchExecutionDeps['loadSwarmModule'],
    loadInboxCoordinator: jest.fn(async () => ({ onAgentStarted: jest.fn(), onTeamCreated: jest.fn() })),
    loadSwarmStore: jest.fn(async () => ({ useSwarmStore: { getState: () => ({ init: jest.fn() }) } })),
    ...overrides,
  };
}

describe('chatToolExecution', () => {
  it('executes concurrent read-only tools and resolves results back to the stream', async () => {
    const resolved = jest.fn();
    const deps = createDeps();
    const state = createChatState();
    const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
      type: 'tool_batch_request',
      tools: [{ id: 'tool-1', name: 'read_file', arguments: '{}' }],
      _resolveAll: resolved,
    };

    const results = await handleToolBatchRequest({
      chunk,
      activeSessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      get: () => state,
      set: jest.fn(),
      ensureSessionWorkDir: async () => null,
    }, deps);

    expect(results).toEqual([{ id: 'tool-1', content: 'tool output', toolName: 'read_file', toolArgs: '{}' }]);
    expect(resolved).toHaveBeenCalledWith([{ id: 'tool-1', content: 'tool output' }]);
    expect(deps.registerArtifactsFromToolResults).toHaveBeenCalled();
  });

  it('executes AskUserQuestion serially through the questionnaire bridge', async () => {
    const resolved = jest.fn();
    const showQuestionnaire = jest.fn(async () => 'filled form');
    const deps = createDeps({
      uiStore: { getState: () => ({
        activeSkill: null,
        setActiveSkill: jest.fn(),
        setTaskProgress: jest.fn(),
        updateTaskStep: jest.fn(),
        showQuestionnaire,
        waitForPermission: jest.fn(async () => true),
        addNotification: jest.fn(),
      }) } as unknown as ToolBatchExecutionDeps['uiStore'],
      partitionTools: jest.fn(() => ({ concurrent: [], serial: [{ id: 'tool-2', name: 'AskUserQuestion', arguments: {} }] })),
    });
    const state = createChatState();
    const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
      type: 'tool_batch_request',
      tools: [{
        id: 'tool-2',
        name: 'AskUserQuestion',
        arguments: JSON.stringify({ title: 'Need input', description: 'desc', fields: [{ id: 'x' }] }),
      }],
      _resolveAll: resolved,
    };

    const results = await handleToolBatchRequest({
      chunk,
      activeSessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      get: () => state,
      set: jest.fn(),
      ensureSessionWorkDir: async () => null,
    }, deps);

    expect(showQuestionnaire).toHaveBeenCalledWith('session-1', expect.objectContaining({ toolCallId: 'tool-2' }));
    expect(results).toEqual([{ id: 'tool-2', content: 'filled form', toolName: 'AskUserQuestion', toolArgs: chunk.tools[0].arguments }]);
    expect(resolved).toHaveBeenCalledWith([{ id: 'tool-2', content: 'filled form' }]);
  });
});
