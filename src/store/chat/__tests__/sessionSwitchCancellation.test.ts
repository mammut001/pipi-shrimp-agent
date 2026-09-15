/**
 * GPT P0 knife 2 — session-switch + delete cancellation matrix (deterministic).
 * Covers cancel A → switch B, reopen A hydrate terminalize, delete while cancelling.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockSafeInvoke = jest.fn(async (..._args: unknown[]) => undefined);

jest.mock('../../../utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
}));

import {
  listOrphanToolCalls,
  scrubDanglingToolCalls,
  terminalizeInterruptedMessages,
  terminalizeInterruptedToolTurns,
  terminalizeInterruptedToolTurnsForSessions,
} from '../scrubDanglingToolCalls';
import { buildApiMessages, messageToDb } from '../../../utils/chatHelpers';
import {
  InMemoryMessageDb,
  assistantWithTools,
  bindState,
  hasOrphanToolCalls,
  hasTerminalMarker,
  makeChatState,
  makeSession,
  userMsg,
  wireSafeInvokeToDb,
} from './cancellationPersistenceTestUtils';

describe('sessionSwitchCancellation matrix', () => {
  const db = new InMemoryMessageDb();

  beforeEach(() => {
    db.clear();
    mockSafeInvoke.mockReset();
    wireSafeInvokeToDb(mockSafeInvoke, db);
  });

  it('2) cancel A → switch B → B works (no ghost from A)', async () => {
    const sessionA = 'session-A';
    const sessionB = 'session-B';
    const historyA = [
      userMsg('a-u0', 'do work in A', 1),
      assistantWithTools('a-a1', 'calling', [
        { id: 'tc-a', name: 'execute_command', arguments: '{}' },
      ], 2),
    ];
    const historyB = [
      userMsg('b-u0', 'hello B', 1),
      { id: 'b-a1', role: 'assistant' as const, content: 'hi from B', timestamp: 2 },
    ];
    db.seed(sessionA, historyA);
    db.seed(sessionB, historyB);

    const { set, get } = bindState(makeChatState([
      makeSession(sessionA, historyA),
      makeSession(sessionB, historyB),
    ], sessionA));

    // Cancel A (Stop): scrub + user_cancel notice
    const cancelled = terminalizeInterruptedMessages(historyA, { kind: 'user_cancel', now: 5 });
    set((state) => ({
      sessions: state.sessions.map((s) => (
        s.id === sessionA ? { ...s, messages: cancelled.messages, updatedAt: 5 } : s
      )),
      currentSessionId: sessionA,
    }));
    await mockSafeInvoke('db_save_messages', {
      messages: [...cancelled.scrubbedById.values(), cancelled.notice!].map((m) => messageToDb(m, sessionA)),
    });

    // Switch to B (selectSession equivalent: scrub prior if needed — already clean)
    await scrubDanglingToolCalls(sessionA, set, get);
    set({
      currentSessionId: sessionB,
      isStreaming: false,
      pendingToolCalls: 0,
      pendingToolResults: [],
      streamingSessionId: null,
    });

    const b = get().sessions.find((s) => s.id === sessionB)!;
    expect(b.messages).toEqual(historyB);
    expect(listOrphanToolCalls(b.messages)).toEqual([]);
    expect(hasOrphanToolCalls(b.messages)).toBe(false);
    // No ghost cancel notice leaked into B
    expect(hasTerminalMarker(b.messages, 'user_cancel')).toBe(false);
    expect(hasTerminalMarker(b.messages, 'interrupted')).toBe(false);

    const apiB = buildApiMessages(b.messages);
    expect(apiB.some((m) => (
      typeof m.content === 'string' && m.content.includes('cancelled by user')
    ))).toBe(false);

    // A remains terminalized in its own history / DB
    const a = get().sessions.find((s) => s.id === sessionA)!;
    expect(hasTerminalMarker(a.messages, 'user_cancel')).toBe(true);
    expect(listOrphanToolCalls(db.loadMessages(sessionA))).toEqual([]);
    expect(db.loadMessages(sessionB).map((m) => m.content)).toEqual(['hello B', 'hi from B']);
  });

  it('3) A running tool (orphans) → switch B → reopen A → A terminalized on hydrate', async () => {
    const sessionA = 'session-A-orphan';
    const sessionB = 'session-B-clean';
    const orphanHistoryA = [
      userMsg('a-u0', 'start tool', 1),
      assistantWithTools('a-a1', 'running', [
        { id: 'tc-orphan-a', name: 'read_file', arguments: '{}' },
      ], 2),
    ];
    const historyB = [
      userMsg('b-u0', 'B only', 1),
    ];
    // Persist orphans as if crash / incomplete cancel before switch scrub finished
    db.seed(sessionA, orphanHistoryA);
    db.seed(sessionB, historyB);

    const { set, get, replace } = bindState(makeChatState([
      makeSession(sessionA, orphanHistoryA),
      makeSession(sessionB, historyB),
    ], sessionA));

    // Switch away: selectSession scrubs A in memory (fire-and-forget) but we model
    // the harsh case where DB still has orphans (scrub write lost / not yet flushed).
    await scrubDanglingToolCalls(sessionA, set, get);
    // Simulate scrub DB write failing / lost: re-seed orphans in DB
    db.seed(sessionA, orphanHistoryA);
    set({
      currentSessionId: sessionB,
      isStreaming: false,
      pendingToolCalls: 0,
      pendingToolResults: [],
      streamingSessionId: null,
    });

    expect(listOrphanToolCalls(get().sessions.find((s) => s.id === sessionB)!.messages)).toEqual([]);

    // Reopen A via reload hydrate (init path across sessions)
    replace(makeChatState([
      makeSession(sessionA, db.loadMessages(sessionA)),
      makeSession(sessionB, db.loadMessages(sessionB)),
    ], sessionA));
    expect(listOrphanToolCalls(get().sessions.find((s) => s.id === sessionA)!.messages).length).toBeGreaterThan(0);

    const count = await terminalizeInterruptedToolTurnsForSessions(set, get, {
      kind: 'interrupted',
      persist: 'db',
    });
    expect(count).toBe(1);

    const a = get().sessions.find((s) => s.id === sessionA)!;
    expect(listOrphanToolCalls(a.messages)).toEqual([]);
    expect(hasTerminalMarker(a.messages, 'interrupted')).toBe(true);
    expect(a.messages.some((m) => m.metadata?.interruptedTurnTerminal === true)).toBe(true);

    const api = buildApiMessages(a.messages);
    expect(api.some((m) => Boolean(m.tool_calls?.length))).toBe(false);
    expect(api.some((m) => (
      typeof m.content === 'string'
      && m.content.includes('session reloaded')
      && m.content.includes('read_file')
    ))).toBe(true);

    // B untouched
    expect(get().sessions.find((s) => s.id === sessionB)!.messages).toHaveLength(1);
    expect(listOrphanToolCalls(db.loadMessages(sessionA))).toEqual([]);
  });

  it('7) delete session while cancelling discards late persists for deleted session', async () => {
    const sessionA = 'session-delete-A';
    const sessionB = 'session-keep-B';
    const historyA = [
      assistantWithTools('a1', 'dying', [
        { id: 'tc-del', name: 'execute_command', arguments: '{}' },
      ], 1),
    ];
    const historyB = [userMsg('b1', 'keep me', 1)];
    db.seed(sessionA, historyA);
    db.seed(sessionB, historyB);

    const { set, get } = bindState(makeChatState([
      makeSession(sessionA, historyA),
      makeSession(sessionB, historyB),
    ], sessionA));

    // Begin cancel terminalize in memory
    const cancelling = terminalizeInterruptedMessages(historyA, { kind: 'user_cancel', now: 7 });
    set((state) => ({
      sessions: state.sessions.map((s) => (
        s.id === sessionA ? { ...s, messages: cancelling.messages } : s
      )),
    }));

    // Delete A while cancel persist is still in flight (store API: db_delete_session)
    await mockSafeInvoke('db_delete_session', { sessionId: sessionA });
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionA),
      currentSessionId: sessionB,
    }));
    expect(db.isDeleted(sessionA)).toBe(true);
    expect(db.hasSession(sessionA)).toBe(false);

    // Late cancel persist attempts (scrub + notice) must not resurrect A
    await mockSafeInvoke('db_save_messages', {
      messages: [...cancelling.scrubbedById.values(), cancelling.notice!].map((m) => messageToDb(m, sessionA)),
    });
    await mockSafeInvoke('db_save_message', {
      message: messageToDb(cancelling.notice!, sessionA),
    });

    expect(db.hasSession(sessionA)).toBe(false);
    expect(db.getMessages(sessionA)).toEqual([]);
    expect(get().sessions.map((s) => s.id)).toEqual([sessionB]);
    expect(db.loadMessages(sessionB)).toHaveLength(1);
    expect(db.loadMessages(sessionB)[0].content).toBe('keep me');
  });
});
