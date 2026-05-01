import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import type { Session } from '../../../types/chat';

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRunChatTurn = jest.fn();
const mockAddNotification = jest.fn();
const mockClearTaskProgress = jest.fn();
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

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
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
      agentInstructions: 'agent instructions',
      setActiveSkill: mockSetActiveSkill,
      updateTaskStep: mockUpdateTaskStep,
      waitForPermission: jest.fn(async () => true),
      showQuestionnaire: jest.fn(async () => 'questionnaire response'),
      clearAllPermissions: jest.fn(),
      clearQuestionnaire: jest.fn(),
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

function resetChatState() {
  const session: Session = {
    id: 'session-1',
    title: 'Chat',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
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
    mockClearTaskProgress.mockReset();
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
    mockGetActiveConfig.mockReturnValue({
      id: 'api-config-1',
      apiKey: 'sk-test',
      model: 'mock-model',
      baseUrl: '',
      apiFormat: 'openai',
    });
    mockGetActiveTemplate.mockReturnValue({ sections: [] });
    mockBuildPrompt.mockReturnValue({ systemPrompt: 'system prompt' });
    mockClassifyIntent.mockReturnValue({ shouldDelegate: false });
    mockRunChatTurn.mockImplementation(() => streamOneAssistantReply());
    mockRunMicrocompactCheck.mockResolvedValue({ didCompact: false });
    mockTrySessionMemoryCompact.mockResolvedValue({ did_compact: false });
    mockGetContextTokenStats.mockResolvedValue({ current: 0 });
    mockCheckReactiveCompact.mockResolvedValue(undefined);
    mockTriggerContextAnalysis.mockResolvedValue(undefined);
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

    expect(mockClearTaskProgress).toHaveBeenCalledTimes(1);
    expect(mockBuildPrompt).toHaveBeenCalledWith([], expect.objectContaining({
      agentInstructions: 'agent instructions',
      originalQuery: '',
      browserResult: '',
    }));
    expect(mockRunChatTurn).toHaveBeenCalledWith(
      'session-1',
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'hello world' })]),
      'system prompt',
      undefined,
      true,
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
});
