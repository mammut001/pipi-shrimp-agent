import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@/services/StreamingToolExecutor', () => ({
  StreamingToolExecutor: jest.fn(),
  partitionTools: jest.fn((tools: unknown[]) => ({ concurrent: tools, serial: [] })),
}));

jest.mock('@/services/multiagent/agentContext', () => ({
  getCurrentAgentContext: jest.fn(() => null),
}));

jest.mock('@/services/multiagent/subagent', () => ({
  runAgentBackground: jest.fn(async () => 'bg-agent'),
  runAgentSync: jest.fn(async () => ({ success: true, content: 'sync-result' })),
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      activeSkill: null,
      setActiveSkill: jest.fn(),
      setTaskProgress: jest.fn(),
      updateTaskStep: jest.fn(),
      clearTaskProgress: jest.fn(),
      showQuestionnaire: jest.fn(async () => 'user response'),
      waitForPermission: jest.fn(async () => true),
      addNotification: jest.fn(),
    }),
  },
}));

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
  configurable: true,
});

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
      // Mirror the legacy single-folder test fixture: a session with
      // only `permissionMode: 'standard'` (no executionMode field).
      // The canonical resolver still maps this to agent/auto-edits.
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
    ensureSessionWorkDir: jest.fn(async () => null),
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
  } as unknown as ChatState;
}

function createChatStateWithMode(permissionMode: ChatState['sessions'][number]['permissionMode']): ChatState {
  const state = createChatState();
  state.sessions[0].permissionMode = permissionMode;
  // Mirror the 5-mode id so the canonical resolver agrees with the
  // legacy permissionMode the test wants to exercise. Without this,
  // `resolveSessionExecutionModeId` would fall back to a different
  // 5-mode id and the hook chain would diverge from the test's
  // intent.
  state.sessions[0].executionMode = legacyPermissionModeToExecutionMode(permissionMode);
  return state;
}

function legacyPermissionModeToExecutionMode(
  permissionMode: ChatState['sessions'][number]['permissionMode'],
): 'ask' | 'plan' | 'debug' | 'agent' | 'bypass' {
  switch (permissionMode) {
    case 'plan-only':
      return 'plan';
    case 'bypass':
      return 'bypass';
    case 'auto-edits':
      return 'agent';
    case 'standard':
    default:
      return 'agent';
  }
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
    partitionTools: jest.fn((tools: any) => ({ concurrent: tools, serial: [] })),
    runPreToolUseHooks: jest.fn(async () => ({ approved: true })),
    runPostToolUseHooks: jest.fn(async () => {}),
    normalizeResumeWorkspaceToolArgs: jest.fn((_toolName: any, args: any) => args),
    normalizeCompileTypstArgs: jest.fn(async (args: any) => args),
    registerArtifactsFromToolResults: jest.fn(async () => {}),
    loadArtifactDetector: jest.fn(async () => ({ detectAndRegisterArtifacts: jest.fn() })) as unknown as ToolBatchExecutionDeps['loadArtifactDetector'],
    invoke: jest.fn(async () => 'invoke result') as ToolBatchExecutionDeps['invoke'],
    recordToolForReactiveCompact: jest.fn(),
    t: ((key: string) => key) as ToolBatchExecutionDeps['t'],
    getCurrentAgentContext: jest.fn(() => null),
    runAgentBackground: jest.fn(async () => 'bg-agent'),
    runAgentSync: jest.fn(async () => ({ success: true, content: 'sync-result' })) as unknown as ToolBatchExecutionDeps['runAgentSync'],
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
    })) as unknown as ToolBatchExecutionDeps['loadSwarmModule'],
    loadInboxCoordinator: jest.fn(async () => ({ onAgentStarted: jest.fn(), onTeamCreated: jest.fn() })) as unknown as ToolBatchExecutionDeps['loadInboxCoordinator'],
    loadSwarmStore: jest.fn(async () => ({ useSwarmStore: { getState: () => ({ init: jest.fn() }) } })) as unknown as ToolBatchExecutionDeps['loadSwarmStore'],
    ...overrides,
  } as unknown as ToolBatchExecutionDeps;
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

    expect(showQuestionnaire as jest.Mock).toHaveBeenCalledWith('session-1', expect.objectContaining({ toolCallId: 'tool-2' }));
    expect(results).toEqual([{ id: 'tool-2', content: 'filled form', toolName: 'AskUserQuestion', toolArgs: chunk.tools[0].arguments }]);
    expect(resolved).toHaveBeenCalledWith([{ id: 'tool-2', content: 'filled form' }]);
  });

  it('routes serial execute_command calls through execute_single_tool with assistant source metadata', async () => {
    const resolved = jest.fn();
    const invoke = jest.fn(async () => ({
      content: '{"stdout":"ok","stderr":"","exit_code":0}',
      is_error: false,
    }));
    const deps = createDeps({
      invoke: invoke as ToolBatchExecutionDeps['invoke'],
      partitionTools: jest.fn(() => ({
        concurrent: [],
        serial: [{
          id: 'tool-3',
          name: 'execute_command',
          arguments: { command: 'pwd', cwd: '/tmp/workspace' },
        }],
      })),
    });
    const state = createChatState();
    const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
      type: 'tool_batch_request',
      tools: [{
        id: 'tool-3',
        name: 'execute_command',
        arguments: JSON.stringify({ command: 'pwd', cwd: '/tmp/workspace' }),
      }],
      _resolveAll: resolved,
    };

    const results = await handleToolBatchRequest({
      chunk,
      activeSessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      get: () => state,
      set: jest.fn(),
      ensureSessionWorkDir: async () => '/tmp/workspace',
    }, deps);

    expect(invoke as jest.Mock).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
      toolCallId: 'tool-3',
      name: 'execute_command',
      workDir: '/tmp/workspace',
      sessionId: 'session-1',
      source: 'assistant_tool_call',
    }));
    expect(results).toEqual([expect.objectContaining({
      id: 'tool-3',
      content: '{"stdout":"ok","stderr":"","exit_code":0}',
      toolName: 'execute_command',
      toolArgs: expect.stringContaining('"command":"pwd"'),
    })]);
    expect(resolved).toHaveBeenCalledWith([{ id: 'tool-3', content: '{"stdout":"ok","stderr":"","exit_code":0}' }]);
  });

  it('runs pre-tool hooks for concurrent tools and blocks only the rejected tool', async () => {
    const resolved = jest.fn();
    const runPreToolUseHooks = jest.fn(async ({ toolName }: { toolName: string }) => (
      toolName === 'read_file'
        ? { approved: false, error: 'Path is outside working directory' }
        : { approved: true }
    ));
    const deps = createDeps({
      runPreToolUseHooks,
      createExecutor: () => ({
        executeBatch: jest.fn(async () => ({
          results: [{ id: 'tool-2', content: 'search results', is_error: false }],
          totalExecutionTime: 1,
          errors: [],
        })),
      }),
      partitionTools: jest.fn(() => ({
        concurrent: [
          { id: 'tool-1', name: 'read_file', arguments: { path: '../secret.txt' } },
          { id: 'tool-2', name: 'search_files', arguments: { path: 'src', pattern: 'needle' } },
        ],
        serial: [],
      })),
    });
    const state = createChatState();
    const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
      type: 'tool_batch_request',
      tools: [
        { id: 'tool-1', name: 'read_file', arguments: '{"path":"../secret.txt"}' },
        { id: 'tool-2', name: 'search_files', arguments: '{"path":"src","pattern":"needle"}' },
      ],
      _resolveAll: resolved,
    };

    const results = await handleToolBatchRequest({
      chunk,
      activeSessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      get: () => state,
      set: jest.fn(),
      ensureSessionWorkDir: async () => '/tmp/workspace',
    }, deps);

    expect(runPreToolUseHooks).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      {
        id: 'tool-1',
        content: 'Error: Path is outside working directory',
        toolName: 'read_file',
        toolArgs: '{"path":"../secret.txt"}',
      },
      {
        id: 'tool-2',
        content: 'search results',
        toolName: 'search_files',
        toolArgs: '{"path":"src","pattern":"needle"}',
      },
    ]);
    expect(resolved).toHaveBeenCalledWith([
      { id: 'tool-1', content: 'Error: Path is outside working directory' },
      { id: 'tool-2', content: 'search results' },
    ]);
  });

  it('does not auto-approve execute_command in auto-edits mode when hooks require confirmation', async () => {
    const resolved = jest.fn();
    const waitForPermission = jest.fn(async () => true);
    const invoke = jest.fn(async () => ({
      content: '{"stdout":"ok","stderr":"","exit_code":0}',
      is_error: false,
    }));
    const deps = createDeps({
      uiStore: { getState: () => ({
        activeSkill: null,
        setActiveSkill: jest.fn(),
        setTaskProgress: jest.fn(),
        updateTaskStep: jest.fn(),
        showQuestionnaire: jest.fn(async () => 'user response'),
        waitForPermission,
        addNotification: jest.fn(),
      }) } as unknown as ToolBatchExecutionDeps['uiStore'],
      runPreToolUseHooks: jest.fn(async () => ({ approved: true, requiresConfirmation: true })),
      invoke: invoke as ToolBatchExecutionDeps['invoke'],
      partitionTools: jest.fn(() => ({
        concurrent: [],
        serial: [{
          id: 'tool-4',
          name: 'execute_command',
          arguments: { command: 'pwd', cwd: '/tmp/workspace' },
        }],
      })),
    });
    const state = createChatStateWithMode('auto-edits');
    const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
      type: 'tool_batch_request',
      tools: [{
        id: 'tool-4',
        name: 'execute_command',
        arguments: JSON.stringify({ command: 'pwd', cwd: '/tmp/workspace' }),
      }],
      _resolveAll: resolved,
    };

    await handleToolBatchRequest({
      chunk,
      activeSessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      get: () => state,
      set: jest.fn(),
      ensureSessionWorkDir: async () => '/tmp/workspace',
    }, deps);

    expect(waitForPermission as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tool-4',
      name: 'execute_command',
      arguments: expect.stringContaining('"command":"pwd"'),
      source: 'assistant_tool_call',
      workingDirectory: '/tmp/workspace',
      commandPreview: 'pwd',
    }));
    expect(invoke).toHaveBeenCalled();
  });

  it('passes backend approval tokens and rich permission metadata into serial tool execution', async () => {
    const resolved = jest.fn();
    const waitForPermission = jest.fn(async () => true);
    const updateTaskStep = jest.fn();
    const invoke = jest.fn(async (command: string) => {
      if (command === 'preview_tool_policy') {
        return {
          toolCallId: 'tool-5',
          toolName: 'execute_command',
          decision: 'awaiting_confirmation',
          reason: 'Assistant tool calls need approval for network or package-install commands.',
          approvalToken: 'approval-5',
        };
      }

      if (command === 'execute_single_tool') {
        return {
          content: '{"status":"succeeded","stdout":"ok","stderr":""}',
          is_error: false,
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });
    const deps = createDeps({
      uiStore: { getState: () => ({
        activeSkill: null,
        setActiveSkill: jest.fn(),
        setTaskProgress: jest.fn(),
        updateTaskStep,
        showQuestionnaire: jest.fn(async () => 'user response'),
        waitForPermission,
        addNotification: jest.fn(),
      }) } as unknown as ToolBatchExecutionDeps['uiStore'],
      invoke: invoke as ToolBatchExecutionDeps['invoke'],
      partitionTools: jest.fn(() => ({
        concurrent: [],
        serial: [{
          id: 'tool-5',
          name: 'execute_command',
          arguments: { command: 'curl https://example.com', cwd: '/tmp/workspace' },
        }],
      })),
    });
    const state = createChatState();
    const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
      type: 'tool_batch_request',
      tools: [{
        id: 'tool-5',
        name: 'execute_command',
        arguments: JSON.stringify({ command: 'curl https://example.com', cwd: '/tmp/workspace' }),
      }],
      _resolveAll: resolved,
    };

    await handleToolBatchRequest({
      chunk,
      activeSessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      get: () => state,
      set: jest.fn(),
      ensureSessionWorkDir: async () => '/tmp/workspace',
    }, deps);

    expect(waitForPermission).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tool-5',
      name: 'execute_command',
      arguments: expect.stringContaining('"command":"curl https://example.com"'),
      source: 'assistant_tool_call',
      workingDirectory: '/tmp/workspace',
      commandPreview: 'curl https://example.com',
      riskReason: 'Assistant tool calls need approval for network or package-install commands.',
      approvalToken: 'approval-5',
    }));
    expect(invoke).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
      toolCallId: 'tool-5',
      sessionId: 'session-1',
      approvalToken: 'approval-5',
      source: 'assistant_tool_call',
    }));
    const executeSingleToolCall = (invoke as jest.Mock).mock.calls.find(([command]) => command === 'execute_single_tool');
    expect(executeSingleToolCall).toBeDefined();
    expect(JSON.parse(executeSingleToolCall?.[1].arguments as string)).toEqual(expect.objectContaining({
      command: 'curl https://example.com',
      cwd: '/tmp/workspace',
      executionId: expect.any(String),
    }));
    expect(updateTaskStep).toHaveBeenCalledWith('tool-5', 'awaiting_confirmation');
    expect(updateTaskStep).toHaveBeenCalledWith('tool-5', 'approved');
    expect(updateTaskStep).toHaveBeenCalledWith('tool-5', 'running');
    expect(updateTaskStep).toHaveBeenCalledWith('tool-5', 'done');
  });

  it('marks serial tools as rejected when backend policy blocks them before execution', async () => {
    const resolved = jest.fn();
    const waitForPermission = jest.fn(async () => true);
    const updateTaskStep = jest.fn();
    const invoke = jest.fn(async (command: string) => {
      if (command === 'preview_tool_policy') {
        return {
          toolCallId: 'tool-6',
          toolName: 'ssh_exec',
          decision: 'rejected',
          reason: 'Execution source headless_agent is not allowed to run ssh_exec.',
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });
    const deps = createDeps({
      uiStore: { getState: () => ({
        activeSkill: null,
        setActiveSkill: jest.fn(),
        setTaskProgress: jest.fn(),
        updateTaskStep,
        showQuestionnaire: jest.fn(async () => 'user response'),
        waitForPermission,
        addNotification: jest.fn(),
      }) } as unknown as ToolBatchExecutionDeps['uiStore'],
      invoke: invoke as ToolBatchExecutionDeps['invoke'],
      partitionTools: jest.fn(() => ({
        concurrent: [],
        serial: [{
          id: 'tool-6',
          name: 'ssh_exec',
          arguments: { command: 'pytest -q', remoteWorkDir: '/srv/project' },
        }],
      })),
    });
    const state = createChatState();
    const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
      type: 'tool_batch_request',
      tools: [{
        id: 'tool-6',
        name: 'ssh_exec',
        arguments: '{"command":"pytest -q","remoteWorkDir":"/srv/project"}',
      }],
      _resolveAll: resolved,
    };

    const results = await handleToolBatchRequest({
      chunk,
      activeSessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      get: () => state,
      set: jest.fn(),
      ensureSessionWorkDir: async () => '/tmp/workspace',
    }, deps);

    expect(waitForPermission).not.toHaveBeenCalled();
    expect(updateTaskStep).toHaveBeenCalledWith('tool-6', 'rejected');
    expect(results[0]).toEqual(expect.objectContaining({
      id: 'tool-6',
      content: expect.stringContaining('Execution source headless_agent is not allowed to run ssh_exec.'),
    }));
    expect(resolved).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'tool-6',
        content: expect.stringContaining('Execution source headless_agent is not allowed to run ssh_exec.'),
      }),
    ]);
  });

  it('maps cancelled execute_single_tool results into cancelled task state', async () => {
    const resolved = jest.fn();
    const updateTaskStep = jest.fn();
    const invoke = jest.fn(async (command: string) => {
      if (command === 'preview_tool_policy') {
        return {
          toolCallId: 'tool-7',
          toolName: 'execute_command',
          decision: 'allowed',
        };
      }

      if (command === 'execute_single_tool') {
        return {
          content: '{"status":"cancelled","stdout":"","stderr":""}',
          is_error: true,
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });
    const deps = createDeps({
      uiStore: { getState: () => ({
        activeSkill: null,
        setActiveSkill: jest.fn(),
        setTaskProgress: jest.fn(),
        updateTaskStep,
        showQuestionnaire: jest.fn(async () => 'user response'),
        waitForPermission: jest.fn(async () => true),
        addNotification: jest.fn(),
      }) } as unknown as ToolBatchExecutionDeps['uiStore'],
      invoke: invoke as ToolBatchExecutionDeps['invoke'],
      partitionTools: jest.fn(() => ({
        concurrent: [],
        serial: [{
          id: 'tool-7',
          name: 'execute_command',
          arguments: { command: 'pwd', cwd: '/tmp/workspace' },
        }],
      })),
    });
    const state = createChatState();
    const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
      type: 'tool_batch_request',
      tools: [{
        id: 'tool-7',
        name: 'execute_command',
        arguments: JSON.stringify({ command: 'pwd', cwd: '/tmp/workspace' }),
      }],
      _resolveAll: resolved,
    };

    const results = await handleToolBatchRequest({
      chunk,
      activeSessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      get: () => state,
      set: jest.fn(),
      ensureSessionWorkDir: async () => '/tmp/workspace',
    }, deps);

    expect(updateTaskStep).toHaveBeenCalledWith('tool-7', 'cancelled');
    expect(results[0]).toEqual(expect.objectContaining({
      id: 'tool-7',
      content: '{"status":"cancelled","stdout":"","stderr":""}',
    }));
  });

  describe('Bypass + Ask mode semantics', () => {
    it('Bypass + execute_command does not call waitForPermission (auto-approves)', async () => {
      const resolved = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      const updateTaskStep = jest.fn();
      const invoke = jest.fn(async (command: string) => {
        if (command === 'preview_tool_policy') {
          // Backend policy reports awaiting_confirmation (network-like
          // heuristic). Bypass must override this locally so the
          // frontend doesn't open a modal.
          return {
            toolCallId: 'tool-bypass-1',
            toolName: 'execute_command',
            decision: 'awaiting_confirmation',
            reason: 'Assistant tool calls need approval for network or package-install commands.',
            approvalToken: null,
          };
        }
        if (command === 'execute_single_tool') {
          return { content: '{"stdout":"42","stderr":"","exit_code":0}', is_error: false };
        }
        throw new Error(`Unexpected command: ${command}`);
      });
      const deps = createDeps({
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep,
          showQuestionnaire: jest.fn(async () => 'user response'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
        invoke: invoke as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-bypass-1',
            name: 'execute_command',
            arguments: { command: 'wc -l src/services/autoresearch/loopEngine.ts', cwd: '/tmp/workspace' },
          }],
        })),
      });
      const state = createChatStateWithMode('bypass');
      // Mirror the 5-mode id so the outer guard treats this as Bypass.
      (state.sessions[0] as { executionMode?: string }).executionMode = 'bypass';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-bypass-1',
          name: 'execute_command',
          arguments: JSON.stringify({ command: 'wc -l src/services/autoresearch/loopEngine.ts', cwd: '/tmp/workspace' }),
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      // Bypass must NOT open the permission modal — neither for the
      // serial path nor for any approval flow inside it.
      expect(waitForPermission as jest.Mock).not.toHaveBeenCalled();
      // The backend was told the request is awaiting_confirmation,
      // but Bypass + auto-approveable tool short-circuits before any
      // approval token is consumed.
      expect(invoke).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        toolCallId: 'tool-bypass-1',
        name: 'execute_command',
        workDir: '/tmp/workspace',
      }));
      // No "awaiting_confirmation" task step — the tool went straight
      // to running.
      expect(updateTaskStep).not.toHaveBeenCalledWith('tool-bypass-1', 'awaiting_confirmation');
      expect(updateTaskStep).toHaveBeenCalledWith('tool-bypass-1', 'running');
    });

    it('Bypass still rejects dangerous commands via preToolUseHooks', async () => {
      const resolved = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      const updateTaskStep = jest.fn();
      const runPreToolUseHooks = jest.fn(async () => ({
        approved: false,
        blockedBy: 'dangerous-command',
        error: 'Blocked: Attempting to delete root filesystem',
      }));
      const invoke = jest.fn();
      const deps = createDeps({
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep,
          showQuestionnaire: jest.fn(async () => 'user response'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
        runPreToolUseHooks: runPreToolUseHooks as unknown as ToolBatchExecutionDeps['runPreToolUseHooks'],
        invoke: invoke as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-danger',
            name: 'execute_command',
            arguments: { command: 'rm -rf /', cwd: '/tmp/workspace' },
          }],
        })),
      });
      const state = createChatStateWithMode('bypass');
      (state.sessions[0] as { executionMode?: string }).executionMode = 'bypass';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-danger',
          name: 'execute_command',
          arguments: '{"command":"rm -rf /","cwd":"/tmp/workspace"}',
        }],
        _resolveAll: resolved,
      };

      const results = await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      // Hard hook blocked it — no preview, no execution.
      expect(runPreToolUseHooks).toHaveBeenCalled();
      expect(waitForPermission).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalledWith('execute_single_tool', expect.anything());
      expect(results[0]?.content).toMatch(/Blocked: Attempting to delete root filesystem/);
    });

    it('Bypass still blocks writes outside Project Folder via path validation', async () => {
      const resolved = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      const runPreToolUseHooks = jest.fn(async () => ({
        approved: false,
        blockedBy: 'path-validation',
        error: 'Path /etc/passwd is outside working directory /tmp/workspace',
      }));
      const deps = createDeps({
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep: jest.fn(),
          showQuestionnaire: jest.fn(async () => 'user response'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
        runPreToolUseHooks: runPreToolUseHooks as unknown as ToolBatchExecutionDeps['runPreToolUseHooks'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-write',
            name: 'write_file',
            arguments: { path: '/etc/passwd', content: 'pwned' },
          }],
        })),
      });
      const state = createChatStateWithMode('bypass');
      (state.sessions[0] as { executionMode?: string }).executionMode = 'bypass';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-write',
          name: 'write_file',
          arguments: '{"path":"/etc/passwd","content":"pwned"}',
        }],
        _resolveAll: resolved,
      };

      const results = await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      expect(waitForPermission).not.toHaveBeenCalled();
      expect(results[0]?.content).toMatch(/outside working directory/);
    });

    it('Ask mode blocks every tool via the outer preToolUseHook', async () => {
      const resolved = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      const updateTaskStep = jest.fn();
      const invoke = jest.fn();
      const runPreToolUseHooks = jest.fn(async () => ({
        approved: false,
        blockedBy: 'permission-mode',
        error: 'Tool execution is disabled in Ask mode. Switch to Agent or Bypass to run tools.',
      }));
      const deps = createDeps({
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep,
          showQuestionnaire: jest.fn(async () => 'user response'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
        runPreToolUseHooks: runPreToolUseHooks as unknown as ToolBatchExecutionDeps['runPreToolUseHooks'],
        invoke: invoke as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-ask-1',
            name: 'execute_command',
            arguments: { command: 'pwd', cwd: '/tmp/workspace' },
          }],
        })),
      });
      const state = createChatState();
      (state.sessions[0] as { executionMode?: string }).executionMode = 'ask';
      state.sessions[0].permissionMode = 'plan-only';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-ask-1',
          name: 'execute_command',
          arguments: '{"command":"pwd","cwd":"/tmp/workspace"}',
        }],
        _resolveAll: resolved,
      };

      const results = await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      // The outer guard vetoed the request before preview / execute.
      expect(waitForPermission).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(results[0]?.content).toMatch(/Ask mode/);
      // The tool step landed in 'failed', not 'rejected' (it's a
      // block, not a user denial).
      expect(updateTaskStep).toHaveBeenCalledWith('tool-ask-1', 'failed');
    });

    it('Ask mode also blocks read_file / write_file / browser_* tools', async () => {
      const resolved = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      // Mock the preToolUseHooks to simulate the registry's response
      // for Ask mode (which blocks everything).
      const runPreToolUseHooks = jest.fn(async () => ({
        approved: false,
        blockedBy: 'permission-mode',
        error: 'Tool execution is disabled in Ask mode. Switch to Agent or Bypass to run tools.',
      }));
      const deps = createDeps({
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep: jest.fn(),
          showQuestionnaire: jest.fn(async () => 'user response'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
        runPreToolUseHooks: runPreToolUseHooks as unknown as ToolBatchExecutionDeps['runPreToolUseHooks'],
        partitionTools: jest.fn(() => ({
          concurrent: [
            { id: 't-read', name: 'read_file', arguments: { path: 'src/index.ts' } },
            { id: 't-write', name: 'write_file', arguments: { path: 'src/x.ts', content: '' } },
            { id: 't-browser', name: 'browser_navigate', arguments: { url: 'https://example.com' } },
          ],
          serial: [],
        })),
      });
      const state = createChatState();
      (state.sessions[0] as { executionMode?: string }).executionMode = 'ask';
      state.sessions[0].permissionMode = 'plan-only';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [
          { id: 't-read', name: 'read_file', arguments: '{"path":"src/index.ts"}' },
          { id: 't-write', name: 'write_file', arguments: '{"path":"src/x.ts","content":""}' },
          { id: 't-browser', name: 'browser_navigate', arguments: '{"url":"https://example.com"}' },
        ],
        _resolveAll: resolved,
      };

      const results = await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      expect(runPreToolUseHooks).toHaveBeenCalledTimes(3);
      expect(waitForPermission).not.toHaveBeenCalled();
      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result.content).toMatch(/Ask mode/);
      }
    });

    it('Agent mode still asks for execute_command when preview says awaiting_confirmation', async () => {
      const resolved = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      const invoke = jest.fn(async (command: string) => {
        if (command === 'preview_tool_policy') {
          return {
            toolCallId: 'tool-agent-1',
            toolName: 'execute_command',
            decision: 'awaiting_confirmation',
            reason: 'Assistant tool calls need approval for network or package-install commands.',
            approvalToken: 'agent-token',
          };
        }
        if (command === 'execute_single_tool') {
          return { content: '{"stdout":"ok","stderr":"","exit_code":0}', is_error: false };
        }
        throw new Error(`Unexpected command: ${command}`);
      });
      const deps = createDeps({
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep: jest.fn(),
          showQuestionnaire: jest.fn(async () => 'user response'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
        invoke: invoke as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-agent-1',
            name: 'execute_command',
            arguments: { command: 'curl https://example.com', cwd: '/tmp/workspace' },
          }],
        })),
      });
      const state = createChatStateWithMode('auto-edits');
      (state.sessions[0] as { executionMode?: string }).executionMode = 'agent';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-agent-1',
          name: 'execute_command',
          arguments: JSON.stringify({ command: 'curl https://example.com', cwd: '/tmp/workspace' }),
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      // Agent mode still asks the user for risky commands.
      expect(waitForPermission as jest.Mock).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        approvalToken: 'agent-token',
      }));
    });

    it('Permission modal and "awaiting_confirmation" task step never both render in Bypass', async () => {
      const resolved = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      const updateTaskStep = jest.fn();
      const invoke = jest.fn(async (command: string) => {
        if (command === 'preview_tool_policy') {
          return {
            toolCallId: 'tool-vis-1',
            toolName: 'execute_command',
            decision: 'awaiting_confirmation',
            reason: 'Network command',
            approvalToken: 'unused-token',
          };
        }
        if (command === 'execute_single_tool') {
          return { content: 'ok', is_error: false };
        }
        throw new Error(`Unexpected command: ${command}`);
      });
      const deps = createDeps({
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep,
          showQuestionnaire: jest.fn(async () => 'user response'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
        invoke: invoke as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-vis-1',
            name: 'execute_command',
            arguments: { command: 'echo hi', cwd: '/tmp/workspace' },
          }],
        })),
      });
      const state = createChatStateWithMode('bypass');
      (state.sessions[0] as { executionMode?: string }).executionMode = 'bypass';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-vis-1',
          name: 'execute_command',
          arguments: '{"command":"echo hi","cwd":"/tmp/workspace"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      // In Bypass the modal never opens, and the task step never
      // enters "awaiting_confirmation". It goes straight to running.
      expect(waitForPermission as jest.Mock).not.toHaveBeenCalled();
      expect(updateTaskStep).not.toHaveBeenCalledWith('tool-vis-1', 'awaiting_confirmation');
      expect(updateTaskStep).toHaveBeenCalledWith('tool-vis-1', 'running');
    });

    it('Bypass + write_file inside Project Folder does not call waitForPermission', async () => {
      // The audit checklist explicitly calls out a benign
      // project-scoped write_file as a must-not-prompt case for
      // Bypass. The frontend must short-circuit the modal the same
      // way it does for execute_command.
      const resolved = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      const updateTaskStep = jest.fn();
      const invoke = jest.fn(async (command: string) => {
        if (command === 'preview_tool_policy') {
          // Backend preview can still say awaiting_confirmation for
          // any write tool, but Bypass must override it.
          return {
            toolCallId: 'tool-write-1',
            toolName: 'write_file',
            decision: 'awaiting_confirmation',
            reason: 'Write tool approval required',
            approvalToken: 'unused-write-token',
          };
        }
        if (command === 'execute_single_tool') {
          return { content: '{"status":"succeeded"}', is_error: false };
        }
        throw new Error(`Unexpected command: ${command}`);
      });
      const deps = createDeps({
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep,
          showQuestionnaire: jest.fn(async () => 'user response'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
        invoke: invoke as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-write-1',
            name: 'write_file',
            arguments: { path: 'src/foo.ts', content: 'export const x = 1;\n' },
          }],
        })),
      });
      const state = createChatStateWithMode('bypass');
      (state.sessions[0] as { executionMode?: string }).executionMode = 'bypass';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-write-1',
          name: 'write_file',
          arguments: '{"path":"src/foo.ts","content":"export const x = 1;\\n"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      // Bypass + auto-approvable write tool: no permission modal, no
      // awaiting_confirmation step, straight to running.
      expect(waitForPermission as jest.Mock).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        toolCallId: 'tool-write-1',
        name: 'write_file',
        workDir: '/tmp/workspace',
      }));
      expect(updateTaskStep).not.toHaveBeenCalledWith('tool-write-1', 'awaiting_confirmation');
      expect(updateTaskStep).toHaveBeenCalledWith('tool-write-1', 'running');
    });
  });

  describe('5-mode execution mode plumbing', () => {
    it('forwards the session executionMode id into the preToolUseHook context', async () => {
      const resolved = jest.fn();
      const runPreToolUseHooks = jest.fn(async () => ({ approved: true }));
      const deps = createDeps({
        runPreToolUseHooks,
      });
      const state = createChatState();
      // The session was switched to the 5-mode 'plan' (Plan) mode.
      (state.sessions[0] as { executionMode?: string }).executionMode = 'plan';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-plan-1',
          name: 'read_file',
          arguments: '{"path":"src/index.ts"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      expect(runPreToolUseHooks).toHaveBeenCalledTimes(1);
      const ctxArg = (runPreToolUseHooks as jest.Mock).mock.calls[0]?.[0] as { executionMode?: string } | undefined;
      expect(ctxArg?.executionMode).toBe('plan');
    });

    it('resolves legacy permissionMode into executionMode for hook context', async () => {
      const resolved = jest.fn();
      const runPreToolUseHooks = jest.fn(async () => ({ approved: true }));
      const deps = createDeps({
        runPreToolUseHooks,
      });
      const state = createChatState();
      // No executionMode on the session — only the legacy permissionMode.
      state.sessions[0].permissionMode = 'auto-edits';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-legacy-1',
          name: 'read_file',
          arguments: '{"path":"src/index.ts"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      const ctxArg = (runPreToolUseHooks as jest.Mock).mock.calls[0]?.[0] as { executionMode?: string; permissionMode?: string } | undefined;
      expect(ctxArg?.executionMode).toBe('agent');
      expect(ctxArg?.permissionMode).toBe('auto-edits');
    });

    it('resolves legacy bypass permissionMode for hook context', async () => {
      const resolved = jest.fn();
      const runPreToolUseHooks = jest.fn(async () => ({ approved: true }));
      const deps = createDeps({
        runPreToolUseHooks,
      });
      const state = createChatState();
      state.sessions[0].permissionMode = 'bypass';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-bypass-1',
          name: 'read_file',
          arguments: '{"path":"src/index.ts"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => '/tmp/workspace',
      }, deps);

      const ctxArg = (runPreToolUseHooks as jest.Mock).mock.calls[0]?.[0] as { executionMode?: string; permissionMode?: string } | undefined;
      expect(ctxArg?.executionMode).toBe('bypass');
      expect(ctxArg?.permissionMode).toBe('bypass');
    });
  });

  // Two-folder model regression: workspace tools MUST NOT fall back
  // to the PiPi Output Folder when the Project Folder is missing.
  // The old `ensureSessionWorkDir()` fallback used to paper over the
  // single-folder world; in the two-folder model that helper now
  // provisions the *output* folder, so silently using it as the tool
  // cwd would let the model "edit" the `.pipi-shrimp/` tree. We
  // guard the fallback: if `ensureSessionWorkDir` returns the
  // session's `pipiOutputDir` we surface a hard error instead.
  describe('two-folder model — no fallback to PiPi Output Folder for tool cwd', () => {
    it('returns a hard error for write_file when ensureSessionWorkDir lands on the PiPi Output Folder', async () => {
      const resolved = jest.fn();
      const deps = createDeps({
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-write',
            name: 'write_file',
            arguments: { path: 'src/foo.ts', content: 'export const x = 1;\n' },
          }],
        })),
      });
      // Session has NO projectDir / workDir — only a PiPi Output Folder.
      const state = createChatState();
      state.sessions[0].workDir = undefined;
      state.sessions[0].projectDir = undefined;
      state.sessions[0].pipiOutputDir = '/home/user/.local/share/PiPi-Shrimp/chats/session-1';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-write',
          name: 'write_file',
          arguments: '{"path":"src/foo.ts","content":"export const x = 1;\\n"}',
        }],
        _resolveAll: resolved,
      };

      const results = await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        // Return the same path as pipiOutputDir — the executor must
        // refuse to use it as tool cwd.
        ensureSessionWorkDir: async () => '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      }, deps);

      // No tool should have been executed against the PiPi Output Folder.
      expect((deps.invoke as jest.Mock)).not.toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        workDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      }));
      // The error is surfaced to the model so it can prompt the user
      // to bind a Project Folder.
      expect(results).toEqual([
        expect.objectContaining({
          id: 'tool-write',
          toolName: 'write_file',
          content: expect.stringMatching(/No Project Folder is bound/i),
        }),
      ]);
      expect(resolved).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'tool-write',
          content: expect.stringMatching(/No Project Folder is bound/i),
        }),
      ]);
    });

    it('still uses the Project Folder returned by ensureSessionWorkDir (pre-v7 single-folder path)', async () => {
      // The legacy `ensureSessionWorkDir` may return a project-root
      // path for a pre-v7 session that only has a `workDir`. We must
      // accept that fallback as long as it's NOT the PiPi Output
      // Folder — this preserves the pre-fix behaviour for sessions
      // that were bound to a single folder.
      const resolved = jest.fn();
      const deps = createDeps({
        invoke: jest.fn(async () => ({ content: 'ok', is_error: false })) as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-write',
            name: 'write_file',
            arguments: { path: 'src/foo.ts', content: 'export const x = 1;\n' },
          }],
        })),
      });
      const state = createChatState();
      // The session has pipiOutputDir bound but the fallback returns
      // a *different* (Project Folder) path. That should still be
      // accepted as tool cwd.
      state.sessions[0].pipiOutputDir = '/home/user/.local/share/PiPi-Shrimp/chats/session-1';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-write',
          name: 'write_file',
          arguments: '{"path":"src/foo.ts","content":"export const x = 1;\\n"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        // The fallback returns the **Project Folder**, not the
        // pipiOutputDir — must be accepted.
        ensureSessionWorkDir: async () => '/home/user/repo',
      }, deps);

      // The fallback was accepted and the tool ran against the
      // Project Folder, not the PiPi Output Folder.
      expect((deps.invoke as jest.Mock)).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        toolCallId: 'tool-write',
        workDir: '/home/user/repo',
      }));
      expect((deps.invoke as jest.Mock)).not.toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        workDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      }));
    });

    it('still runs read-only tools without a Project Folder', async () => {
      // Read-only context (read_file, list_files, search_files) keeps
      // working because the caller can supply an absolute path or
      // attach a Context File. We do NOT block these tools.
      const resolved = jest.fn();
      const deps = createDeps({
        partitionTools: jest.fn(() => ({
          concurrent: [{
            id: 'tool-read',
            name: 'read_file',
            arguments: { path: 'C:/absolute/path/to/file.ts' },
          }],
          serial: [],
        })),
        invoke: jest.fn(async (cmd: string) => {
          if (cmd === 'execute_single_tool' || cmd === 'execute_tool_batch') {
            return [{ id: 'tool-read', content: 'file contents', toolName: 'read_file', toolArgs: '{}' }];
          }
          return null;
        }) as unknown as ToolBatchExecutionDeps['invoke'],
      });
      const state = createChatState();
      state.sessions[0].workDir = undefined;
      state.sessions[0].projectDir = undefined;
      state.sessions[0].pipiOutputDir = '/home/user/.local/share/PiPi-Shrimp/chats/session-1';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-read',
          name: 'read_file',
          arguments: '{"path":"C:/absolute/path/to/file.ts"}',
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

      expect(results.length).toBeGreaterThan(0);
      const block = results.find((result) => /No Project Folder is bound/i.test(result.content));
      expect(block).toBeUndefined();
    });
  });

  // Project Folder cwd resolution regression: the executor must
  // resolve tool cwd via `getSessionProjectDir(session)`, which
  // prefers the new `projectDir` column and falls back to the legacy
  // `workDir` mirror. Raw `session.workDir` reads in `handleToolBatchRequest`
  // were the bug — `workDir` is only a backwards-compat mirror of
  // `projectDir`, never the canonical source.
  describe('Project Folder cwd resolution (two-folder model)', () => {
    it('write_file uses projectDir as workDir when only projectDir is set', async () => {
      const resolved = jest.fn();
      const deps = createDeps({
        invoke: jest.fn(async () => ({ content: 'ok', is_error: false })) as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-write',
            name: 'write_file',
            arguments: { path: 'src/foo.ts', content: 'export const x = 1;\n' },
          }],
        })),
      });
      const state = createChatState();
      // projectDir-only: legacy workDir is undefined.
      state.sessions[0].projectDir = '/tmp/project';
      state.sessions[0].workDir = undefined;
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-write',
          name: 'write_file',
          arguments: '{"path":"src/foo.ts","content":"export const x = 1;\\n"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => null,
      }, deps);

      expect((deps.invoke as jest.Mock)).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        toolCallId: 'tool-write',
        name: 'write_file',
        workDir: '/tmp/project',
      }));
    });

    it('execute_command uses projectDir as workDir when only projectDir is set', async () => {
      const resolved = jest.fn();
      const deps = createDeps({
        invoke: jest.fn(async () => ({ content: '{"stdout":"ok"}', is_error: false })) as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-exec',
            name: 'execute_command',
            arguments: { command: 'pwd' },
          }],
        })),
      });
      const state = createChatState();
      state.sessions[0].projectDir = '/tmp/project';
      state.sessions[0].workDir = undefined;
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-exec',
          name: 'execute_command',
          arguments: '{"command":"pwd"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => null,
      }, deps);

      expect((deps.invoke as jest.Mock)).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        toolCallId: 'tool-exec',
        name: 'execute_command',
        workDir: '/tmp/project',
      }));
    });

    it('legacy workDir-only session still uses workDir as cwd', async () => {
      const resolved = jest.fn();
      const deps = createDeps({
        invoke: jest.fn(async () => ({ content: 'ok', is_error: false })) as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-legacy',
            name: 'write_file',
            arguments: { path: 'src/foo.ts', content: 'x' },
          }],
        })),
      });
      const state = createChatState();
      // Legacy: only workDir set, no projectDir.
      state.sessions[0].projectDir = undefined;
      state.sessions[0].workDir = '/tmp/legacy';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-legacy',
          name: 'write_file',
          arguments: '{"path":"src/foo.ts","content":"x"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => null,
      }, deps);

      expect((deps.invoke as jest.Mock)).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        toolCallId: 'tool-legacy',
        name: 'write_file',
        workDir: '/tmp/legacy',
      }));
    });

    it('execute_command refuses pipiOutputDir-only session (clear Project Folder error)', async () => {
      const resolved = jest.fn();
      const deps = createDeps({
        invoke: jest.fn(async () => ({ content: '{"stdout":"ok"}', is_error: false })) as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-exec',
            name: 'execute_command',
            arguments: { command: 'ls' },
          }],
        })),
      });
      const state = createChatState();
      state.sessions[0].projectDir = undefined;
      state.sessions[0].workDir = undefined;
      state.sessions[0].pipiOutputDir = '/home/user/.local/share/PiPi-Shrimp/chats/session-1';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-exec',
          name: 'execute_command',
          arguments: '{"command":"ls"}',
        }],
        _resolveAll: resolved,
      };

      const results = await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        // Fallback returns the same path as pipiOutputDir — must be rejected.
        ensureSessionWorkDir: async () => '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      }, deps);

      // execute_command must never have been invoked against the
      // PiPi Output Folder.
      expect((deps.invoke as jest.Mock)).not.toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        workDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      }));
      expect(results).toEqual([
        expect.objectContaining({
          id: 'tool-exec',
          toolName: 'execute_command',
          content: expect.stringMatching(/No Project Folder is bound/i),
        }),
      ]);
      expect(resolved).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'tool-exec',
          content: expect.stringMatching(/No Project Folder is bound/i),
        }),
      ]);
    });

    it('Bypass mode + projectDir-only session auto-approves execute_command with projectDir', async () => {
      const resolved = jest.fn();
      const updateTaskStep = jest.fn();
      const waitForPermission = jest.fn(async () => true);
      const deps = createDeps({
        invoke: jest.fn(async () => ({ content: '{"stdout":"ok"}', is_error: false })) as ToolBatchExecutionDeps['invoke'],
        runPreToolUseHooks: jest.fn(async () => ({ approved: true })),
        partitionTools: jest.fn(() => ({
          concurrent: [],
          serial: [{
            id: 'tool-bypass-exec',
            name: 'execute_command',
            arguments: { command: 'pwd' },
          }],
        })),
        uiStore: { getState: () => ({
          activeSkill: null,
          setActiveSkill: jest.fn(),
          setTaskProgress: jest.fn(),
          updateTaskStep,
          showQuestionnaire: jest.fn(async () => 'ok'),
          waitForPermission,
          addNotification: jest.fn(),
        }) } as unknown as ToolBatchExecutionDeps['uiStore'],
      });
      const state = createChatState();
      state.sessions[0].projectDir = '/tmp/project';
      state.sessions[0].workDir = undefined;
      state.sessions[0].executionMode = 'bypass';
      state.sessions[0].permissionMode = 'bypass';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-bypass-exec',
          name: 'execute_command',
          arguments: '{"command":"pwd"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => null,
      }, deps);

      // Bypass auto-approves the project-scoped shell tool.
      expect(waitForPermission as jest.Mock).not.toHaveBeenCalled();
      expect((deps.invoke as jest.Mock)).toHaveBeenCalledWith('execute_single_tool', expect.objectContaining({
        toolCallId: 'tool-bypass-exec',
        name: 'execute_command',
        workDir: '/tmp/project',
      }));
    });

    it('Ask mode + projectDir-only session still blocks every tool', async () => {
      const resolved = jest.fn();
      const deps = createDeps({
        // Hook chain always reports "Ask mode blocked" — this matches
        // the real preToolUseHooks.executionModeGuardCheck contract.
        runPreToolUseHooks: jest.fn(async () => ({
          approved: false,
          error: 'Tool execution is disabled in Ask mode.',
          blockedBy: 'permission-mode',
        })),
        invoke: jest.fn(async () => ({ content: 'ok', is_error: false })) as ToolBatchExecutionDeps['invoke'],
        partitionTools: jest.fn(() => ({
          concurrent: [{
            id: 'tool-read',
            name: 'read_file',
            arguments: { path: 'src/index.ts' },
          }],
          serial: [],
        })),
      });
      const state = createChatState();
      state.sessions[0].projectDir = '/tmp/project';
      state.sessions[0].workDir = undefined;
      state.sessions[0].executionMode = 'ask';
      state.sessions[0].permissionMode = 'plan-only';
      const chunk: Extract<EngineEvent, { type: 'tool_batch_request' }> = {
        type: 'tool_batch_request',
        tools: [{
          id: 'tool-read',
          name: 'read_file',
          arguments: '{"path":"src/index.ts"}',
        }],
        _resolveAll: resolved,
      };

      await handleToolBatchRequest({
        chunk,
        activeSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        get: () => state,
        set: jest.fn(),
        ensureSessionWorkDir: async () => null,
      }, deps);

      // No real tool execution happened — the hook chain rejected.
      expect((deps.invoke as jest.Mock)).not.toHaveBeenCalledWith('execute_single_tool', expect.anything());
      expect((deps.invoke as jest.Mock)).not.toHaveBeenCalledWith('execute_tool_batch', expect.anything());
    });
  });
});
