/**
 * Deterministic in-memory persistence helpers for cancellation matrix tests.
 * No sleeps; records every db_save_* / db_delete_session for assertions.
 */
import type { ChatState, Message, Session } from '../../../types/chat';
import type { DbMessage, DbSession } from '../../../utils/chatHelpers';
import { dbToSession, messageToDb } from '../../../utils/chatHelpers';

export type PersistCall =
  | { op: 'db_save_message'; message: DbMessage }
  | { op: 'db_save_messages'; messages: DbMessage[] }
  | { op: 'db_delete_session'; sessionId: string };

export class InMemoryMessageDb {
  /** sessionId → messageId → row */
  private rows = new Map<string, Map<string, DbMessage>>();
  /** Sessions deleted while a cancel/persist may still be in flight. */
  private deleted = new Set<string>();
  readonly calls: PersistCall[] = [];

  clear(): void {
    this.rows.clear();
    this.deleted.clear();
    this.calls.length = 0;
  }

  seed(sessionId: string, messages: Message[]): void {
    const map = new Map<string, DbMessage>();
    for (const message of messages) {
      map.set(message.id, messageToDb(message, sessionId));
    }
    this.rows.set(sessionId, map);
    this.deleted.delete(sessionId);
  }

  saveMessage(message: DbMessage): void {
    this.calls.push({ op: 'db_save_message', message });
    if (this.deleted.has(message.session_id)) {
      return; // late write after delete — discarded
    }
    let map = this.rows.get(message.session_id);
    if (!map) {
      map = new Map();
      this.rows.set(message.session_id, map);
    }
    map.set(message.id, message);
  }

  /** Simulates transactional bulk upsert (db_save_messages). */
  saveMessages(messages: DbMessage[]): void {
    this.calls.push({ op: 'db_save_messages', messages: [...messages] });
    for (const message of messages) {
      if (this.deleted.has(message.session_id)) {
        continue;
      }
      let map = this.rows.get(message.session_id);
      if (!map) {
        map = new Map();
        this.rows.set(message.session_id, map);
      }
      map.set(message.id, message);
    }
  }

  deleteSession(sessionId: string): void {
    this.calls.push({ op: 'db_delete_session', sessionId });
    this.deleted.add(sessionId);
    this.rows.delete(sessionId);
  }

  getMessages(sessionId: string): DbMessage[] {
    const map = this.rows.get(sessionId);
    if (!map) return [];
    return [...map.values()].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  }

  hasSession(sessionId: string): boolean {
    return this.rows.has(sessionId) && !this.deleted.has(sessionId);
  }

  isDeleted(sessionId: string): boolean {
    return this.deleted.has(sessionId);
  }

  /** Reload session messages from DB into Message[] (hydrate path). */
  loadMessages(sessionId: string): Message[] {
    const dbSession: DbSession = {
      id: sessionId,
      title: sessionId,
      created_at: 1,
      updated_at: 1,
      cwd: null,
      project_id: null,
      model: null,
    };
    return dbToSession(dbSession, this.getMessages(sessionId)).messages;
  }
}

export function makeSession(
  id: string,
  messages: Message[],
  extras: Partial<Session> = {},
): Session {
  return {
    id,
    title: extras.title ?? id,
    messages,
    createdAt: extras.createdAt ?? 1,
    updatedAt: extras.updatedAt ?? 1,
    ...extras,
  };
}

export function makeChatState(
  sessions: Session[],
  currentSessionId: string | null = sessions[0]?.id ?? null,
): ChatState {
  return {
    sessions,
    projects: [],
    currentSessionId,
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

export function bindState(initial: ChatState) {
  let state = initial;
  const set = (
    updater: ChatState | Partial<ChatState> | ((s: ChatState) => ChatState | Partial<ChatState>),
  ) => {
    const patch = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...patch } as ChatState;
  };
  return {
    getState: () => state,
    set,
    get: () => state,
    replace: (next: ChatState) => { state = next; },
  };
}

export function assistantWithTools(
  id: string,
  content: string,
  tool_calls: Array<{ id: string; name: string; arguments: string }>,
  timestamp = 1,
): Message {
  return { id, role: 'assistant', content, timestamp, tool_calls };
}

export function userMsg(id: string, content: string, timestamp = 1, tool_call_id?: string): Message {
  return {
    id,
    role: 'user',
    content,
    timestamp,
    ...(tool_call_id ? { tool_call_id } : {}),
  };
}

export function hasOrphanToolCalls(messages: Message[]): boolean {
  return messages.some((message) => Boolean(message.tool_calls?.length)
    && message.tool_calls!.some((tc) => {
      const resolved = messages.some((m) => (
        m.tool_call_id === tc.id
        || (typeof m.content === 'string' && m.content.startsWith(`__TOOL_RESULT__:${tc.id}:`))
      ));
      return !resolved;
    }));
}

export function hasTerminalMarker(
  messages: Message[],
  kind: 'user_cancel' | 'interrupted' = 'interrupted',
): boolean {
  const needle = kind === 'user_cancel'
    ? 'Tool run cancelled by user'
    : 'Tool run interrupted before completion';
  return messages.some((message) => (
    typeof message.content === 'string'
    && message.content.includes(needle)
    && message.content.includes('do NOT re-request')
  ));
}

export function wireSafeInvokeToDb(
  mockSafeInvoke: { mockImplementation: (fn: (...args: unknown[]) => Promise<unknown>) => unknown },
  db: InMemoryMessageDb,
): void {
  mockSafeInvoke.mockImplementation(async (command: unknown, args?: unknown) => {
    if (command === 'db_save_message') {
      const message = (args as { message: DbMessage }).message;
      db.saveMessage(message);
      return undefined;
    }
    if (command === 'db_save_messages') {
      const messages = (args as { messages: DbMessage[] }).messages;
      db.saveMessages(messages);
      return undefined;
    }
    if (command === 'db_delete_session') {
      db.deleteSession((args as { sessionId: string }).sessionId);
      return undefined;
    }
    return undefined;
  });
}
