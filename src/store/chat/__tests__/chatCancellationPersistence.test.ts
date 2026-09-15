/**
 * GPT P0 knife 2 — DB reload cancellation persistence matrix (deterministic).
 * Covers cancel→reload→follow-up, multi-tool mix, late completion discard,
 * and cancel interleaved with DB save. No sleeps.
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
} from '../scrubDanglingToolCalls';
import { buildApiMessages, messageToDb } from '../../../utils/chatHelpers';
import {
  InMemoryMessageDb,
  apiHasSuccessfulToolOutcome,
  assistantWithTools,
  bindState,
  hasOrphanToolCalls,
  hasTerminalMarker,
  makeChatState,
  makeSession,
  userMsg,
  wireSafeInvokeToDb,
} from './cancellationPersistenceTestUtils';

describe('chatCancellationPersistence matrix', () => {
  const db = new InMemoryMessageDb();

  beforeEach(() => {
    db.clear();
    mockSafeInvoke.mockReset();
    wireSafeInvokeToDb(mockSafeInvoke, db);
  });

  it('1) cancel → reload → follow-up: terminal marker, no orphan tool_calls', async () => {
    const sessionId = 'sess-cancel-reload';
    const history = [
      userMsg('u0', 'run a command', 1),
      assistantWithTools('a1', 'sure', [
        { id: 'tc-orphan', name: 'execute_command', arguments: '{"cmd":"sleep"}' },
      ], 2),
    ];
    db.seed(sessionId, history);
    const { set, get, replace } = bindState(makeChatState([makeSession(sessionId, history)]));

    // Live Stop path equivalent: user_cancel terminalize (scrub + notice)
    const cancelled = terminalizeInterruptedMessages(get().sessions[0].messages, {
      kind: 'user_cancel',
      now: 10,
    });
    expect(cancelled.changed).toBe(true);
    set((state) => ({
      sessions: state.sessions.map((s) => (
        s.id === sessionId ? { ...s, messages: cancelled.messages, updatedAt: 10 } : s
      )),
    }));
    // Persist the same way stopGeneration would (scrub rows + notice)
    const toPersist = [
      ...cancelled.scrubbedById.values(),
      cancelled.notice!,
    ].map((m) => messageToDb(m, sessionId));
    await mockSafeInvoke('db_save_messages', { messages: toPersist });

    // Reload from DB (fresh in-memory store)
    const reloaded = db.loadMessages(sessionId);
    replace(makeChatState([makeSession(sessionId, reloaded)]));
    // Hydrate path (idempotent if already terminal)
    await terminalizeInterruptedToolTurns(sessionId, set, get, { kind: 'interrupted', persist: 'db' });

    const afterReload = get().sessions[0].messages;
    expect(listOrphanToolCalls(afterReload)).toEqual([]);
    expect(hasOrphanToolCalls(afterReload)).toBe(false);
    expect(hasTerminalMarker(afterReload, 'user_cancel')).toBe(true);
    // Note: message.metadata is in-memory only today (messageToDb does not persist it).
    // Durable signal after reload is the assistant notice content.

    // Follow-up history runChatTurn would see
    const api = buildApiMessages(afterReload);
    expect(api.some((m) => Boolean(m.tool_calls?.length))).toBe(false);
    expect(api.some((m) => (
      typeof m.content === 'string'
      && m.content.includes('Tool run cancelled by user')
      && m.content.includes('execute_command')
    ))).toBe(true);

    // Persisted rows match
    const persisted = db.loadMessages(sessionId);
    expect(listOrphanToolCalls(persisted)).toEqual([]);
    expect(hasTerminalMarker(persisted, 'user_cancel')).toBe(true);
  });

  it('4) multiple tools: one complete / one cancelled → history correct after reload', async () => {
    const sessionId = 'sess-multi-tool';
    const history = [
      userMsg('u0', 'do two things', 1),
      assistantWithTools('a1', 'working', [
        { id: 'tc-done', name: 'read_file', arguments: '{}' },
        { id: 'tc-cancel', name: 'execute_command', arguments: '{}' },
      ], 2),
      userMsg('u1', '__TOOL_RESULT__:tc-done:file contents', 3, 'tc-done'),
    ];
    db.seed(sessionId, history);
    const { set, get, replace } = bindState(makeChatState([makeSession(sessionId, history)]));

    const result = terminalizeInterruptedMessages(get().sessions[0].messages, {
      kind: 'user_cancel',
      now: 20,
    });
    expect(result.orphans.map((o) => o.toolCall.id)).toEqual(['tc-cancel']);
    set((state) => ({
      sessions: state.sessions.map((s) => (
        s.id === sessionId ? { ...s, messages: result.messages } : s
      )),
    }));
    await mockSafeInvoke('db_save_messages', {
      messages: [...result.scrubbedById.values(), result.notice!].map((m) => messageToDb(m, sessionId)),
    });

    replace(makeChatState([makeSession(sessionId, db.loadMessages(sessionId))]));
    await terminalizeInterruptedToolTurns(sessionId, set, get, { kind: 'interrupted' });

    const messages = get().sessions[0].messages;
    const assistant = messages.find((m) => m.id === 'a1');
    expect(assistant?.tool_calls).toEqual([
      { id: 'tc-done', name: 'read_file', arguments: '{}' },
    ]);
    expect(listOrphanToolCalls(messages)).toEqual([]);
    expect(hasTerminalMarker(messages, 'user_cancel')).toBe(true);
    expect(messages.some((m) => m.content.includes('execute_command'))).toBe(true);

    const api = buildApiMessages(messages);
    // Completed tool_call still present for the model; cancelled one scrubbed
    const withTools = api.filter((m) => m.tool_calls && m.tool_calls.length > 0);
    expect(withTools).toHaveLength(1);
    expect(withTools[0].tool_calls?.map((tc) => (
      'id' in tc ? tc.id : (tc as { tool_call_id?: string }).tool_call_id
    ))).toEqual(expect.arrayContaining(['tc-done']));
  });

  it('5a) late orphan restore without result → hydrate re-terminalizes', async () => {
    const sessionId = 'sess-late-orphan';
    const orphanAssistant = assistantWithTools('a1', 'calling', [
      { id: 'tc-late', name: 'read_file', arguments: '{}' },
    ], 2);
    const history = [userMsg('u0', 'read it', 1), orphanAssistant];
    db.seed(sessionId, history);
    const { set, get, replace } = bindState(makeChatState([makeSession(sessionId, history)]));

    const cancelled = terminalizeInterruptedMessages(history, { kind: 'user_cancel', now: 30 });
    set((state) => ({
      sessions: state.sessions.map((s) => (
        s.id === sessionId ? { ...s, messages: cancelled.messages } : s
      )),
    }));
    await mockSafeInvoke('db_save_messages', {
      messages: [...cancelled.scrubbedById.values(), cancelled.notice!].map((m) => messageToDb(m, sessionId)),
    });

    // Late writer restores orphaned tool_calls WITHOUT a result.
    db.saveMessage(messageToDb(orphanAssistant, sessionId));

    replace(makeChatState([makeSession(sessionId, db.loadMessages(sessionId))]));
    expect(listOrphanToolCalls(get().sessions[0].messages).length).toBeGreaterThan(0);

    await terminalizeInterruptedToolTurns(sessionId, set, get, { kind: 'interrupted', persist: 'db' });

    const finalMessages = get().sessions[0].messages;
    expect(listOrphanToolCalls(finalMessages)).toEqual([]);
    expect(
      hasTerminalMarker(finalMessages, 'user_cancel')
      || hasTerminalMarker(finalMessages, 'interrupted'),
    ).toBe(true);
    expect(listOrphanToolCalls(db.loadMessages(sessionId))).toEqual([]);
    expect(buildApiMessages(finalMessages).some((m) => Boolean(m.tool_calls?.length))).toBe(false);
  });

  it('5b) late tool result after cancel must NOT appear as successful tool outcome', async () => {
    const sessionId = 'sess-late-complete';
    const orphanAssistant = assistantWithTools('a1', 'calling', [
      { id: 'tc-late', name: 'read_file', arguments: '{}' },
    ], 2);
    const history = [userMsg('u0', 'read it', 1), orphanAssistant];
    db.seed(sessionId, history);
    const { set, get, replace } = bindState(makeChatState([makeSession(sessionId, history)]));

    const cancelled = terminalizeInterruptedMessages(history, { kind: 'user_cancel', now: 30 });
    expect(cancelled.notice?.content).toContain('cancelled_tool_call_ids: tc-late');
    set((state) => ({
      sessions: state.sessions.map((s) => (
        s.id === sessionId ? { ...s, messages: cancelled.messages } : s
      )),
    }));
    await mockSafeInvoke('db_save_messages', {
      messages: [...cancelled.scrubbedById.values(), cancelled.notice!].map((m) => messageToDb(m, sessionId)),
    });

    // Pollution: stale writer re-upserts assistant tool_calls AND a successful late result.
    // Previously Case 5 overwrote with orphan-only so hydrate "passed" without clearing the result.
    db.saveMessage(messageToDb(orphanAssistant, sessionId));
    db.saveMessage(messageToDb(
      userMsg('u-late', '__TOOL_RESULT__:tc-late:late ok', 99, 'tc-late'),
      sessionId,
    ));

    // Without scrubLateCompletionsAfterCancel, orphans would be "resolved" by the late result
    // and buildApiMessages would present a successful tool outcome — false positive.
    const polluted = db.loadMessages(sessionId);
    expect(listOrphanToolCalls(polluted)).toEqual([]); // late result resolves the call
    expect(polluted.some((m) => m.content.includes('late ok'))).toBe(true);

    replace(makeChatState([makeSession(sessionId, polluted)]));
    await terminalizeInterruptedToolTurns(sessionId, set, get, { kind: 'interrupted', persist: 'db' });

    const finalMessages = get().sessions[0].messages;
    expect(listOrphanToolCalls(finalMessages)).toEqual([]);
    expect(hasTerminalMarker(finalMessages, 'user_cancel')).toBe(true);
    // Late success body must not survive in durable history or next-turn API messages.
    expect(finalMessages.some((m) => m.content.includes('late ok'))).toBe(false);
    expect(finalMessages.some((m) => m.id === 'u-late')).toBe(false);

    const api = buildApiMessages(finalMessages);
    expect(apiHasSuccessfulToolOutcome(api, 'tc-late', 'late ok')).toBe(false);
    expect(api.some((m) => typeof m.content === 'string' && m.content.includes('late ok'))).toBe(false);
    expect(api.some((m) => Boolean(m.tool_calls?.length))).toBe(false);

    const persisted = db.loadMessages(sessionId);
    expect(listOrphanToolCalls(persisted)).toEqual([]);
    expect(persisted.some((m) => m.content.includes('late ok'))).toBe(false);
    expect(hasTerminalMarker(persisted, 'user_cancel')).toBe(true);
  });

  it('6) cancel interleaved with DB save stays consistent (atomic batch wins)', async () => {
    const sessionId = 'sess-interleaved';
    const history = [
      assistantWithTools('a1', 'mid', [
        { id: 'tc-a', name: 'read_file', arguments: '{}' },
        { id: 'tc-b', name: 'list_files', arguments: '{}' },
      ], 1),
    ];
    db.seed(sessionId, history);
    const { set, get } = bindState(makeChatState([makeSession(sessionId, [...history])]));

    // First: live scrub path writes per-message (stopGeneration scrubDanglingToolCalls)
    await scrubDanglingToolCalls(sessionId, set, get);
    expect(db.calls.some((c) => c.op === 'db_save_message')).toBe(true);
    // After scrub alone: no orphans in memory, but no terminal notice yet
    expect(listOrphanToolCalls(get().sessions[0].messages)).toEqual([]);
    expect(hasTerminalMarker(get().sessions[0].messages, 'user_cancel')).toBe(false);

    // Interleave: restore orphans in DB as if a concurrent writer raced, then hydrate terminalize
    db.saveMessage(messageToDb(history[0], sessionId));
    // Also re-inject into memory to simulate dirty read before notice
    set((state) => ({
      sessions: state.sessions.map((s) => (
        s.id === sessionId ? { ...s, messages: [history[0]] } : s
      )),
    }));

    await terminalizeInterruptedToolTurns(sessionId, set, get, { kind: 'interrupted', persist: 'db' });

    const bulk = db.calls.filter((c) => c.op === 'db_save_messages');
    expect(bulk.length).toBeGreaterThanOrEqual(1);
    const lastBulk = bulk[bulk.length - 1];
    if (lastBulk.op === 'db_save_messages') {
      expect(lastBulk.messages.some((m) => m.id === 'a1' && m.tool_calls === null)).toBe(true);
      expect(lastBulk.messages.some((m) => m.content.includes('session reloaded'))).toBe(true);
    }

    const persisted = db.loadMessages(sessionId);
    expect(listOrphanToolCalls(persisted)).toEqual([]);
    expect(hasTerminalMarker(persisted, 'interrupted')).toBe(true);
    expect(buildApiMessages(persisted).some((m) => Boolean(m.tool_calls?.length))).toBe(false);
  });
});
