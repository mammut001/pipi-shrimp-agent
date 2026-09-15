import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockSafeInvoke = jest.fn(async () => undefined);

jest.mock('../../../utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
}));

import { scrubDanglingToolCalls } from '../scrubDanglingToolCalls';
import type { ChatState, Message } from '../../../types/chat';

function makeState(messages: Message[]): ChatState {
  return {
    sessions: [{
      id: 'session-scrub',
      title: 'Scrub',
      messages,
      createdAt: 1,
      updatedAt: 1,
    }],
    projects: [],
    currentSessionId: 'session-scrub',
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

describe('scrubDanglingToolCalls', () => {
  beforeEach(() => {
    mockSafeInvoke.mockClear();
  });

  it('scrubs orphan tool_calls from non-last assistant messages too', async () => {
    let state = makeState([
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
    ]);

    const set = (updater: ChatState | Partial<ChatState> | ((s: ChatState) => ChatState | Partial<ChatState>)) => {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      state = { ...state, ...patch } as ChatState;
    };

    await scrubDanglingToolCalls('session-scrub', set, () => state);

    const session = state.sessions[0];
    expect(session.messages[0].tool_calls).toBeUndefined();
    expect(session.messages[0].content).toBe('calling tools');
    expect(session.messages[2].tool_calls).toBeUndefined();
    expect(session.messages[2].content).toBe('more');
    expect(mockSafeInvoke).toHaveBeenCalled();
  });

  it('keeps tool_calls that already have matching results', async () => {
    let state = makeState([
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
    ]);

    const set = (updater: ChatState | Partial<ChatState> | ((s: ChatState) => ChatState | Partial<ChatState>)) => {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      state = { ...state, ...patch } as ChatState;
    };

    await scrubDanglingToolCalls('session-scrub', set, () => state);

    expect(state.sessions[0].messages[0].tool_calls).toEqual([
      { id: 'done-1', name: 'read_file', arguments: '{}' },
    ]);
    expect(mockSafeInvoke).not.toHaveBeenCalled();
  });
});
