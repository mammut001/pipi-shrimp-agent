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
    getTotalTokenStats: jest.fn(async () => ({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      total_tokens: 0,
      total_real_tokens: 0,
      request_count: 0,
    })),
    resetTokenEstimate: jest.fn(async () => {}),
  } as unknown as ChatState;
}

function createChatStateWithMode(permissionMode: ChatState['sessions'][number]['permissionMode']): ChatState {
  const state = createChatState();
  state.sessions[0].permissionMode = permissionMode;
  return state;
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
      source: 'assistant_tool_call',
    }));
    expect(results).toEqual([expect.objectContaining({ id: 'tool-3', content: '{"stdout":"ok","stderr":"","exit_code":0}', toolName: 'execute_command', toolArgs: expect.stringContaining('"command":"pwd"') })]);
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
        arguments: '{"command":"pwd","cwd":"/tmp/workspace"}',
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
        arguments: '{"command":"curl https://example.com","cwd":"/tmp/workspace"}',
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

    expect(updateTaskStep).toHaveBeenCalledWith('tool-7', 'cancelled');
    expect(results[0]).toEqual(expect.objectContaining({
      id: 'tool-7',
      content: '{"status":"cancelled","stdout":"","stderr":""}',
    }));
  });
});
