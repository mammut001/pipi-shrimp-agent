import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockSafeInvoke = jest.fn(async () => undefined);

jest.mock('../../../utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
}));

import {
  buildToolCancelNoticeContent,
  listOrphanToolCalls,
  scrubDanglingToolCalls,
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

    const savedPayloads = mockSafeInvoke.mock.calls
      .filter((call) => call[0] === 'db_save_message')
      .map((call) => call[1] as { message: { id: string; tool_calls: string | null; content: string } });
    expect(savedPayloads.some((payload) => payload.message.id === 'a1' && payload.message.tool_calls === null)).toBe(true);
    expect(savedPayloads.some((payload) => (
      payload.message.content.includes('Tool run interrupted before completion')
    ))).toBe(true);
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
});
