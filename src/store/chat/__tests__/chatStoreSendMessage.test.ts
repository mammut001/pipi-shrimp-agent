import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import type { Session } from '../../../types/chat';

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRunChatTurn = jest.fn();
const mockAddNotification = jest.fn();
const mockShowExecutionModeUpgradePrompt = jest.fn(async () => 'agent' as const);
const mockClearTaskProgress = jest.fn();
const mockSetTaskProgress = jest.fn();
const mockSetActiveSkill = jest.fn();
const mockUpdateTaskStep = jest.fn();
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
      clearAllPermissions: jest.fn(),
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
    tools: [{ id: 'tool-cancel', name: 'execute_command', arguments: '{"command":"pwd"}' }],
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
    mockInvoke.mockReset();
    mockRunChatTurn.mockReset();
    mockAddNotification.mockReset();
    mockShowExecutionModeUpgradePrompt.mockReset();
    mockShowExecutionModeUpgradePrompt.mockResolvedValue('agent');
    mockClearTaskProgress.mockReset();
    mockSetTaskProgress.mockReset();
    mockSetActiveSkill.mockReset();
    mockUpdateTaskStep.mockReset();
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
    mockRunChatTurn.mockImplementation(() => streamWithToolBatchThenContinuation());
    mockExecuteBatch.mockImplementation(async () => {
      await useChatStore.getState().stopGeneration();
      return {
        results: [{ id: 'tool-cancel', content: '{"stdout":"/tmp","stderr":"","exit_code":0}', is_error: false }],
        totalExecutionTime: 1,
        errors: [],
      };
    });

    await useChatStore.getState().sendMessage('cancel this run');

    const session = useChatStore.getState().sessions.find((candidate) => candidate.id === 'session-1');
    expect(session?.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'cancel this run'],
      ['assistant', 'should not continue after cancel'],
    ]);
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect(useChatStore.getState().pendingToolCalls).toBe(0);
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
});
