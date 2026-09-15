import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockSafeInvoke = jest.fn(async () => undefined);

jest.mock('../../../utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
}));

import {
  buildToolCancelNoticeContent,
  listOrphanToolCalls,
  persistSessionsToLocalStorage,
  scrubDanglingToolCalls,
  SESSIONS_LOCAL_STORAGE_KEY,
  terminalizeInterruptedMessages,
  terminalizeInterruptedToolTurns,
  terminalizeInterruptedToolTurnsForSessions,
} from '../scrubDanglingToolCalls';
import { buildApiMessages } from '../../../utils/chatHelpers';
import type { ChatState, Message } from '../../../types/chat';

function makeState(messages: Message[], sessionId = 'session-scrub'): ChatState {
  return {
    sessions: [{
      id: sessionId,
      title: 'Scrub',
      messages,
      createdAt: 1,
      updatedAt: 1,
    }],
    projects: [],
    currentSessionId: sessionId,
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
  } as ChatState;
}

function bindState(initial: ChatState) {
  let state = initial;
  const set = (updater: ChatState | Partial<ChatState> | ((s: ChatState) => ChatState | Partial<ChatState>)) => {
    const patch = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...patch } as ChatState;
  };
  return {
    getState: () => state,
    set,
    get: () => state,
  };
}

describe('scrubDanglingToolCalls', () => {
  beforeEach(() => {
    mockSafeInvoke.mockClear();
  });

  it('scrubs orphan tool_calls from non-last assistant messages too', async () => {
    const { set, get } = bindState(makeState([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling tools',
        timestamp: 1,
        tool_calls: [{ id: 'orphan-1', name: 'execute_command', arguments: '{}' }],
      },
      {
        id: 'u1',
        role: 'user',
        content: 'ok continue',
        timestamp: 2,
      },
      {
        id: 'a2',
        role: 'assistant',
        content: 'more',
        timestamp: 3,
        tool_calls: [{ id: 'orphan-2', name: 'read_file', arguments: '{}' }],
      },
    ]));

    await scrubDanglingToolCalls('session-scrub', set, get);

    const session = get().sessions[0];
    expect(session.messages[0].tool_calls).toBeUndefined();
    expect(session.messages[0].content).toBe('calling tools');
    expect(session.messages[2].tool_calls).toBeUndefined();
    expect(session.messages[2].content).toBe('more');
    expect(mockSafeInvoke).toHaveBeenCalled();
  });

  it('keeps tool_calls that already have matching results', async () => {
    const { set, get } = bindState(makeState([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        timestamp: 1,
        tool_calls: [{ id: 'done-1', name: 'read_file', arguments: '{}' }],
      },
      {
        id: 'u1',
        role: 'user',
        content: '__TOOL_RESULT__:done-1:ok',
        tool_call_id: 'done-1',
        timestamp: 2,
      },
    ]));

    await scrubDanglingToolCalls('session-scrub', set, get);

    expect(get().sessions[0].messages[0].tool_calls).toEqual([
      { id: 'done-1', name: 'read_file', arguments: '{}' },
    ]);
    expect(mockSafeInvoke).not.toHaveBeenCalled();
  });
});

describe('interrupted-turn persistence (hydrate terminalize)', () => {
  beforeEach(() => {
    mockSafeInvoke.mockClear();
  });

  it('lists orphan tool_calls from persisted history without toolRuntimeState', () => {
    const orphans = listOrphanToolCalls([
      {
        id: 'a1',
        role: 'assistant',
        content: 'mid-tool crash',
        timestamp: 1,
        tool_calls: [
          { id: 'done-1', name: 'read_file', arguments: '{}' },
          { id: 'orphan-1', name: 'execute_command', arguments: '{}' },
        ],
      },
      {
        id: 'u1',
        role: 'user',
        content: '__TOOL_RESULT__:done-1:ok',
        tool_call_id: 'done-1',
        timestamp: 2,
      },
    ]);

    expect(orphans).toEqual([
      {
        messageId: 'a1',
        toolCall: { id: 'orphan-1', name: 'execute_command', arguments: '{}' },
      },
    ]);
  });

  it('terminalizeInterruptedMessages scrubs orphans and appends interrupted notice', () => {
    const result = terminalizeInterruptedMessages([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        timestamp: 1,
        tool_calls: [{ id: 'orphan-1', name: 'read_file', arguments: '{}' }],
      },
    ], { kind: 'interrupted', now: 42 });

    expect(result.changed).toBe(true);
    expect(result.messages[0].tool_calls).toBeUndefined();
    expect(result.notice?.content).toContain('session reloaded');
    expect(result.notice?.content).toContain('read_file');
    expect(result.notice?.content).toContain('do NOT re-request');
    expect(result.notice?.timestamp).toBe(42);
    expect(result.messages.at(-1)?.metadata?.interruptedTurnTerminal).toBe(true);

    const api = buildApiMessages(result.messages);
    expect(api.some((message) => Boolean(message.tool_calls?.length))).toBe(false);
    expect(api.some((message) => (
      typeof message.content === 'string'
      && message.content.includes('Tool run interrupted before completion')
      && message.content.includes('read_file')
    ))).toBe(true);
  });

  it('hydrate/reload with orphan tool_calls writes terminal marker and persists', async () => {
    const { set, get } = bindState(makeState([
      {
        id: 'u0',
        role: 'user',
        content: 'please run a tool',
        timestamp: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'sure',
        timestamp: 2,
        tool_calls: [{ id: 'orphan-crash', name: 'execute_command', arguments: '{"cmd":"sleep"}' }],
      },
    ]));

    const changed = await terminalizeInterruptedToolTurns('session-scrub', set, get, { kind: 'interrupted' });
    expect(changed).toBe(true);

    const session = get().sessions[0];
    expect(session.messages.some((message) => Boolean(message.tool_calls?.length))).toBe(false);
    expect(session.messages.some((message) => (
      message.content.includes('Tool run interrupted before completion')
      && message.content.includes('execute_command')
      && message.content.includes('do NOT re-request')
    ))).toBe(true);

    // Follow-up history that runChatTurn would see via buildApiMessages
    const api = buildApiMessages(session.messages);
    expect(api.some((message) => Boolean(message.tool_calls?.length))).toBe(false);
    expect(api.some((message) => (
      typeof message.content === 'string'
      && message.content.includes('Tool run interrupted before completion')
    ))).toBe(true);

    // P0: single write of scrubbed + notice (no scrub/notice failure window)
    const bulkCalls = mockSafeInvoke.mock.calls.filter((call) => call[0] === 'db_save_messages');
    expect(bulkCalls).toHaveLength(1);
    const bulkMessages = (bulkCalls[0][1] as {
      messages: Array<{ id: string; tool_calls: string | null; content: string }>;
    }).messages;
    expect(bulkMessages.some((message) => message.id === 'a1' && message.tool_calls === null)).toBe(true);
    expect(bulkMessages.some((message) => (
      message.content.includes('Tool run interrupted before completion')
    ))).toBe(true);
    // No per-message round-trips on the happy path
    expect(mockSafeInvoke.mock.calls.filter((call) => call[0] === 'db_save_message')).toHaveLength(0);
  });

  it('is idempotent after hydrate terminalize (second pass is a no-op)', async () => {
    const { set, get } = bindState(makeState([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        timestamp: 1,
        tool_calls: [{ id: 'orphan-1', name: 'read_file', arguments: '{}' }],
      },
    ]));

    expect(await terminalizeInterruptedToolTurns('session-scrub', set, get)).toBe(true);
    mockSafeInvoke.mockClear();
    expect(await terminalizeInterruptedToolTurns('session-scrub', set, get)).toBe(false);
    expect(mockSafeInvoke).not.toHaveBeenCalled();
    expect(get().sessions[0].messages.filter((message) => (
      message.content.includes('Tool run interrupted before completion')
    ))).toHaveLength(1);
  });

  it('terminalizeInterruptedToolTurnsForSessions covers all loaded sessions', async () => {
    let state = {
      sessions: [
        {
          id: 's1',
          title: 'One',
          createdAt: 1,
          updatedAt: 1,
          messages: [{
            id: 'a1',
            role: 'assistant' as const,
            content: 'x',
            timestamp: 1,
            tool_calls: [{ id: 'o1', name: 'read_file', arguments: '{}' }],
          }],
        },
        {
          id: 's2',
          title: 'Two',
          createdAt: 1,
          updatedAt: 1,
          messages: [{
            id: 'a2',
            role: 'assistant' as const,
            content: 'y',
            timestamp: 1,
            tool_calls: [{ id: 'o2', name: 'list_files', arguments: '{}' }],
          }],
        },
      ],
      projects: [],
      currentSessionId: 's1',
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
    } as ChatState;

    const set = (updater: ChatState | Partial<ChatState> | ((s: ChatState) => ChatState | Partial<ChatState>)) => {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      state = { ...state, ...patch } as ChatState;
    };

    const count = await terminalizeInterruptedToolTurnsForSessions(set, () => state, { kind: 'interrupted' });
    expect(count).toBe(2);
    expect(state.sessions.every((session) => (
      !session.messages.some((message) => Boolean(message.tool_calls?.length))
      && session.messages.some((message) => message.content.includes('session reloaded'))
    ))).toBe(true);
  });

  it('buildToolCancelNoticeContent matches stopGeneration user-cancel wording', () => {
    expect(buildToolCancelNoticeContent(['read_file'], 'user_cancel')).toContain('cancelled by user');
    expect(buildToolCancelNoticeContent(['read_file'], 'user_cancel')).toContain('do NOT re-request');
    expect(buildToolCancelNoticeContent(['execute_command'], 'interrupted')).toContain('session reloaded');
  });

  it('localStorage persist mode writes terminalized sessions back so reload is clean', async () => {
    const store: Record<string, string> = {};
    const localStorageMock = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((key) => delete store[key]); },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    // Seed orphan history as the localStorage fallback would load it
    const orphanSessions = [{
      id: 'ls-session',
      title: 'LS',
      createdAt: 1,
      updatedAt: 1,
      messages: [{
        id: 'a1',
        role: 'assistant' as const,
        content: 'mid crash',
        timestamp: 1,
        tool_calls: [{ id: 'orphan-ls', name: 'execute_command', arguments: '{}' }],
      }],
    }];
    store[SESSIONS_LOCAL_STORAGE_KEY] = JSON.stringify(orphanSessions);

    let state = {
      sessions: orphanSessions,
      projects: [],
      currentSessionId: 'ls-session',
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
    } as ChatState;

    const set = (updater: ChatState | Partial<ChatState> | ((s: ChatState) => ChatState | Partial<ChatState>)) => {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      state = { ...state, ...patch } as ChatState;
    };

    const count = await terminalizeInterruptedToolTurnsForSessions(set, () => state, {
      kind: 'interrupted',
      persist: 'localStorage',
    });
    expect(count).toBe(1);
    expect(mockSafeInvoke).not.toHaveBeenCalled();

    const written = store[SESSIONS_LOCAL_STORAGE_KEY];
    expect(written).toBeTruthy();
    const parsed = JSON.parse(written!) as typeof orphanSessions;
    expect(parsed[0].messages.some((message) => Boolean(message.tool_calls?.length))).toBe(false);
    expect(parsed[0].messages.some((message) => (
      message.content.includes('Tool run interrupted before completion')
      && message.content.includes('execute_command')
    ))).toBe(true);

    // Next "reload" from localStorage must not re-see orphans
    const reloaded = JSON.parse(store[SESSIONS_LOCAL_STORAGE_KEY]!) as typeof orphanSessions;
    expect(listOrphanToolCalls(reloaded[0].messages)).toEqual([]);
    expect(persistSessionsToLocalStorage(() => state)).toBe(true);
  });

  it('hydrate terminalize uses a single db_save_messages for scrub + notice', async () => {
    const { set, get } = bindState(makeState([
      {
        id: 'a1',
        role: 'assistant',
        content: 'calling',
        timestamp: 1,
        tool_calls: [
          { id: 'orphan-a', name: 'read_file', arguments: '{}' },
          { id: 'orphan-b', name: 'list_files', arguments: '{}' },
        ],
      },
    ]));

    await terminalizeInterruptedToolTurns('session-scrub', set, get, { kind: 'interrupted', persist: 'db' });

    const bulk = mockSafeInvoke.mock.calls.filter((call) => call[0] === 'db_save_messages');
    expect(bulk).toHaveLength(1);
    const messages = (bulk[0][1] as { messages: Array<{ id: string; content: string; tool_calls: string | null }> }).messages;
    // One scrubbed assistant + one notice in the same batch
    expect(messages.filter((message) => message.id === 'a1')).toHaveLength(1);
    expect(messages.filter((message) => message.content.includes('session reloaded'))).toHaveLength(1);
    expect(messages).toHaveLength(2);
  });
});
