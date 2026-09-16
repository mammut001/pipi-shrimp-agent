import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import type { Session } from '../../../types/chat';

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRunChatTurn = jest.fn();
const mockAddNotification = jest.fn();
const mockShowExecutionModeUpgradePrompt = jest.fn(async () => 'agent' as const);
const mockClearTaskProgress = jest.fn();
const mockSetTaskProgress = jest.fn();
const mockSetActiveSkill = jest.fn();
const mockUpdateTaskStep = jest.fn();
const mockClearAllPermissions = jest.fn();
const mockGetActiveConfig = jest.fn();
const mockGetActiveTemplate = jest.fn();
const mockBuildPrompt = jest.fn();
const mockClassifyIntent = jest.fn();
const mockRunMicrocompactCheck = jest.fn();
const mockTrySessionMemoryCompact = jest.fn();
const mockGetContextTokenStats = jest.fn();
const mockCheckReactiveCompact = jest.fn();
const mockTriggerContextAnalysis = jest.fn();
const mockRecordToolForReactiveCompact = jest.fn();
const mockExecuteBatch = jest.fn();
const mockDetectAndRegisterArtifacts = jest.fn();
const mockSavePlanModeDoc = jest.fn();
const mockShouldSavePlanDoc = jest.fn();
const mockListen = jest.fn();
const eventHandlers = new Map<string, (event: { payload: any }) => void>();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

jest.mock('../../settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      getActiveConfig: mockGetActiveConfig,
    }),
  },
}));

jest.mock('../../uiStore', () => ({
  useUIStore: {
    getState: () => ({
      addNotification: mockAddNotification,
      clearTaskProgress: mockClearTaskProgress,
      setTaskProgress: mockSetTaskProgress,
      agentInstructions: 'agent instructions',
      activeSkill: null,
      setActiveSkill: mockSetActiveSkill,
      updateTaskStep: mockUpdateTaskStep,
      waitForPermission: jest.fn(async () => true),
      showQuestionnaire: jest.fn(async () => 'questionnaire response'),
      clearAllPermissions: (...args: unknown[]) => mockClearAllPermissions(...args),
      permissionQueue: [],
      clearQuestionnaire: jest.fn(),
      showExecutionModeUpgradePrompt: (...args: unknown[]) => mockShowExecutionModeUpgradePrompt(...args),
    }),
  },
}));

jest.mock('../../promptStore', () => ({
  usePromptStore: {
    getState: () => ({
      getActiveTemplate: mockGetActiveTemplate,
    }),
  },
}));

jest.mock('../../../services/orchestration', () => ({
  classifyIntent: (...args: unknown[]) => mockClassifyIntent(...args),
  buildDelegationPlan: jest.fn(),
  describePlan: jest.fn(),
  runDelegationPlan: jest.fn(),
  buildSynthesisPrompt: jest.fn(),
  buildProgressMessage: jest.fn(),
  resolveFollowThrough: jest.fn(),
}));

jest.mock('../../../services/prompt/promptBuilder', () => ({
  buildPrompt: (...args: unknown[]) => mockBuildPrompt(...args),
}));

jest.mock('../../../core/QueryEngine', () => ({
  runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
}));

jest.mock('../../../services/compact/microCompact', () => ({
  runMicrocompactCheck: (...args: unknown[]) => mockRunMicrocompactCheck(...args),
  resetMicrocompactForNewTurn: jest.fn(),
}));

jest.mock('../../../services/compact/sessionMemoryCompact', () => ({
  trySessionMemoryCompact: (...args: unknown[]) => mockTrySessionMemoryCompact(...args),
}));

jest.mock('../../../services/compact/compact', () => ({
  triggerLegacyCompact: jest.fn(),
}));

jest.mock('../../../services/compact/config', () => ({
  getCompactConfig: () => ({
    sm_auto_threshold_tokens: 80_000,
    legacy_auto_threshold_tokens: 120_000,
  }),
  getContextTokenStats: (...args: unknown[]) => mockGetContextTokenStats(...args),
}));

jest.mock('../../../services/compact/reactiveCompact', () => ({
  checkReactiveCompact: (...args: unknown[]) => mockCheckReactiveCompact(...args),
  recordToolForReactiveCompact: (...args: unknown[]) => mockRecordToolForReactiveCompact(...args),
}));

jest.mock('../../../services/contextAnalysis/hooks/contextAnalysisTrigger', () => ({
  triggerContextAnalysis: (...args: unknown[]) => mockTriggerContextAnalysis(...args),
}));

jest.mock('../../../services/StreamingToolExecutor', () => ({
  partitionTools: (tools: unknown[]) => ({ concurrent: tools, serial: [] }),
  StreamingToolExecutor: jest.fn().mockImplementation(() => ({
    executeBatch: (...args: unknown[]) => mockExecuteBatch(...args),
  })),
}));

jest.mock('../../../services/tools/toolMetadata', () => ({
  partitionToolsByMetadata: jest.fn(async (tools: any[]) => ({ concurrent: tools, serial: [] })),
  loadToolRuntimeMetadata: jest.fn(async () => new Map()),
  getToolRuntimeMetadata: jest.fn(async () => undefined),
  toolNamesRequireWorkspace: jest.fn(async () => true),
}));

jest.mock('../../../services/artifactDetector', () => ({
  detectAndRegisterArtifacts: (...args: unknown[]) => mockDetectAndRegisterArtifacts(...args),
}));

jest.mock('../../../services/planMode', () => ({
  PLAN_MODE_SYSTEM_PROMPT: '# PLAN MODE ACTIVATED\n\nPlan only.',
  PLAN_MODE_ALLOWED_TOOLS: ['read_file', 'list_files', 'search_files'],
  savePlanModeDoc: (...args: unknown[]) => mockSavePlanModeDoc(...args),
  shouldSavePlanDoc: (...args: unknown[]) => mockShouldSavePlanDoc(...args),
}));

jest.mock('../../../i18n', () => ({
  t: (key: string) => key,
}));

import { useChatStore } from '../index';
import { createMessage } from '../../../types/chat';
import {
  listCancellableSessionExecutionIds,
  listUnresolvedSessionTools,
  resetAllSessionToolRuntime,
  setSessionToolExecutionId,
  seedSessionToolRuntime,
  clearSessionToolRuntime,
  syncSessionToolRuntimeToCurrentSession,
} from '../toolRuntimeState';
import { shouldShowStopControl } from '../chatSelectors';
import {
  bumpChatSessionTurnEpoch,
  consumeChatGenerationCancel,
  getChatSessionTurnEpoch,
  requestChatGenerationCancel,
  resetChatSessionTurnEpochForTests,
} from '../chatStreaming';
import {
  getCurrentStreamingBufferForTests,
  resetActiveChatDiagnosticsTaskIdsForTests,
} from '../chatActions';
import { useTaskRegistryStore } from '../../taskRegistryStore';

async function* streamOneAssistantReply() {
  yield { type: 'text_delta' as const, content: 'Hello ' };
  yield { type: 'text_delta' as const, content: 'from model' };
  yield {
    type: 'turn_complete' as const,
    tokenUsage: {
      input_tokens: 12,
      output_tokens: 5,
      model: 'mock-model',
    },
  };
}

async function* streamWithToolBatch() {
  yield {
    type: 'tool_batch_request' as const,
    tools: [{ id: 'tool-1', name: 'read_file', arguments: '{}' }],
    _resolveAll: jest.fn(),
  };
  yield { type: 'text_delta' as const, content: 'Artifact ready' };
  yield {
    type: 'turn_complete' as const,
    tokenUsage: {
      input_tokens: 7,
      output_tokens: 3,
      model: 'mock-model',
    },
  };
}

async function* streamPlanAssistantReply() {
  yield { type: 'text_delta' as const, content: '## Execution Plan: Ship Plan Mode\n\n' };
  yield { type: 'text_delta' as const, content: '### 1. Goal Summary\n\nClarify the feature.\n\n' };
  yield { type: 'text_delta' as const, content: '### 3. Proposed Implementation Steps\n\nStep 1: Update the chat flow.\n\n' };
  yield { type: 'text_delta' as const, content: '### 6. Validation Plan\n\nRun targeted checks.\n\n### 7. Execution Gate\n\nThis plan has not been executed.' };
  yield {
    type: 'turn_complete' as const,
    tokenUsage: {
      input_tokens: 20,
      output_tokens: 9,
      model: 'mock-model',
    },
  };
}

async function* streamAskModePseudoToolReply() {
  yield { type: 'text_delta' as const, content: ']<]minimax[>[<tool_call>\n' };
  yield { type: 'text_delta' as const, content: ']<]minimax[>[<list_files path=\".\">\n' };
  yield { type: 'text_delta' as const, content: ']<]minimax[>[</tool_call>' };
  yield {
    type: 'turn_complete' as const,
    tokenUsage: {
      input_tokens: 6,
      output_tokens: 3,
      model: 'mock-model',
    },
  };
}

async function* streamWithToolBatchThenContinuation() {
  let resolved = false;

  yield {
    type: 'tool_batch_request' as const,
    tools: [{ id: 'tool-cancel', name: 'read_file', arguments: '{"path":"README.md"}' }],
    _resolveAll: () => {
      resolved = true;
    },
  };

  if (resolved) {
    yield { type: 'text_delta' as const, content: 'should not continue after cancel' };
    yield {
      type: 'turn_complete' as const,
      tokenUsage: {
        input_tokens: 3,
        output_tokens: 1,
        model: 'mock-model',
      },
    };
  }
}

function resetChatState(overrides: Partial<Session> = {}) {
  const session: Session = {
    id: 'session-1',
    title: 'Chat',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };

  useChatStore.setState({
    sessions: [session],
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
  });
}

describe('chatStore sendMessage integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetAllSessionToolRuntime();
    resetChatSessionTurnEpochForTests();
    resetActiveChatDiagnosticsTaskIdsForTests();
    useTaskRegistryStore.getState().clearTasks();
    mockInvoke.mockReset();
    mockRunChatTurn.mockReset();
    mockAddNotification.mockReset();
    mockShowExecutionModeUpgradePrompt.mockReset();
    mockShowExecutionModeUpgradePrompt.mockResolvedValue('agent');
    mockClearTaskProgress.mockReset();
    mockSetTaskProgress.mockReset();
    mockSetActiveSkill.mockReset();
    mockUpdateTaskStep.mockReset();
    mockClearAllPermissions.mockReset();
    mockGetActiveConfig.mockReset();
    mockGetActiveTemplate.mockReset();
    mockBuildPrompt.mockReset();
    mockClassifyIntent.mockReset();
    mockRunMicrocompactCheck.mockReset();
    mockTrySessionMemoryCompact.mockReset();
    mockGetContextTokenStats.mockReset();
    mockCheckReactiveCompact.mockReset();
    mockTriggerContextAnalysis.mockReset();
    mockRecordToolForReactiveCompact.mockReset();
    mockExecuteBatch.mockReset();
    mockDetectAndRegisterArtifacts.mockReset();
    mockSavePlanModeDoc.mockReset();
    mockShouldSavePlanDoc.mockReset();
    mockListen.mockReset();
    eventHandlers.clear();

    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
        clear: jest.fn(),
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: jest.fn(() => `id-${Math.random().toString(16).slice(2)}`) },
      configurable: true,
    });

    mockInvoke.mockResolvedValue(undefined);
    mockListen.mockImplementation(async (eventName: string, handler: (event: { payload: any }) => void) => {
      eventHandlers.set(eventName, handler);
      return () => {
        eventHandlers.delete(eventName);
      };
    });
    mockGetActiveConfig.mockReturnValue({
      id: 'api-config-1',
      apiKey: 'sk-test',
      model: 'mock-model',
      baseUrl: '',
      apiFormat: 'openai',
      provider: 'openai',
    });
    mockGetActiveTemplate.mockReturnValue({ sections: [] });
    mockBuildPrompt.mockReturnValue({ systemPrompt: 'system prompt' });
    mockClassifyIntent.mockReturnValue({ shouldDelegate: false });
    mockRunChatTurn.mockImplementation(() => streamOneAssistantReply());
    mockExecuteBatch.mockResolvedValue({
      results: [{ id: 'tool-1', content: 'created /work/out.svg', is_error: false }],
      totalExecutionTime: 1,
      errors: [],
    });
    mockRunMicrocompactCheck.mockResolvedValue({ didCompact: false });
    mockTrySessionMemoryCompact.mockResolvedValue({ did_compact: false });
    mockGetContextTokenStats.mockResolvedValue({ current: 0 });
    mockCheckReactiveCompact.mockResolvedValue(undefined);
    mockTriggerContextAnalysis.mockResolvedValue(undefined);
    mockSavePlanModeDoc.mockResolvedValue({
      number: '021',
      filename: '021-plan.md',
      path: '/tmp/pipi/session-1/.pipi-shrimp/docs/021-plan.md',
    });
    mockShouldSavePlanDoc.mockReturnValue(true);
    resetChatState();
  });

  afterEach(() => {
    const timeoutId = useChatStore.getState().streamingTimeoutId;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    jest.useRealTimers();
  });

  it('persists user and assistant messages after a mocked streaming turn', async () => {
    await useChatStore.getState().sendMessage('hello world', undefined, { allowBrowserTools: true });

    const state = useChatStore.getState();
    const session = state.sessions.find((candidate) => candidate.id === 'session-1');

    expect(mockClearTaskProgress).toHaveBeenCalledTimes(2);
    expect(mockBuildPrompt).toHaveBeenCalledWith([], expect.objectContaining({
      agentInstructions: 'agent instructions',
      originalQuery: '',
      browserResult: '',
    }));
    expect(mockRunChatTurn).toHaveBeenCalledWith(
      'session-1',
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'hello world' })]),
      expect.stringContaining('# ASK HARNESS'),
      undefined,
      false,
      undefined,
      expect.objectContaining({ noTools: true }),
      undefined,
    );
    expect(session?.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'hello world'],
      ['assistant', 'Hello from model'],
    ]);
    expect(session?.messages[1]?.token_usage).toEqual({
      input_tokens: 12,
      output_tokens: 5,
      model: 'mock-model',
    });
    expect(state.isStreaming).toBe(false);
    expect(state.streamingContent).toBe('');
    expect(state.streamingSessionId).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('db_save_token_usage', expect.objectContaining({
      usage: expect.objectContaining({
        session_id: 'session-1',
        input_tokens: 12,
        output_tokens: 5,
        model: 'mock-model',
        api_config_id: 'api-config-1',
      }),
    }));
  });

  it('clears a stale error banner when a new turn succeeds', async () => {
    useChatStore.setState({ error: 'Every tool call in the last round was rejected by the safety policy.' });

    await useChatStore.getState().sendMessage('hello again');

    expect(useChatStore.getState().error).toBeNull();
    const session = useChatStore.getState().sessions.find((candidate) => candidate.id === 'session-1');
    expect(session?.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'hello again'],
      ['assistant', 'Hello from model'],
    ]);
  });

  it('routes tool batch execution through the extracted coordinator and artifact detector', async () => {
    resetChatState({ executionMode: 'agent', permissionMode: 'auto-edits' });
    mockRunChatTurn.mockImplementation(() => streamWithToolBatch());

    await useChatStore.getState().sendMessage('generate artifact');

    expect(mockSetTaskProgress).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'tool-1', label: 'read_file', status: 'pending' }),
    ]);
    expect(mockExecuteBatch).toHaveBeenCalledWith(
      [{ id: 'tool-1', name: 'read_file', arguments: {} }],
      expect.objectContaining({ sessionId: 'session-1' }),
    );
    expect(mockDetectAndRegisterArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'read_file',
      toolResultText: 'created /work/out.svg',
    }));
    expect(mockUpdateTaskStep).toHaveBeenCalledWith('tool-1', 'validating');
    expect(mockUpdateTaskStep).toHaveBeenCalledWith('tool-1', 'done');
  });

  it('uses plan-only prompt and saves the final plan as a doc without delegation', async () => {
    resetChatState({
      executionMode: 'plan',
      permissionMode: 'plan-only',
      workDir: '/tmp/pipi/session-1',
    });
    mockRunChatTurn.mockImplementation(() => streamPlanAssistantReply());
    // Two-folder model: plan docs are app-owned outputs and land in the
    // PiPi Output Folder, not the Project Folder. The chat store
    // auto-provisions a default PiPi Output Folder when one isn't bound
    // yet, and `get_app_default_dir` is the Tauri command that returns
    // it. We mock it to a known path so the save flow can find a
    // destination.
    const pipiOutputDir = '/tmp/pipi-shrimp/chats/session-1';
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_app_default_dir') return pipiOutputDir;
      if (command === 'create_directory') return null;
      if (command === 'db_save_session') return null;
      return undefined;
    });

    await useChatStore.getState().sendMessage('帮我实现一个新的设置项');

    expect(mockClassifyIntent).not.toHaveBeenCalled();
    // Note: chatActions.ts uses a static `import { runChatTurn } from
    // '../../core/QueryEngine'`, so the `jest.mock` above does intercept
    // it and the mock is what we assert against. (Previously this file
    // used a dynamic `await import(...)` which Jest does not intercept
    // reliably, leaving these assertions effectively dead. The static
    // import fixes that.)
    expect(mockRunChatTurn).toHaveBeenCalledWith(
      'session-1',
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: '帮我实现一个新的设置项' })]),
      expect.stringContaining('# PLAN MODE ACTIVATED'),
      '/tmp/pipi/session-1',
      false,
      undefined,
      // Plan mode hands the model a read-only allowlist. Plan-doc
      // persistence is an app-side post-turn action — `save_plan_doc`
      // is intentionally NOT in this list because the Rust registry
      // has no handler for it. See PLAN_MODE_ALLOWED_TOOLS in
      // src/services/planMode.ts.
      expect.objectContaining({
        allowedTools: ['read_file', 'list_files', 'search_files'],
        signal: expect.any(AbortSignal),
      }),
      pipiOutputDir,
    );
    // Two-folder model: `savePlanModeDoc` is called with the PiPi
    // Output Folder path, NOT the Project Folder (`/tmp/pipi/session-1`
    // is the Project Folder here — that's the cwd for tools, but plan
    // docs are app-owned outputs and must not pollute the repo).
    expect(mockSavePlanModeDoc).toHaveBeenCalledWith({
      workDir: pipiOutputDir,
      userRequest: '帮我实现一个新的设置项',
      planMarkdown: expect.stringContaining('## Execution Plan: Ship Plan Mode'),
      sessionId: 'session-1',
    });
    expect(mockAddNotification).toHaveBeenCalledWith('success', 'Plan saved to Docs: 021-plan.md', 'session-1');
  });

  it('wires tool runtime events into chat task state during init', async () => {
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      isInitialized: false,
      pendingToolCalls: 0,
      pendingToolResults: [],
    });
    mockInvoke.mockImplementation(async (command: unknown, args?: Record<string, unknown>) => {
      switch (command) {
        case 'db_get_all_projects':
          return [];
        case 'db_get_all_sessions':
          return [{
            id: 'session-1',
            title: 'Chat',
            created_at: 1,
            updated_at: 1,
            cwd: null,
            project_id: null,
            model: null,
            work_dir: null,
            working_files: null,
            permission_mode: 'standard',
          }];
        case 'db_get_messages':
          expect(args).toEqual({ sessionId: 'session-1' });
          return [];
        default:
          return undefined;
      }
    });

    await useChatStore.getState().init();
    useChatStore.getState().selectSession('session-1');

    eventHandlers.get('tool-start')?.({
      payload: { session_id: 'session-1', tool_call_id: 'tool-evt', name: 'execute_command' },
    });

    expect(useChatStore.getState().pendingToolCalls).toBe(1);
    expect(mockSetTaskProgress).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'tool-evt', label: 'execute_command', status: 'running' }),
    ]);

    eventHandlers.get('tool-complete')?.({
      payload: { session_id: 'session-1', tool_call_id: 'tool-evt', name: 'execute_command', is_error: false },
    });

    expect(useChatStore.getState().pendingToolCalls).toBe(0);
    expect(useChatStore.getState().pendingToolResults).toEqual([{ toolCallId: 'tool-evt', result: '' }]);
    expect(mockSetTaskProgress).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'tool-evt', label: 'execute_command', status: 'done' }),
    ]);
  });

  it('marks runtime tool steps as failed when tool-error events arrive', async () => {
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      isInitialized: false,
      pendingToolCalls: 0,
      pendingToolResults: [],
    });
    mockInvoke.mockImplementation(async (command: unknown, args?: Record<string, unknown>) => {
      switch (command) {
        case 'db_get_all_projects':
          return [];
        case 'db_get_all_sessions':
          return [{
            id: 'session-1',
            title: 'Chat',
            created_at: 1,
            updated_at: 1,
            cwd: null,
            project_id: null,
            model: null,
            work_dir: null,
            working_files: null,
            permission_mode: 'standard',
          }];
        case 'db_get_messages':
          expect(args).toEqual({ sessionId: 'session-1' });
          return [];
        default:
          return undefined;
      }
    });

    await useChatStore.getState().init();
    useChatStore.getState().selectSession('session-1');

    eventHandlers.get('tool-start')?.({
      payload: { session_id: 'session-1', tool_call_id: 'tool-fail', name: 'write_file' },
    });
    eventHandlers.get('tool-error')?.({
      payload: { session_id: 'session-1', tool_call_id: 'tool-fail', name: 'write_file', error: 'permission denied' },
    });

    expect(useChatStore.getState().pendingToolCalls).toBe(0);
    expect(useChatStore.getState().pendingToolResults).toEqual([
      { toolCallId: 'tool-fail', result: 'Error: permission denied' },
    ]);
    expect(mockSetTaskProgress).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'tool-fail', label: 'write_file', status: 'failed' }),
    ]);
  });

  it('cancels after an in-flight tool batch and prevents the next model round from running', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });
    mockRunChatTurn.mockImplementation(() => streamWithToolBatchThenContinuation());
    mockExecuteBatch.mockImplementation(async () => {
      seedSessionToolRuntime(
        'session-1',
        [{ id: 'tool-cancel', name: 'read_file' }],
        useChatStore.setState,
        useChatStore.getState,
      );
      setSessionToolExecutionId(
        'session-1',
        'tool-cancel',
        'read_file',
        'exec-cancel-1',
        useChatStore.setState,
        useChatStore.getState,
      );
      await useChatStore.getState().stopGeneration();
      return {
        results: [{ id: 'tool-cancel', content: '{"stdout":"/tmp","stderr":"","exit_code":0}', is_error: false }],
        totalExecutionTime: 1,
        errors: [],
      };
    });

    await useChatStore.getState().sendMessage('cancel this run');

    expect(mockExecuteBatch).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('cancel_tool_execution', { executionId: 'exec-cancel-1' });
    expect(mockClearAllPermissions).toHaveBeenCalled();
    const session = useChatStore.getState().sessions.find((candidate) => candidate.id === 'session-1');
    const messagePairs = session?.messages.map((message) => [message.role, message.content]) ?? [];
    expect(messagePairs[0]).toEqual(['user', 'cancel this run']);
    expect(messagePairs.some(([, content]) => (
      typeof content === 'string'
      && content.includes('Tool run cancelled by user')
      && content.includes('read_file')
      && content.includes('do NOT re-request')
    ))).toBe(true);
    expect(session?.messages.some((message) => Boolean(message.tool_calls?.length))).toBe(false);
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().pendingToolCalls).toBe(0);
    expect(mockSetTaskProgress).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tool-cancel', label: 'read_file', status: 'cancelled' }),
      ]),
    );

    mockRunChatTurn.mockImplementation(() => streamOneAssistantReply());
    await useChatStore.getState().sendMessage('follow-up after cancel');

    const followUpCall = mockRunChatTurn.mock.calls.find((call) => (
      Array.isArray(call[1])
      && call[1].some((message: { content?: string }) => (
        typeof message.content === 'string' && message.content.includes('follow-up after cancel')
      ))
    )) ?? mockRunChatTurn.mock.calls[mockRunChatTurn.mock.calls.length - 1];
    const initialMessages = followUpCall?.[1] as Array<{ role: string; content: string; tool_calls?: unknown[] }>;
    expect(initialMessages.some((message) => (
      typeof message.content === 'string'
      && message.content.includes('Tool run cancelled by user')
      && message.content.includes('read_file')
      && message.content.includes('do NOT re-request')
    ))).toBe(true);
    expect(initialMessages.some((message) => Boolean(message.tool_calls?.length))).toBe(false);
  });

  it('keeps cancel notice in follow-up history even if tools_cancelled is ignored by host', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    // Simulate a host that never observes tools_cancelled: stopGeneration alone
    // must persist the durable cancel notice into session.messages / initialMessages.
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-ignore', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-ignore',
      'execute_command',
      'exec-ignore-1',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
    });

    await useChatStore.getState().stopGeneration();

    const session = useChatStore.getState().sessions.find((candidate) => candidate.id === 'session-1');
    expect(session?.messages.some((message) => (
      typeof message.content === 'string'
      && message.content.includes('Tool run cancelled by user')
      && message.content.includes('execute_command')
      && message.content.includes('do NOT re-request')
    ))).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('cancel_tool_execution', { executionId: 'exec-ignore-1' });

    mockRunChatTurn.mockImplementation(() => streamOneAssistantReply());
    await useChatStore.getState().sendMessage('follow-up without tools_cancelled');

    const followUpCall = mockRunChatTurn.mock.calls.find((call) => (
      Array.isArray(call[1])
      && call[1].some((message: { content?: string }) => (
        typeof message.content === 'string' && message.content.includes('follow-up without tools_cancelled')
      ))
    )) ?? mockRunChatTurn.mock.calls[mockRunChatTurn.mock.calls.length - 1];
    const initialMessages = followUpCall?.[1] as Array<{ role: string; content: string; tool_calls?: unknown[] }>;
    expect(initialMessages.some((message) => (
      typeof message.content === 'string'
      && message.content.includes('Tool run cancelled by user')
      && message.content.includes('execute_command')
      && message.content.includes('do NOT re-request')
    ))).toBe(true);
  });

  it('does not save non-plan replies in plan-only mode', async () => {
    resetChatState({
      executionMode: 'plan',
      permissionMode: 'plan-only',
      workDir: '/tmp/pipi/session-1',
    });
    mockShouldSavePlanDoc.mockReturnValue(false);

    await useChatStore.getState().sendMessage('Explain Plan Mode');

    expect(mockRunChatTurn).toHaveBeenCalledWith(
      'session-1',
      expect.any(Array),
      expect.stringContaining('# PLAN MODE ACTIVATED'),
      '/tmp/pipi/session-1',
      false,
      undefined,
      expect.objectContaining({
        allowedTools: ['read_file', 'list_files', 'search_files'],
        signal: expect.any(AbortSignal),
      }),
      undefined,
    );
    expect(mockSavePlanModeDoc).not.toHaveBeenCalled();
  });

  // Option A — auto-save must use the REAL PiPi Output Folder, not
  // the JS-only `PiPi-Shrimp/chats/<id>` placeholder. The chat store
  // resolves the path via `resolveRealSessionPipiOutputDir(session)`,
  // which calls `get_app_default_dir` when `pipiOutputDir` is unset.
  // We mock `get_app_default_dir` to a known on-disk path and assert
  // that `savePlanModeDoc` receives exactly that path (NOT a
  // `PiPi-Shrimp/chats/...` placeholder string).
  it('Plan auto-save uses the real PiPi Output Folder (resolved via get_app_default_dir), not the JS placeholder', async () => {
    resetChatState({
      executionMode: 'plan',
      permissionMode: 'plan-only',
      workDir: '/tmp/pipi/session-1',
    });
    mockRunChatTurn.mockImplementation(() => streamPlanAssistantReply());
    const realPipiOutputDir = 'C:/Users/test/Documents/PiPi-Shrimp/chats/session-1';
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_app_default_dir') return realPipiOutputDir;
      if (command === 'create_directory') return null;
      if (command === 'db_save_session') return null;
      return undefined;
    });

    await useChatStore.getState().sendMessage('帮我实现一个新的设置项');

    expect(mockSavePlanModeDoc).toHaveBeenCalledTimes(1);
    expect(mockSavePlanModeDoc).toHaveBeenCalledWith(expect.objectContaining({
      // The argument MUST be the real Tauri-resolved path, not the
      // JS-side `PiPi-Shrimp/chats/session-1` placeholder.
      workDir: realPipiOutputDir,
      sessionId: 'session-1',
    }));
    // Hard guard: the JS placeholder pattern must never be the
    // destination of a real save call.
    expect(mockSavePlanModeDoc).not.toHaveBeenCalledWith(expect.objectContaining({
      workDir: expect.stringMatching(/^PiPi-Shrimp\/chats\//),
    }));
  });

  // Option A — when `get_app_default_dir` returns null (Tauri not
  // available, e.g. in browser/Jest), the chat store MUST skip the
  // auto-save rather than write to the JS placeholder. We assert the
  // store stays quiet on success and the user gets a clear warning.
  it('Plan auto-save skips when get_app_default_dir returns null and warns the user', async () => {
    resetChatState({
      executionMode: 'plan',
      permissionMode: 'plan-only',
      workDir: '/tmp/pipi/session-1',
    });
    mockRunChatTurn.mockImplementation(() => streamPlanAssistantReply());
    mockInvoke.mockImplementation(async () => null);

    await useChatStore.getState().sendMessage('帮我实现一个新的设置项');

    // No save — we cannot guarantee a real on-disk folder.
    expect(mockSavePlanModeDoc).not.toHaveBeenCalled();
    // The user is told the plan was generated but could not be saved.
    expect(mockAddNotification).toHaveBeenCalledWith(
      'warning',
      expect.stringMatching(/no working directory was available/i),
      'session-1',
    );
  });

  it('routes Bypass mode through full tools in sendMessage', async () => {
    resetChatState({ executionMode: 'bypass', permissionMode: 'bypass' });

    await useChatStore.getState().sendMessage('详细阅读一下这个项目吧');

    const [sessionId, messages, systemPrompt, projectDir, allowBrowserTools, requestConfig, options, pipiOutputDir] =
      (mockRunChatTurn as jest.Mock).mock.calls[0];
    expect(sessionId).toBe('session-1');
    expect(messages).toEqual(expect.any(Array));
    expect(systemPrompt).toContain('system prompt');
    expect(systemPrompt).toContain('# DANGER HARNESS');
    expect(projectDir).toBeUndefined();
    expect(allowBrowserTools).toBe(false);
    expect(requestConfig).toBeUndefined();
    expect(options?.allowedTools).toBeUndefined();
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(pipiOutputDir).toBeUndefined();
  });

  it('routes Ask mode through noTools so the model cannot enter a tool loop', async () => {
    resetChatState({ executionMode: 'ask', permissionMode: 'plan-only' });

    await useChatStore.getState().sendMessage('介绍一下这个项目的大概方向');

    expect(mockRunChatTurn).toHaveBeenCalledWith(
      'session-1',
      expect.any(Array),
      expect.stringContaining('# ASK HARNESS'),
      undefined,
      false,
      undefined,
      expect.objectContaining({ noTools: true }),
      undefined,
    );
  });

  // Non-Plan modes still need a model-facing allowlist whenever the
  // execution-mode guard is stricter than the raw global catalog.
  // This keeps Agent/Debug from seeing browser/MCP/sub-agent tools that
  // would be rejected immediately by the outer guard.
  it('replaces Ask-mode pseudo tool-call text with a no-tools guidance reply', async () => {
    resetChatState({ executionMode: 'ask', permissionMode: 'plan-only' });
    mockRunChatTurn.mockImplementation(() => streamAskModePseudoToolReply());

    await useChatStore.getState().sendMessage('介绍一下这个项目的大概方向。');

    const session = useChatStore.getState().sessions.find((candidate) => candidate.id === 'session-1');
    expect(session?.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', '介绍一下这个项目的大概方向。'],
      ['assistant', '问答模式这回合不能调用工具。如果需要读取文件、执行命令或改动代码，请切到规划或危险模式。'],
    ]);
    expect(mockShowExecutionModeUpgradePrompt).not.toHaveBeenCalled();
  });

  it('upgrades Ask mode to Plan when a tool-requiring message is sent', async () => {
    resetChatState({ executionMode: 'ask', permissionMode: 'plan-only' });

    await useChatStore.getState().sendMessage('读取 README 并总结。');

    expect(mockShowExecutionModeUpgradePrompt).toHaveBeenCalledWith({
      reason: 'workspace',
      messagePreview: '读取 README 并总结。',
    });
    const session = useChatStore.getState().sessions.find((candidate) => candidate.id === 'session-1');
    expect(session?.executionMode).toBe('plan');
    expect(mockRunChatTurn).not.toHaveBeenCalledWith(
      'session-1',
      expect.any(Array),
      expect.any(String),
      undefined,
      false,
      undefined,
      expect.objectContaining({ noTools: true }),
    );
  });

  it('Danger mode sendMessage does not pass a restricted allowlist', async () => {
    resetChatState({ executionMode: 'danger', permissionMode: 'auto-edits' });
    await useChatStore.getState().sendMessage('Explore the project');

    const calls = (mockRunChatTurn as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const seventh = calls[0]?.[6];
    expect(seventh?.allowedTools).toBeUndefined();
  });

  it('Bypass mode sendMessage never passes save_plan_doc in allowedTools', async () => {
    resetChatState({ executionMode: 'bypass', permissionMode: 'bypass' });
    await useChatStore.getState().sendMessage('Explore the project');

    for (const call of (mockRunChatTurn as jest.Mock).mock.calls) {
      const seventh = call[6];
      if (seventh && Array.isArray(seventh.allowedTools)) {
        expect(seventh.allowedTools).not.toContain('save_plan_doc');
      }
    }
  });

  it('P0-1 regression: stopGeneration halts active streaming and resets streaming flags', async () => {
    async function* stoppingStream() {
      yield { type: 'text_delta' as const, content: 'first chunk' };
      await useChatStore.getState().stopGeneration();
      yield { type: 'text_delta' as const, content: 'second chunk' };
    }

    mockRunChatTurn.mockImplementation(() => stoppingStream());

    await useChatStore.getState().sendMessage('test streaming stop');

    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().streamingSessionId).toBeNull();
  });

  it('P0-2 regression: switching session while streaming cancels turn and prevents replaying to new session', async () => {
    const currentSessions = useChatStore.getState().sessions;
    useChatStore.setState({
      sessions: [
        ...currentSessions,
        {
          id: 'session-2',
          title: 'Second Session',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          permissionMode: 'standard',
          executionMode: 'agent',
        },
      ],
    });

    async function* streamToSwitch() {
      yield { type: 'text_delta' as const, content: 'chunk from session 1' };
      useChatStore.getState().selectSession('session-2');
      yield { type: 'text_delta' as const, content: 'bleed chunk' };
    }
    mockRunChatTurn.mockImplementation(() => streamToSwitch());

    await useChatStore.getState().sendMessage('send in session 1');

    const session2 = useChatStore.getState().sessions.find((s) => s.id === 'session-2');
    // Session 2 should have NO messages from session 1
    expect(session2?.messages).toEqual([]);
    expect(useChatStore.getState().currentSessionId).toBe('session-2');
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('soak knife 3: Stop clears busy UI before slow native cancel resolves (≤1s feel)', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-slow', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-slow',
      'execute_command',
      'exec-slow-1',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    mockSetTaskProgress.mockClear();
    const stopPromise = useChatStore.getState().stopGeneration();
    // Optimistic UI must clear before native cancel finishes.
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().pendingToolCalls).toBe(0);
    expect(useChatStore.getState().streamingSessionId).toBeNull();
    // Intermediate cancelling TaskStep while native cancel is in flight.
    expect(mockSetTaskProgress).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tool-slow', status: 'cancelling' }),
      ]),
    );

    releaseCancel();
    await stopPromise;

    expect(mockInvoke).toHaveBeenCalledWith('cancel_tool_execution', { executionId: 'exec-slow-1' });
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(mockSetTaskProgress).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tool-slow', status: 'cancelled' }),
      ]),
    );
  });

  it('soak knife 3: after Stop completes, pendingToolResults / busy do not rebound (Stop stays hidden)', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-slow', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-slow',
      'execute_command',
      'exec-slow-rebound',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
      pendingToolResults: [{ toolCallId: 'tool-slow', result: '' }],
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    let releaseNoticeSave!: () => void;
    const noticeSaveGate = new Promise<void>((resolve) => {
      releaseNoticeSave = resolve;
    });
    let noticeSaveHolds = 0;

    mockInvoke.mockImplementation(async (command: unknown, args?: { message?: { content?: string } }) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      if (command === 'db_save_message') {
        const content = args?.message?.content;
        if (typeof content === 'string' && content.includes('Tool run cancelled by user')) {
          noticeSaveHolds += 1;
          // Post-terminalize: failUnresolved + idle re-assert already ran.
          const state = useChatStore.getState();
          expect(state.pendingToolCalls).toBe(0);
          expect(state.pendingToolResults).toEqual([]);
          expect(shouldShowStopControl({
            isStreaming: state.isStreaming,
            pendingToolCalls: state.pendingToolCalls,
            pendingToolResultsLength: state.pendingToolResults.length,
          })).toBe(false);
          await noticeSaveGate;
        }
        return undefined;
      }
      return undefined;
    });

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    const mid = useChatStore.getState();
    expect(mid.isStreaming).toBe(false);
    expect(mid.pendingToolCalls).toBe(0);
    expect(mid.pendingToolResults).toEqual([]);
    expect(shouldShowStopControl({
      isStreaming: mid.isStreaming,
      pendingToolCalls: mid.pendingToolCalls,
      pendingToolResultsLength: mid.pendingToolResults.length,
    })).toBe(false);

    releaseCancel();
    for (let i = 0; i < 120 && noticeSaveHolds === 0; i += 1) {
      await Promise.resolve();
    }
    expect(noticeSaveHolds).toBeGreaterThan(0);

    const duringNotice = useChatStore.getState();
    expect(duringNotice.pendingToolCalls).toBe(0);
    expect(duringNotice.pendingToolResults).toEqual([]);
    expect(shouldShowStopControl({
      isStreaming: duringNotice.isStreaming,
      pendingToolCalls: duringNotice.pendingToolCalls,
      pendingToolResultsLength: duringNotice.pendingToolResults.length,
    })).toBe(false);

    releaseNoticeSave();
    await stopPromise;

    const done = useChatStore.getState();
    expect(done.pendingToolCalls).toBe(0);
    expect(done.pendingToolResults).toEqual([]);
    expect(done.isStreaming).toBe(false);
    expect(shouldShowStopControl({
      isStreaming: done.isStreaming,
      pendingToolCalls: done.pendingToolCalls,
      pendingToolResultsLength: done.pendingToolResults.length,
    })).toBe(false);

    // Sync after terminalize must not resurrect busy flags from leftover results.
    syncSessionToolRuntimeToCurrentSession(useChatStore.setState, useChatStore.getState);
    const afterSync = useChatStore.getState();
    expect(afterSync.pendingToolResults).toEqual([]);
    expect(shouldShowStopControl({
      isStreaming: afterSync.isStreaming,
      pendingToolCalls: afterSync.pendingToolCalls,
      pendingToolResultsLength: afterSync.pendingToolResults.length,
    })).toBe(false);
  });

  it('soak knife 3: Stop on A does not mutate B history or tool runtime', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });
    const historyB = [
      {
        id: 'b-u0',
        role: 'user' as const,
        content: 'hello B',
        timestamp: 1,
      },
      {
        id: 'b-a0',
        role: 'assistant' as const,
        content: 'B is fine',
        timestamp: 2,
      },
    ];
    const current = useChatStore.getState().sessions;
    useChatStore.setState({
      sessions: [
        ...current,
        {
          id: 'session-B',
          title: 'Session B',
          messages: historyB,
          createdAt: 2,
          updatedAt: 2,
          permissionMode: 'auto-edits',
          executionMode: 'agent',
          workDir: '/tmp/pipi/session-B',
          projectDir: '/tmp/pipi/session-B',
        },
      ],
    });

    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-a', name: 'read_file' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-a',
      'read_file',
      'exec-a-1',
      useChatStore.setState,
      useChatStore.getState,
    );
    seedSessionToolRuntime(
      'session-B',
      [{ id: 'tool-b', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-B',
      'tool-b',
      'execute_command',
      'exec-b-1',
      useChatStore.setState,
      useChatStore.getState,
    );

    useChatStore.setState({
      currentSessionId: 'session-1',
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
    });

    mockInvoke.mockResolvedValue({ cancelled: true, status: 'cancelled' });
    await useChatStore.getState().stopGeneration();

    const sessionA = useChatStore.getState().sessions.find((s) => s.id === 'session-1')!;
    const sessionB = useChatStore.getState().sessions.find((s) => s.id === 'session-B')!;
    expect(sessionA.messages.some((m) => (
      typeof m.content === 'string' && m.content.includes('Tool run cancelled by user')
    ))).toBe(true);
    expect(sessionB.messages).toEqual(historyB);
    expect(sessionB.messages.some((m) => (
      typeof m.content === 'string' && m.content.includes('cancelled by user')
    ))).toBe(false);

    // Native cancel only for A's execution id
    const cancelCalls = mockInvoke.mock.calls.filter((call) => call[0] === 'cancel_tool_execution');
    expect(cancelCalls).toEqual([
      ['cancel_tool_execution', { executionId: 'exec-a-1' }],
    ]);

    // B's in-flight tool runtime remains complete (not just history untouched).
    expect(listUnresolvedSessionTools('session-B')).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-b',
        label: 'execute_command',
        executionId: 'exec-b-1',
      }),
    ]);
    expect(listCancellableSessionExecutionIds('session-B')).toEqual(['exec-b-1']);
    expect(listUnresolvedSessionTools('session-1')).toEqual([]);
  });

  it('soak knife 3: selectSession rebinds busy flags to the selected session only', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });
    const current = useChatStore.getState().sessions;
    useChatStore.setState({
      sessions: [
        ...current,
        {
          id: 'session-B',
          title: 'Session B',
          messages: [],
          createdAt: 2,
          updatedAt: 2,
          permissionMode: 'auto-edits',
          executionMode: 'agent',
        },
      ],
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 2,
      pendingToolResults: [{ toolCallId: 'x', result: '' }],
    });

    // B already has in-flight tools while A is selected — switch must rebind
    // global busy to B's runtime, not merely clear to idle.
    seedSessionToolRuntime(
      'session-B',
      [{ id: 'tool-b', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-B',
      'tool-b',
      'execute_command',
      'exec-b-rebind',
      useChatStore.setState,
      useChatStore.getState,
    );

    useChatStore.getState().selectSession('session-B');

    expect(useChatStore.getState().currentSessionId).toBe('session-B');
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().streamingSessionId).toBeNull();
    expect(useChatStore.getState().pendingToolCalls).toBe(1);
    expect(useChatStore.getState().pendingToolResults).toEqual([]);
    expect(listUnresolvedSessionTools('session-B')).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-b',
        executionId: 'exec-b-rebind',
      }),
    ]);
  });

  it('soak knife 3: same-session new-turn race — stale Stop completion does not wipe post-Stop turn', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-old', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-old',
      'execute_command',
      'exec-old-1',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    // Simulate sendMessage starting a new same-session turn while cancel settles.
    bumpChatSessionTurnEpoch('session-1');
    clearSessionToolRuntime('session-1', useChatStore.setState, useChatStore.getState);
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-new', name: 'read_file' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-new',
      'read_file',
      'exec-new-1',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
    });

    releaseCancel();
    await stopPromise;

    expect(listUnresolvedSessionTools('session-1')).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-new',
        label: 'read_file',
        executionId: 'exec-new-1',
      }),
    ]);
    expect(useChatStore.getState().pendingToolCalls).toBe(1);
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingSessionId).toBe('session-1');
  });

  it('soak knife 3: concurrent old-send → Stop(slow cancel) → new-send does not wipe new turn', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    let releaseOldStream!: (mode: 'abort' | 'continue') => void;
    const oldStreamGate = new Promise<'abort' | 'continue'>((resolve) => {
      releaseOldStream = resolve;
    });
    let runChatTurnCalls = 0;

    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      if (runChatTurnCalls === 1) {
        return (async function* () {
          yield { type: 'text_delta' as const, content: 'old-turn ' };
          const mode = await oldStreamGate;
          if (mode === 'abort') {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          yield {
            type: 'turn_complete' as const,
            tokenUsage: { input_tokens: 1, output_tokens: 1, model: 'mock-model' },
          };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta' as const, content: 'fresh-after-stop' };
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    const sendOld = useChatStore.getState().sendMessage('old message');
    // isStreaming flips before createChatTurnAbortController / runChatTurn — wait
    // until the old turn owns the abort controller + engine, or Stop→Send during
    // the post-scrub window correctly aborts the stale path (call-order mocks break).
    for (let i = 0; i < 80 && (runChatTurnCalls < 1 || !useChatStore.getState().isStreaming); i += 1) {
      await Promise.resolve();
    }
    expect(runChatTurnCalls).toBeGreaterThanOrEqual(1);
    expect(useChatStore.getState().isStreaming).toBe(true);

    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-old', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-old',
      'execute_command',
      'exec-old-race',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({ pendingToolCalls: 1 });

    expect(useTaskRegistryStore.getState().tasks.some((t) => t.source === 'session:session-1')).toBe(true);

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    // Distinct Date.now() for the new diagnostics task id under fake timers.
    jest.advanceTimersByTime(25);

    const sendNew = useChatStore.getState().sendMessage('new message after stop');
    for (let i = 0; i < 80 && useChatStore.getState().sessions[0]?.messages.filter((m) => m.role === 'user').length < 2; i += 1) {
      await Promise.resolve();
    }
    expect(useChatStore.getState().sessions[0]?.messages.filter((m) => m.role === 'user')).toHaveLength(2);

    // Old send's cancel catch runs after new send bumped the epoch.
    releaseOldStream('abort');
    await sendOld;

    releaseCancel();
    await Promise.all([stopPromise, sendNew]);

    const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1')!;
    const userContents = session.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userContents).toEqual(expect.arrayContaining(['old message', 'new message after stop']));
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().streamingSessionId).toBeNull();
    expect(useChatStore.getState().pendingToolCalls).toBe(0);
    expect(session.messages.some((m) => (
      m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('fresh-after-stop')
    ))).toBe(true);

    const newTask = useTaskRegistryStore.getState().tasks.find((t) => (
      t.source === 'session:session-1' && (t.title ?? '').includes('new message after stop')
    ));
    expect(newTask).toBeDefined();
    expect(newTask!.state).toBe('completed');
  });

  it('soak knife 3: Stop with null diagnostics snapshot must not cancel newer turn task', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });
    // Streaming/tools without a registered diagnostics binding (snapshot null).
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-orphan', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-orphan',
      'execute_command',
      'exec-orphan-1',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    jest.advanceTimersByTime(5);
    mockRunChatTurn.mockImplementation(() => streamOneAssistantReply());
    const sendNew = useChatStore.getState().sendMessage('fresh turn mid-cancel');
    for (let i = 0; i < 40 && !useChatStore.getState().isStreaming && useTaskRegistryStore.getState().tasks.length === 0; i += 1) {
      await Promise.resolve();
    }

    const midTasks = useTaskRegistryStore.getState().tasks.filter((t) => t.source === 'session:session-1');
    expect(midTasks.length).toBeGreaterThan(0);
    const newTaskId = midTasks[midTasks.length - 1]!.id;

    releaseCancel();
    await stopPromise;
    await sendNew;

    const after = useTaskRegistryStore.getState().tasks.find((t) => t.id === newTaskId);
    expect(after).toBeDefined();
    expect(after!.state).toBe('completed');
    expect(after!.state).not.toBe('cancelled');
  });

  it('GPT FIX: stale cancel catch must not clear newer turn streaming buffer', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    let releaseOldStream!: (mode: 'abort' | 'continue') => void;
    const oldStreamGate = new Promise<'abort' | 'continue'>((resolve) => {
      releaseOldStream = resolve;
    });
    let releaseNewStream!: () => void;
    const newStreamGate = new Promise<void>((resolve) => {
      releaseNewStream = resolve;
    });
    let runChatTurnCalls = 0;

    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      if (runChatTurnCalls === 1) {
        return (async function* () {
          yield { type: 'text_delta' as const, content: 'old-stale ' };
          const mode = await oldStreamGate;
          if (mode === 'abort') {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          yield {
            type: 'turn_complete' as const,
            tokenUsage: { input_tokens: 1, output_tokens: 1, model: 'mock-model' },
          };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta' as const, content: 'NEW-TURN-BUFFER-KEEP' };
        // Hold mid-stream so buffer is populated while old cancel catch runs.
        await newStreamGate;
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    const sendOld = useChatStore.getState().sendMessage('old for buffer race');
    for (let i = 0; i < 80 && (runChatTurnCalls < 1 || !useChatStore.getState().isStreaming); i += 1) {
      await Promise.resolve();
    }
    expect(runChatTurnCalls).toBeGreaterThanOrEqual(1);
    expect(useChatStore.getState().isStreaming).toBe(true);

    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-old', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-old',
      'execute_command',
      'exec-buffer-race',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({ pendingToolCalls: 1 });

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    jest.advanceTimersByTime(25);
    const sendNew = useChatStore.getState().sendMessage('new for buffer race');
    for (let i = 0; i < 80; i += 1) {
      if (getCurrentStreamingBufferForTests().includes('NEW-TURN-BUFFER-KEEP')) {
        break;
      }
      await Promise.resolve();
    }
    expect(getCurrentStreamingBufferForTests()).toContain('NEW-TURN-BUFFER-KEEP');

    // Stale cancelled turn's catch runs while new turn owns the buffer.
    releaseOldStream('abort');
    await sendOld;

    expect(getCurrentStreamingBufferForTests()).toContain('NEW-TURN-BUFFER-KEEP');

    releaseNewStream();
    releaseCancel();
    await Promise.all([stopPromise, sendNew]);

    const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1')!;
    expect(session.messages.some((m) => (
      m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('NEW-TURN-BUFFER-KEEP')
    ))).toBe(true);
  });

  it('GPT FIX: stale send finally must not clear newer turn cancel marker', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    let releaseOldStream!: (mode: 'abort' | 'continue') => void;
    const oldStreamGate = new Promise<'abort' | 'continue'>((resolve) => {
      releaseOldStream = resolve;
    });
    let releaseNewStream!: () => void;
    const newStreamGate = new Promise<void>((resolve) => {
      releaseNewStream = resolve;
    });
    let runChatTurnCalls = 0;

    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      if (runChatTurnCalls === 1) {
        return (async function* () {
          yield { type: 'text_delta' as const, content: 'old-cancel-marker ' };
          const mode = await oldStreamGate;
          if (mode === 'abort') {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          yield {
            type: 'turn_complete' as const,
            tokenUsage: { input_tokens: 1, output_tokens: 1, model: 'mock-model' },
          };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta' as const, content: 'new-still-streaming' };
        // Hold AFTER first chunk was pulled+consume-checked, so a later
        // requestChatGenerationCancel stays parked for the finally proof.
        await newStreamGate;
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    const sendOld = useChatStore.getState().sendMessage('old for cancel-marker race');
    for (let i = 0; i < 80 && (runChatTurnCalls < 1 || !useChatStore.getState().isStreaming); i += 1) {
      await Promise.resolve();
    }
    expect(runChatTurnCalls).toBeGreaterThanOrEqual(1);

    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-old', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-old',
      'execute_command',
      'exec-cancel-marker-race',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({ pendingToolCalls: 1 });

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    jest.advanceTimersByTime(25);
    const sendNew = useChatStore.getState().sendMessage('new for cancel-marker race');
    // Wait until new turn has processed its first delta (consume check already ran).
    for (let i = 0; i < 80; i += 1) {
      if (getCurrentStreamingBufferForTests().includes('new-still-streaming')) {
        break;
      }
      await Promise.resolve();
    }
    expect(getCurrentStreamingBufferForTests()).toContain('new-still-streaming');
    expect(useChatStore.getState().isStreaming).toBe(true);

    // New turn is mid-stream past its consume check: Stop marker belongs to it.
    requestChatGenerationCancel('session-1');

    // Stale old send settles; unguarded finally would clear the new turn's marker.
    releaseOldStream('abort');
    await sendOld;

    // Marker must still be present for the new turn to observe Stop.
    expect(consumeChatGenerationCancel('session-1')).toBe(true);

    releaseNewStream();
    releaseCancel();
    await Promise.all([stopPromise, sendNew]);
  });

  it('GPT FIX: stale real-error catch must not clear newer turn streaming/error/skill', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    let releaseOldStream!: (mode: 'abort' | 'error' | 'continue') => void;
    const oldStreamGate = new Promise<'abort' | 'error' | 'continue'>((resolve) => {
      releaseOldStream = resolve;
    });
    let releaseNewStream!: () => void;
    const newStreamGate = new Promise<void>((resolve) => {
      releaseNewStream = resolve;
    });
    let runChatTurnCalls = 0;

    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      if (runChatTurnCalls === 1) {
        return (async function* () {
          yield { type: 'text_delta' as const, content: 'old-real-error ' };
          const mode = await oldStreamGate;
          if (mode === 'abort') {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          if (mode === 'error') {
            throw new Error('boom-stale-real-error');
          }
          yield {
            type: 'turn_complete' as const,
            tokenUsage: { input_tokens: 1, output_tokens: 1, model: 'mock-model' },
          };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta' as const, content: 'NEW-TURN-KEEP-STREAMING' };
        await newStreamGate;
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    const sendOld = useChatStore.getState().sendMessage('old for real-error race');
    for (let i = 0; i < 80 && (runChatTurnCalls < 1 || !useChatStore.getState().isStreaming); i += 1) {
      await Promise.resolve();
    }
    expect(runChatTurnCalls).toBeGreaterThanOrEqual(1);
    expect(useChatStore.getState().isStreaming).toBe(true);

    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-old', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-old',
      'execute_command',
      'exec-real-error-race',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({ pendingToolCalls: 1 });

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    jest.advanceTimersByTime(25);
    const sendNew = useChatStore.getState().sendMessage('new for real-error race');
    for (let i = 0; i < 80; i += 1) {
      if (getCurrentStreamingBufferForTests().includes('NEW-TURN-KEEP-STREAMING')) {
        break;
      }
      await Promise.resolve();
    }
    expect(getCurrentStreamingBufferForTests()).toContain('NEW-TURN-KEEP-STREAMING');
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().error).toBeNull();

    mockSetActiveSkill.mockClear();

    // Stale older turn fails with a real (non-cancel) error while newer turn owns UI.
    releaseOldStream('error');
    await sendOld;

    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingSessionId).toBe('session-1');
    expect(getCurrentStreamingBufferForTests()).toContain('NEW-TURN-KEEP-STREAMING');
    expect(useChatStore.getState().error).toBeNull();
    expect(mockSetActiveSkill).not.toHaveBeenCalledWith(null);

    releaseNewStream();
    releaseCancel();
    await Promise.all([stopPromise, sendNew]);

    const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1')!;
    expect(session.messages.some((m) => (
      m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('NEW-TURN-KEEP-STREAMING')
    ))).toBe(true);
  });

  it('GPT FIX: stale real-error catch must not delete newer turn placeholder by last-message', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    let releaseOldStream!: (mode: 'error' | 'continue') => void;
    const oldStreamGate = new Promise<'error' | 'continue'>((resolve) => {
      releaseOldStream = resolve;
    });
    let releaseNewStream!: () => void;
    const newStreamGate = new Promise<void>((resolve) => {
      releaseNewStream = resolve;
    });
    let runChatTurnCalls = 0;
    let newAssistantPlaceholderId: string | null = null;

    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      if (runChatTurnCalls === 1) {
        return (async function* () {
          // No deltas — leave old assistant as empty placeholder until error.
          const mode = await oldStreamGate;
          if (mode === 'error') {
            throw new Error('boom-stale-placeholder');
          }
          yield {
            type: 'turn_complete' as const,
            tokenUsage: { input_tokens: 1, output_tokens: 1, model: 'mock-model' },
          };
        })();
      }
      return (async function* () {
        // Capture the new turn's empty assistant id before any content arrives.
        const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1');
        const assistants = session?.messages.filter((m) => m.role === 'assistant') ?? [];
        newAssistantPlaceholderId = assistants[assistants.length - 1]?.id ?? null;
        // Hold with empty placeholder still present (no text_delta yet).
        await newStreamGate;
        yield { type: 'text_delta' as const, content: 'new-placeholder-survived' };
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    const sendOld = useChatStore.getState().sendMessage('old for placeholder race');
    for (let i = 0; i < 100; i += 1) {
      const msgs = useChatStore.getState().sessions[0]?.messages ?? [];
      if (runChatTurnCalls >= 1 && msgs.some((m) => m.role === 'assistant' && !m.content)) {
        break;
      }
      await Promise.resolve();
    }
    expect(runChatTurnCalls).toBeGreaterThanOrEqual(1);
    expect(useChatStore.getState().sessions[0]?.messages.some((m) => m.role === 'assistant')).toBe(true);

    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-old', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-old',
      'execute_command',
      'exec-placeholder-race',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({ pendingToolCalls: 1, isStreaming: true, streamingSessionId: 'session-1' });

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    jest.advanceTimersByTime(25);
    const sendNew = useChatStore.getState().sendMessage('new for placeholder race');
    for (let i = 0; i < 100; i += 1) {
      if (newAssistantPlaceholderId) {
        break;
      }
      await Promise.resolve();
    }
    expect(newAssistantPlaceholderId).toBeTruthy();
    const placeholderIdAtRisk = newAssistantPlaceholderId!;
    expect(
      useChatStore.getState().sessions[0]?.messages.some((m) => m.id === placeholderIdAtRisk),
    ).toBe(true);

    // Stale real-error path (unguarded last-message delete) would remove the
    // newer turn's empty assistant placeholder that is currently last.
    releaseOldStream('error');
    await sendOld;

    expect(
      useChatStore.getState().sessions[0]?.messages.some((m) => m.id === placeholderIdAtRisk),
    ).toBe(true);

    releaseNewStream();
    releaseCancel();
    await Promise.all([stopPromise, sendNew]);

    const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1')!;
    expect(session.messages.some((m) => (
      m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('new-placeholder-survived')
    ))).toBe(true);
  });

  it('GPT FIX: stopGeneration must re-check epoch after scrub await before pending wipe / stop_subprocess / placeholder', async () => {
    const oldAssistant = createMessage('assistant', '');
    oldAssistant.tool_calls = [{
      id: 'tool-old',
      name: 'execute_command',
      arguments: '{}',
    }];
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
      messages: [
        createMessage('user', 'old stop mid-await'),
        oldAssistant,
      ],
    });
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-old', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-old',
      'execute_command',
      'exec-old-mid-await',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
      streamingContent: 'old-partial',
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    let releaseScrubSave!: () => void;
    const scrubSaveGate = new Promise<void>((resolve) => {
      releaseScrubSave = resolve;
    });
    const stopSubprocessCalls: unknown[] = [];
    let scrubSaveHolds = 0;

    mockInvoke.mockImplementation(async (command: unknown, args?: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      if (command === 'db_save_message') {
        // Eager scrub persists cleaned assistants BEFORE native cancel settles.
        scrubSaveHolds += 1;
        await scrubSaveGate;
        return undefined;
      }
      if (command === 'stop_subprocess') {
        stopSubprocessCalls.push(args);
        return undefined;
      }
      return undefined;
    });

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    // Eager scrub runs before cancel — wait for scrub DB await without releasing cancel.
    for (let i = 0; i < 80 && scrubSaveHolds === 0; i += 1) {
      await Promise.resolve();
    }
    expect(scrubSaveHolds).toBeGreaterThan(0);

    // New same-session turn starts while scrub DB save is still awaiting.
    bumpChatSessionTurnEpoch('session-1');
    clearSessionToolRuntime('session-1', useChatStore.setState, useChatStore.getState);
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-new', name: 'read_file' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-new',
      'read_file',
      'exec-new-mid-await',
      useChatStore.setState,
      useChatStore.getState,
    );
    const newPlaceholder = createMessage('assistant', '');
    useChatStore.setState((state) => ({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
      sessions: state.sessions.map((session) => (
        session.id === 'session-1'
          ? {
              ...session,
              messages: [
                ...session.messages,
                createMessage('user', 'new after stop scrub'),
                newPlaceholder,
              ],
            }
          : session
      )),
    }));

    // After epoch bump, cancel completion must not call stop_subprocess or wipe the new turn.
    const stopCallsBeforeRelease = stopSubprocessCalls.length;
    releaseScrubSave();
    releaseCancel();
    await stopPromise;

    expect(stopSubprocessCalls.length).toBe(stopCallsBeforeRelease);
    expect(useChatStore.getState().pendingToolCalls).toBe(1);
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingSessionId).toBe('session-1');
    expect(listUnresolvedSessionTools('session-1')).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-new',
        executionId: 'exec-new-mid-await',
      }),
    ]);
    expect(
      useChatStore.getState().sessions[0]?.messages.some((m) => m.id === newPlaceholder.id),
    ).toBe(true);
  });

  it('GPT FIX: stale policy recovery must not show upgrade prompt', async () => {
    resetChatState({
      executionMode: 'plan',
      permissionMode: 'plan-only',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    let releaseOldStream!: () => void;
    const oldStreamGate = new Promise<void>((resolve) => {
      releaseOldStream = resolve;
    });
    let runChatTurnCalls = 0;

    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      if (runChatTurnCalls === 1) {
        return (async function* () {
          yield { type: 'text_delta' as const, content: 'policy-old ' };
          await oldStreamGate;
          throw new Error('Every tool call in the last round was rejected by the safety policy.');
        })();
      }
      return (async function* () {
        yield { type: 'text_delta' as const, content: 'new-turn-ok' };
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    const sendOld = useChatStore.getState().sendMessage('读取 README 并总结');
    for (let i = 0; i < 50 && !useChatStore.getState().isStreaming; i += 1) {
      await Promise.resolve();
    }
    expect(useChatStore.getState().isStreaming).toBe(true);
    const oldEpoch = getChatSessionTurnEpoch('session-1');

    // Simulate a newer same-session turn owning the epoch before recovery runs.
    bumpChatSessionTurnEpoch('session-1');
    expect(getChatSessionTurnEpoch('session-1')).not.toBe(oldEpoch);

    mockShowExecutionModeUpgradePrompt.mockClear();
    releaseOldStream();
    await sendOld;

    expect(mockShowExecutionModeUpgradePrompt).not.toHaveBeenCalled();
  });

  it('GPT FIX: policy recovery must not auto-retry after epoch moves during upgrade prompt', async () => {
    resetChatState({
      executionMode: 'plan',
      permissionMode: 'plan-only',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    let releasePrompt!: (choice: 'agent' | 'cancel') => void;
    const promptGate = new Promise<'agent' | 'cancel'>((resolve) => {
      releasePrompt = resolve;
    });
    mockShowExecutionModeUpgradePrompt.mockImplementation(async () => promptGate);

    let runChatTurnCalls = 0;
    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      if (runChatTurnCalls === 1) {
        return (async function* () {
          yield { type: 'text_delta' as const, content: 'before-policy ' };
          throw new Error('Every tool call in the last round was rejected by the safety policy.');
        })();
      }
      return (async function* () {
        yield { type: 'text_delta' as const, content: 'should-not-auto-retry' };
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    const sendOld = useChatStore.getState().sendMessage('读取 README 并总结');
    for (let i = 0; i < 80 && mockShowExecutionModeUpgradePrompt.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(mockShowExecutionModeUpgradePrompt).toHaveBeenCalled();
    const epochAtPrompt = getChatSessionTurnEpoch('session-1');

    // Newer turn starts while the user is staring at the upgrade dialog.
    bumpChatSessionTurnEpoch('session-1');
    expect(getChatSessionTurnEpoch('session-1')).not.toBe(epochAtPrompt);
    const runCallsBeforeRelease = runChatTurnCalls;

    releasePrompt('agent');
    await sendOld;

    // Stale recovery must not kick off rollback+sendMessage retry.
    expect(runChatTurnCalls).toBe(runCallsBeforeRelease);
    expect(
      useChatStore.getState().sessions[0]?.messages.some((m) => (
        typeof m.content === 'string' && m.content.includes('should-not-auto-retry')
      )),
    ).toBe(false);
  });

  it('GPT FIX: policy recovery must not auto-retry after epoch moves during rollback await', async () => {
    resetChatState({
      executionMode: 'plan',
      permissionMode: 'plan-only',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    mockShowExecutionModeUpgradePrompt.mockResolvedValue('agent');

    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deleteHolds = 0;
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'db_delete_message') {
        deleteHolds += 1;
        await deleteGate;
        return undefined;
      }
      return undefined;
    });

    let runChatTurnCalls = 0;
    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      if (runChatTurnCalls === 1) {
        return (async function* () {
          yield { type: 'text_delta' as const, content: 'before-rollback-race ' };
          throw new Error('Every tool call in the last round was rejected by the safety policy.');
        })();
      }
      return (async function* () {
        yield { type: 'text_delta' as const, content: 'extra-retry-should-not-run' };
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    const sendOld = useChatStore.getState().sendMessage('读取 README 并总结');
    for (let i = 0; i < 120 && deleteHolds === 0; i += 1) {
      await Promise.resolve();
    }
    expect(deleteHolds).toBeGreaterThan(0);
    expect(mockShowExecutionModeUpgradePrompt).toHaveBeenCalled();

    const epochAtRollback = getChatSessionTurnEpoch('session-1');
    bumpChatSessionTurnEpoch('session-1');
    expect(getChatSessionTurnEpoch('session-1')).not.toBe(epochAtRollback);
    const runCallsAtRollback = runChatTurnCalls;

    releaseDelete();
    await sendOld;

    expect(runChatTurnCalls).toBe(runCallsAtRollback);
    expect(
      useChatStore.getState().sessions[0]?.messages.some((m) => (
        typeof m.content === 'string' && m.content.includes('extra-retry-should-not-run')
      )),
    ).toBe(false);
  });

  it('GPT FIX FIRST #6: Stop(slow cancel) → immediate Send must not ship dangling tool_calls in outbound API messages', async () => {
    const oldAssistant = createMessage('assistant', 'calling tool');
    oldAssistant.tool_calls = [{
      id: 'tool-dangling',
      name: 'execute_command',
      arguments: '{"command":"sleep 30"}',
    }];
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
      messages: [
        createMessage('user', 'run a long tool'),
        oldAssistant,
      ],
    });
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-dangling', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-dangling',
      'execute_command',
      'exec-dangling-slow',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
      streamingContent: 'calling tool',
    });

    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'cancel_tool_execution') {
        await cancelGate;
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    mockRunChatTurn.mockImplementation(() => streamOneAssistantReply());

    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    // Immediate same-session send while native cancel is still gated.
    jest.advanceTimersByTime(25);
    const sendNew = useChatStore.getState().sendMessage('fresh send mid-cancel');
    for (let i = 0; i < 100 && mockRunChatTurn.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(mockRunChatTurn.mock.calls.length).toBeGreaterThan(0);

    const outbound = mockRunChatTurn.mock.calls[0]?.[1] as Array<{
      role?: string;
      content?: string;
      tool_calls?: unknown[];
    }>;
    expect(Array.isArray(outbound)).toBe(true);
    expect(outbound.some((message) => Boolean(message.tool_calls?.length))).toBe(false);
    expect(outbound.some((message) => (
      typeof message.content === 'string' && message.content.includes('fresh send mid-cancel')
    ))).toBe(true);

    releaseCancel();
    await Promise.all([stopPromise, sendNew]);
  });

  it('GPT FIX FIRST #6: addMessageToSession must discard cancel notice after DB await if epoch moved', async () => {
    const oldAssistant = createMessage('assistant', '');
    oldAssistant.tool_calls = [{
      id: 'tool-notice-race',
      name: 'execute_command',
      arguments: '{}',
    }];
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
      messages: [
        createMessage('user', 'old for notice race'),
        oldAssistant,
      ],
    });
    seedSessionToolRuntime(
      'session-1',
      [{ id: 'tool-notice-race', name: 'execute_command' }],
      useChatStore.setState,
      useChatStore.getState,
    );
    setSessionToolExecutionId(
      'session-1',
      'tool-notice-race',
      'execute_command',
      'exec-notice-race',
      useChatStore.setState,
      useChatStore.getState,
    );
    useChatStore.setState({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 1,
    });

    let releaseNoticeSave!: () => void;
    const noticeSaveGate = new Promise<void>((resolve) => {
      releaseNoticeSave = resolve;
    });
    let noticeSaveHolds = 0;
    const deletedMessageIds: string[] = [];

    mockInvoke.mockImplementation(async (command: unknown, args?: any) => {
      if (command === 'cancel_tool_execution') {
        return { cancelled: true, status: 'cancelled' };
      }
      if (command === 'db_save_message') {
        const content = args?.message?.content;
        if (typeof content === 'string' && content.includes('Tool run cancelled by user')) {
          noticeSaveHolds += 1;
          await noticeSaveGate;
        }
        return undefined;
      }
      if (command === 'db_delete_message') {
        deletedMessageIds.push(String(args?.messageId ?? ''));
        return undefined;
      }
      return undefined;
    });

    const stopPromise = useChatStore.getState().stopGeneration();
    for (let i = 0; i < 120 && noticeSaveHolds === 0; i += 1) {
      await Promise.resolve();
    }
    expect(noticeSaveHolds).toBeGreaterThan(0);

    // Newer turn starts while cancel-notice DB persist is still awaiting.
    bumpChatSessionTurnEpoch('session-1');
    const newUser = createMessage('user', 'new turn during notice persist');
    const newAssistant = createMessage('assistant', 'new-turn-body');
    useChatStore.setState((state) => ({
      isStreaming: true,
      streamingSessionId: 'session-1',
      pendingToolCalls: 0,
      sessions: state.sessions.map((session) => (
        session.id === 'session-1'
          ? {
              ...session,
              messages: [...session.messages, newUser, newAssistant],
            }
          : session
      )),
    }));

    releaseNoticeSave();
    await stopPromise;

    const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1')!;
    expect(session.messages.some((m) => (
      m.role === 'assistant'
      && typeof m.content === 'string'
      && m.content.includes('Tool run cancelled by user')
    ))).toBe(false);
    expect(session.messages.some((m) => m.id === newUser.id)).toBe(true);
    expect(session.messages.some((m) => m.id === newAssistant.id)).toBe(true);
    expect(deletedMessageIds.length).toBeGreaterThan(0);
  });


  it('GPT FIX FIRST #7: sendMessage must re-check epoch after scrub await before build/run', async () => {
    const danglingAssistant = createMessage('assistant', 'calling tool');
    danglingAssistant.tool_calls = [{
      id: 'tool-send-scrub-race',
      name: 'execute_command',
      arguments: '{"command":"sleep 30"}',
    }];
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
      messages: [
        createMessage('user', 'prior dangling turn'),
        danglingAssistant,
      ],
    });

    let releaseScrubSave!: () => void;
    const scrubSaveGate = new Promise<void>((resolve) => {
      releaseScrubSave = resolve;
    });
    let scrubSaveHolds = 0;
    mockInvoke.mockImplementation(async (command: unknown, args?: unknown) => {
      if (command === 'db_save_message') {
        const message = (args as { message?: { id?: string; role?: string } } | undefined)?.message;
        // send-side scrub persists the cleaned dangling assistant (same id).
        if (message?.id === danglingAssistant.id) {
          scrubSaveHolds += 1;
          await scrubSaveGate;
        }
        return undefined;
      }
      return undefined;
    });

    mockRunChatTurn.mockImplementation(() => streamOneAssistantReply());

    const staleSend = useChatStore.getState().sendMessage('stale send mid-scrub');
    for (let i = 0; i < 120 && scrubSaveHolds === 0; i += 1) {
      await Promise.resolve();
    }
    expect(scrubSaveHolds).toBeGreaterThan(0);
    expect(mockRunChatTurn).not.toHaveBeenCalled();

    // Newer same-session turn owns the epoch while send-side scrub is still awaiting.
    // (Stop alone does not bump; a newer Send — or Stop→Send — does.)
    bumpChatSessionTurnEpoch('session-1');
    const newerPlaceholder = createMessage('assistant', 'newer-turn-alive');
    useChatStore.setState((state) => ({
      isStreaming: true,
      streamingSessionId: 'session-1',
      streamingContent: 'newer-partial',
      pendingToolCalls: 1,
      error: null,
      sessions: state.sessions.map((session) => (
        session.id === 'session-1'
          ? {
              ...session,
              messages: [
                ...session.messages,
                createMessage('user', 'newer send after epoch bump'),
                newerPlaceholder,
              ],
            }
          : session
      )),
    }));

    const runCallsBeforeRelease = mockRunChatTurn.mock.calls.length;
    releaseScrubSave();
    await staleSend;

    // Stale send must not build/run the model or wipe the newer turn.
    expect(mockRunChatTurn.mock.calls.length).toBe(runCallsBeforeRelease);
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingSessionId).toBe('session-1');
    expect(useChatStore.getState().streamingContent).toBe('newer-partial');
    expect(useChatStore.getState().pendingToolCalls).toBe(1);
    expect(useChatStore.getState().error).toBeNull();
    const session = useChatStore.getState().sessions.find((s) => s.id === 'session-1')!;
    expect(session.messages.some((m) => m.id === newerPlaceholder.id)).toBe(true);
    // Stale send already appended its user message before scrub; it must not
    // append an empty assistant placeholder after a stale scrub await.
    expect(session.messages.some((m) => (
      m.role === 'assistant'
      && m.id !== danglingAssistant.id
      && m.id !== newerPlaceholder.id
      && (m.content === '' || m.content.trim() === '')
    ))).toBe(false);
  });



  it('GPT FIX FIRST #8: post-scrub Stop→Send must not let stale path take over abort controller / runChatTurn', async () => {
    resetChatState({
      executionMode: 'agent',
      permissionMode: 'auto-edits',
      workDir: '/tmp/pipi/session-1',
      projectDir: '/tmp/pipi/session-1',
    });

    let releasePipiDir!: () => void;
    const pipiDirGate = new Promise<void>((resolve) => {
      releasePipiDir = resolve;
    });
    let pipiDirHolds = 0;
    mockInvoke.mockImplementation(async (command: unknown) => {
      if (command === 'get_app_default_dir') {
        pipiDirHolds += 1;
        // Hold only the stale send's first resolve after scrub; newer Send proceeds.
        if (pipiDirHolds === 1) {
          await pipiDirGate;
        }
        return '/tmp/pipi-output/session-1';
      }
      if (command === 'cancel_tool_execution') {
        return { cancelled: true, status: 'cancelled' };
      }
      return undefined;
    });

    let releaseNewStream!: () => void;
    const newStreamGate = new Promise<void>((resolve) => {
      releaseNewStream = resolve;
    });
    let runChatTurnCalls = 0;
    mockRunChatTurn.mockImplementation(() => {
      runChatTurnCalls += 1;
      return (async function* () {
        yield { type: 'text_delta' as const, content: 'newer-turn-alive ' };
        await newStreamGate;
        yield {
          type: 'turn_complete' as const,
          tokenUsage: { input_tokens: 2, output_tokens: 2, model: 'mock-model' },
        };
      })();
    });

    const staleSend = useChatStore.getState().sendMessage('stale send post-scrub window');
    for (let i = 0; i < 120 && pipiDirHolds === 0; i += 1) {
      await Promise.resolve();
    }
    expect(pipiDirHolds).toBe(1);
    expect(runChatTurnCalls).toBe(0);
    expect(useChatStore.getState().isStreaming).toBe(true);

    // Stop → new Send advances epoch while stale is still in the post-scrub await gap
    // (after scrub epoch check, before createChatTurnAbortController / runChatTurn).
    const stopPromise = useChatStore.getState().stopGeneration();
    await Promise.resolve();
    expect(useChatStore.getState().isStreaming).toBe(false);

    jest.advanceTimersByTime(25);
    const newSend = useChatStore.getState().sendMessage('fresh send after stop mid post-scrub');
    for (let i = 0; i < 120 && runChatTurnCalls === 0; i += 1) {
      await Promise.resolve();
    }
    expect(runChatTurnCalls).toBe(1);

    const newerHost = mockRunChatTurn.mock.calls[0]?.[6] as { signal?: AbortSignal } | undefined;
    expect(newerHost?.signal).toBeDefined();
    expect(newerHost!.signal!.aborted).toBe(false);

    const epochAfterNewSend = getChatSessionTurnEpoch('session-1');
    expect(epochAfterNewSend).toBeGreaterThan(0);

    releasePipiDir();
    await staleSend;

    // Stale must not create/take over the session abort controller or call runChatTurn.
    expect(runChatTurnCalls).toBe(1);
    expect(newerHost!.signal!.aborted).toBe(false);
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().streamingSessionId).toBe('session-1');
    expect(getChatSessionTurnEpoch('session-1')).toBe(epochAfterNewSend);
    expect(
      useChatStore.getState().sessions[0]?.messages.some((m) => (
        typeof m.content === 'string' && m.content.includes('fresh send after stop mid post-scrub')
      )),
    ).toBe(true);

    releaseNewStream();
    await Promise.all([stopPromise, newSend]);
  });


});
