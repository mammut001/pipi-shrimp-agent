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
  | { op: 'db_delete_session'; sessionId: string }
  | { op: 'db_delete_message'; messageId: string };

export class InMemoryMessageDb {
  /** sessionId → messageId → row */
  private rows = new Map<string, Map<string, DbMessage>>();
  /**
   * Parent session registry — mirrors SQLite `sessions` + FK(session_id).
   * Messages cannot be saved unless the session row exists (no auto-create).
   */
  private sessions = new Set<string>();
  /** Sessions that were explicitly deleted (for assertions). */
  private deleted = new Set<string>();
  readonly calls: PersistCall[] = [];
  /** Late saves rejected because the session parent is missing (FK semantics). */
  readonly rejectedSaves: PersistCall[] = [];

  clear(): void {
    this.rows.clear();
    this.sessions.clear();
    this.deleted.clear();
    this.calls.length = 0;
    this.rejectedSaves.length = 0;
  }

  seed(sessionId: string, messages: Message[]): void {
    const map = new Map<string, DbMessage>();
    for (const message of messages) {
      map.set(message.id, messageToDb(message, sessionId));
    }
    this.rows.set(sessionId, map);
    this.sessions.add(sessionId);
    this.deleted.delete(sessionId);
  }

  saveMessage(message: DbMessage): void {
    this.calls.push({ op: 'db_save_message', message });
    // Match production with PRAGMA foreign_keys=ON: no session parent → reject, no resurrection.
    if (!this.sessions.has(message.session_id)) {
      this.rejectedSaves.push({ op: 'db_save_message', message });
      return;
    }
    let map = this.rows.get(message.session_id);
    if (!map) {
      map = new Map();
      this.rows.set(message.session_id, map);
    }
    map.set(message.id, message);
  }

  /**
   * Simulates transactional bulk upsert (db_save_messages).
   * Entire batch is rejected if any message references a missing session (FK).
   */
  saveMessages(messages: DbMessage[]): void {
    this.calls.push({ op: 'db_save_messages', messages: [...messages] });
    if (messages.some((message) => !this.sessions.has(message.session_id))) {
      this.rejectedSaves.push({ op: 'db_save_messages', messages: [...messages] });
      return;
    }
    for (const message of messages) {
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
    this.sessions.delete(sessionId);
    this.rows.delete(sessionId);
  }

  deleteMessage(messageId: string): void {
    this.calls.push({ op: 'db_delete_message', messageId });
    for (const map of this.rows.values()) {
      map.delete(messageId);
    }
  }

  deleteMessagesByIds(messageIds: string[]): void {
    for (const messageId of messageIds) {
      this.deleteMessage(messageId);
    }
  }

  getMessages(sessionId: string): DbMessage[] {
    const map = this.rows.get(sessionId);
    if (!map) return [];
    return [...map.values()].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
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
    if (command === 'db_delete_message') {
      db.deleteMessage((args as { messageId: string }).messageId);
      return undefined;
    }
    if (command === 'delete_messages_by_ids') {
      db.deleteMessagesByIds((args as { messageIds: string[] }).messageIds);
      return undefined;
    }
    return undefined;
  });
}

/** True when next-turn API history presents toolCallId as a completed success containing needle. */
export function apiHasSuccessfulToolOutcome(
  api: Array<{ content?: string; tool_calls?: unknown[] }>,
  toolCallId: string,
  bodyNeedle: string,
): boolean {
  const hasToolCall = api.some((message) => (
    Array.isArray(message.tool_calls)
    && message.tool_calls.some((tc) => {
      if (!tc || typeof tc !== 'object') return false;
      const id = 'id' in tc ? (tc as { id?: string }).id : (tc as { tool_call_id?: string }).tool_call_id;
      return id === toolCallId;
    })
  ));
  const hasResult = api.some((message) => (
    typeof message.content === 'string'
    && message.content.includes(`__TOOL_RESULT__:${toolCallId}:`)
    && message.content.includes(bodyNeedle)
  ));
  return hasToolCall && hasResult;
}
