import type { ChatState, Message, ToolCall } from '../../types/chat';
import { createMessage } from '../../types/chat';
import { messageToDb, parseToolResultMessage } from '../../utils/chatHelpers';
import { safeInvoke } from '../../utils/safeInvoke';
import { safeSetItem } from '../../utils/safeStorage';

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

export type OrphanToolCall = {
  messageId: string;
  toolCall: ToolCall;
};

export type ToolCancelNoticeKind = 'user_cancel' | 'interrupted';

export function collectResolvedToolCallIds(messages: Message[]): Set<string> {
  const resolved = new Set<string>();
  for (const message of messages) {
    if (typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0) {
      resolved.add(message.tool_call_id);
    }
    const parsed = parseToolResultMessage(message);
    if (parsed) {
      resolved.add(parsed.toolCallId);
    }
  }
  return resolved;
}

/**
 * List assistant tool_calls that have no matching tool result in history.
 * Pure: does not consult toolRuntimeState.
 */
export function listOrphanToolCalls(messages: Message[]): OrphanToolCall[] {
  const resolvedIds = collectResolvedToolCallIds(messages);
  const orphans: OrphanToolCall[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.tool_calls?.length) {
      continue;
    }
    for (const toolCall of message.tool_calls) {
      if (!resolvedIds.has(toolCall.id)) {
        orphans.push({ messageId: message.id, toolCall });
      }
    }
  }
  return orphans;
}

function scrubAssistantToolCalls(message: Message, resolvedIds: Set<string>): Message | null {
  if (message.role !== 'assistant' || !message.tool_calls?.length) {
    return null;
  }

  const remaining = message.tool_calls.filter((toolCall) => resolvedIds.has(toolCall.id));
  if (remaining.length === message.tool_calls.length) {
    return null;
  }

  return {
    ...message,
    content: message.content.trim()
      || (remaining.length === 0 ? '[Tool execution cancelled before completion.]' : message.content),
    tool_calls: remaining.length > 0 ? remaining : undefined,
  };
}

/**
 * Pure message rewrite: strip orphan tool_calls and optionally append a
 * durable cancel/interrupted assistant notice for the next runChatTurn.
 */
export function terminalizeInterruptedMessages(
  messages: Message[],
  options: { kind?: ToolCancelNoticeKind; now?: number } = {},
): {
  messages: Message[];
  changed: boolean;
  orphans: OrphanToolCall[];
  scrubbedById: Map<string, Message>;
  notice: Message | null;
} {
  const kind = options.kind ?? 'interrupted';
  const orphans = listOrphanToolCalls(messages);
  if (orphans.length === 0) {
    return {
      messages,
      changed: false,
      orphans,
      scrubbedById: new Map(),
      notice: null,
    };
  }

  const resolvedIds = collectResolvedToolCallIds(messages);
  const scrubbedById = new Map<string, Message>();
  const nextMessages = messages.map((message) => {
    const cleaned = scrubAssistantToolCalls(message, resolvedIds);
    if (!cleaned) {
      return message;
    }
    scrubbedById.set(cleaned.id, cleaned);
    return cleaned;
  });

  const toolNames = [...new Set(orphans.map((orphan) => orphan.toolCall.name))];
  const toolCallIds = orphans.map((orphan) => orphan.toolCall.id);
  const notice = createMessage('assistant', buildToolCancelNoticeContent(toolNames, kind, toolCallIds));
  if (typeof options.now === 'number') {
    notice.timestamp = options.now;
  }
  notice.metadata = {
    interruptedTurnTerminal: true,
    cancelNoticeKind: kind,
    orphanToolCallIds: orphans.map((orphan) => orphan.toolCall.id),
  };

  return {
    messages: [...nextMessages, notice],
    changed: true,
    orphans,
    scrubbedById,
    notice,
  };
}

/** Durable marker so hydrate can scrub late tool results after DB reload (metadata is not persisted). */
export const CANCELLED_TOOL_CALL_IDS_MARKER = 'cancelled_tool_call_ids';

export function buildToolCancelNoticeContent(
  toolNames: string[],
  kind: ToolCancelNoticeKind = 'interrupted',
  toolCallIds: string[] = [],
): string {
  const label = toolNames.join(', ') || 'unknown tool';
  const idClause = toolCallIds.length > 0
    ? ` [${CANCELLED_TOOL_CALL_IDS_MARKER}: ${toolCallIds.join(',')}]`
    : '';
  if (kind === 'user_cancel') {
    return (
      `[Tool run cancelled by user: ${label}.${idClause} `
      + 'Treat this as a terminal cancel for that attempt — do NOT re-request the same tool '
      + 'or assume it completed. Ask the user before retrying.]'
    );
  }
  return (
    `[Tool run interrupted before completion (session reloaded): ${label}.${idClause} `
    + 'Treat this as a terminal cancel for that attempt — do NOT re-request the same tool '
    + 'or assume it completed. Ask the user before retrying.]'
  );
}

export function collectCancelledToolCallIdsFromNotices(messages: Message[]): Set<string> {
  const ids = new Set<string>();
  const markerRe = new RegExp(`\\[${CANCELLED_TOOL_CALL_IDS_MARKER}:\\s*([^\\]]+)\\]`);
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content !== 'string') {
      continue;
    }
    const isCancelNotice = message.content.includes('Tool run cancelled by user')
      || message.content.includes('Tool run interrupted before completion');
    if (!isCancelNotice) {
      continue;
    }
    const match = message.content.match(markerRe);
    if (match) {
      for (const id of match[1].split(',').map((part) => part.trim()).filter(Boolean)) {
        ids.add(id);
      }
    }
    const metaIds = message.metadata?.orphanToolCallIds;
    if (Array.isArray(metaIds)) {
      for (const id of metaIds) {
        if (typeof id === 'string' && id.length > 0) {
          ids.add(id);
        }
      }
    }
  }
  return ids;
}

/**
 * After cancel/interrupted notice is durable, a late tool completion may re-upsert
 * assistant tool_calls + a successful __TOOL_RESULT__. Strip those so next-turn
 * history cannot treat the cancelled attempt as success.
 */
export function scrubLateCompletionsAfterCancel(messages: Message[]): {
  messages: Message[];
  changed: boolean;
  scrubbedById: Map<string, Message>;
  droppedResultIds: string[];
} {
  const cancelledIds = collectCancelledToolCallIdsFromNotices(messages);
  if (cancelledIds.size === 0) {
    return {
      messages,
      changed: false,
      scrubbedById: new Map(),
      droppedResultIds: [],
    };
  }

  const scrubbedById = new Map<string, Message>();
  const droppedResultIds: string[] = [];
  const nextMessages: Message[] = [];

  for (const message of messages) {
    const parsed = parseToolResultMessage(message);
    if (parsed && cancelledIds.has(parsed.toolCallId)) {
      droppedResultIds.push(message.id);
      continue;
    }
    if (typeof message.tool_call_id === 'string' && cancelledIds.has(message.tool_call_id)) {
      droppedResultIds.push(message.id);
      continue;
    }

    if (message.role === 'assistant' && message.tool_calls?.length) {
      const remaining = message.tool_calls.filter((toolCall) => !cancelledIds.has(toolCall.id));
      if (remaining.length !== message.tool_calls.length) {
        const cleaned: Message = {
          ...message,
          content: message.content.trim()
            || (remaining.length === 0 ? '[Tool execution cancelled before completion.]' : message.content),
          tool_calls: remaining.length > 0 ? remaining : undefined,
        };
        scrubbedById.set(cleaned.id, cleaned);
        nextMessages.push(cleaned);
        continue;
      }
    }

    nextMessages.push(message);
  }

  return {
    messages: nextMessages,
    changed: scrubbedById.size > 0 || droppedResultIds.length > 0,
    scrubbedById,
    droppedResultIds,
  };
}


/**
 * Persist pending tool_calls onto the in-flight assistant placeholder before
 * tools execute. Crash/kill mid-tool then leaves durable orphans in SQLite so
 * hydrate `terminalizeInterrupted*` can scrub + show the interrupted notice.
 * Without this, the placeholder is empty content with NULL tool_calls and
 * reopen shows a blank agent row with no notice (live Tauri soak failure).
 */
export async function persistAssistantPendingToolCalls(
  sessionId: string,
  assistantMessageId: string,
  tools: Array<{ id: string; name: string; arguments: string }>,
  set: ChatSetState,
  get: () => ChatState,
  options: {
    content?: string;
    reasoning?: string;
    persist?: 'db' | 'none';
  } = {},
): Promise<boolean> {
  if (!tools.length) {
    return false;
  }

  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    return false;
  }
  const messageIndex = session.messages.findIndex((message) => message.id === assistantMessageId);
  if (messageIndex === -1) {
    return false;
  }
  const existing = session.messages[messageIndex];
  if (existing.role !== 'assistant') {
    return false;
  }

  const toolCalls: ToolCall[] = tools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    arguments: tool.arguments,
  }));

  const nextContent = typeof options.content === 'string' ? options.content : existing.content;
  const nextReasoning = typeof options.reasoning === 'string'
    ? options.reasoning
    : existing.reasoning;

  const updated: Message = {
    ...existing,
    content: nextContent,
    reasoning: nextReasoning,
    tool_calls: toolCalls,
  };

  const now = Date.now();
  set((state) => ({
    sessions: state.sessions.map((candidate) => (
      candidate.id === sessionId
        ? {
            ...candidate,
            updatedAt: now,
            messages: candidate.messages.map((message, index) => (
              index === messageIndex ? updated : message
            )),
          }
        : candidate
    )),
  }));

  const persist = options.persist ?? 'db';
  if (persist === 'db') {
    try {
      await safeInvoke('db_save_message', { message: messageToDb(updated, sessionId) });
    } catch (error) {
      console.error('Failed to persist mid-tool assistant tool_calls:', error);
    }
  }
  return true;
}

/**
 * Clear pending tool_calls after a tool batch completes (success or handled
 * failure). Leaves content/reasoning intact. Crash mid-wait never reaches this
 * path, so orphans remain durable for hydrate.
 */
export async function clearAssistantPendingToolCalls(
  sessionId: string,
  assistantMessageId: string,
  set: ChatSetState,
  get: () => ChatState,
  options: { persist?: 'db' | 'none' } = {},
): Promise<boolean> {
  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    return false;
  }
  const messageIndex = session.messages.findIndex((message) => message.id === assistantMessageId);
  if (messageIndex === -1) {
    return false;
  }
  const existing = session.messages[messageIndex];
  if (existing.role !== 'assistant' || !existing.tool_calls?.length) {
    return false;
  }

  const updated: Message = {
    ...existing,
    tool_calls: undefined,
  };

  const now = Date.now();
  set((state) => ({
    sessions: state.sessions.map((candidate) => (
      candidate.id === sessionId
        ? {
            ...candidate,
            updatedAt: now,
            messages: candidate.messages.map((message, index) => (
              index === messageIndex ? updated : message
            )),
          }
        : candidate
    )),
  }));

  const persist = options.persist ?? 'db';
  if (persist === 'db') {
    try {
      await safeInvoke('db_save_message', { message: messageToDb(updated, sessionId) });
    } catch (error) {
      console.error('Failed to clear mid-tool assistant tool_calls after batch:', error);
    }
  }
  return true;
}

/**
 * Strip orphan tool_calls from any assistant message that lacks a matching
 * tool result, so a follow-up turn does not present unfinished tool requests.
 */
export async function scrubDanglingToolCalls(
  sessionId: string,
  set: ChatSetState,
  get: () => ChatState,
): Promise<void> {
  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session || session.messages.length === 0) {
    return;
  }

  const resolvedIds = collectResolvedToolCallIds(session.messages);
  const cleanedById = new Map<string, Message>();
  const nextMessages = session.messages.map((message) => {
    const cleaned = scrubAssistantToolCalls(message, resolvedIds);
    if (!cleaned) {
      return message;
    }
    cleanedById.set(cleaned.id, cleaned);
    return cleaned;
  });

  if (cleanedById.size === 0) {
    return;
  }

  set((state) => ({
    sessions: state.sessions.map((candidate) => (
      candidate.id === sessionId
        ? {
            ...candidate,
            updatedAt: Date.now(),
            messages: nextMessages,
          }
        : candidate
    )),
  }));

  for (const cleanedMessage of cleanedById.values()) {
    try {
      await safeInvoke('db_save_message', { message: messageToDb(cleanedMessage, sessionId) });
    } catch (error) {
      console.error('Failed to scrub dangling tool_calls from database:', error);
    }
  }
}

export type TerminalizePersistMode = 'db' | 'localStorage' | 'none';

/** localStorage key used when DB init fails and sessions are loaded from backup. */
export const SESSIONS_LOCAL_STORAGE_KEY = 'pipi-shrimp-sessions';

export type TerminalizeInterruptedOptions = {
  kind?: ToolCancelNoticeKind;
  /**
   * Where to persist the terminalized history.
   * - `db` (default): one transactional `db_save_messages` of scrubbed + notice
   * - `localStorage`: caller/forSessions writes full sessions snapshot after
   * - `none`: in-memory only (tests)
   */
  persist?: TerminalizePersistMode;
};

/**
 * On session load / DB hydration: terminalize interrupted tool turns using
 * persisted history only (no toolRuntimeState). Scrubs orphan tool_calls and
 * writes a durable cancel/interrupted notice into session + DB.
 *
 * Persistence (db mode): scrubbed assistants + interrupted notice are written
 * in a **single** `db_save_messages` invoke (SQLite transaction on the Rust
 * side) so a crash mid-hydrate cannot leave scrubbed orphans without notice
 * (or notice without scrub). Residual: process kill *during* the single
 * invoke still depends on SQLite commit atomicity of that transaction; there
 * is no multi-round-trip window between scrub and notice anymore.
 */
export async function terminalizeInterruptedToolTurns(
  sessionId: string,
  set: ChatSetState,
  get: () => ChatState,
  options: TerminalizeInterruptedOptions = {},
): Promise<boolean> {
  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session || session.messages.length === 0) {
    return false;
  }

  // First: strip late successful completions that contradict an existing cancel notice
  // (IDs survive in notice content; metadata alone is lost across DB reload).
  const late = scrubLateCompletionsAfterCancel(session.messages);
  let workingMessages = late.messages;
  if (late.changed) {
    const nowLate = Date.now();
    set((state) => ({
      sessions: state.sessions.map((candidate) => (
        candidate.id === sessionId
          ? {
              ...candidate,
              updatedAt: nowLate,
              messages: workingMessages,
            }
          : candidate
      )),
    }));
  }

  const result = terminalizeInterruptedMessages(workingMessages, {
    kind: options.kind ?? 'interrupted',
  });
  if (!late.changed && (!result.changed || !result.notice)) {
    return false;
  }

  if (result.changed && result.notice) {
    const now = Date.now();
    set((state) => ({
      sessions: state.sessions.map((candidate) => (
        candidate.id === sessionId
          ? {
              ...candidate,
              updatedAt: now,
              messages: result.messages,
            }
          : candidate
      )),
    }));
  }

  const persist = options.persist ?? 'db';
  if (persist === 'db') {
    if (late.droppedResultIds.length > 0) {
      try {
        await safeInvoke('delete_messages_by_ids', { messageIds: late.droppedResultIds });
      } catch (error) {
        console.error('Failed to delete late cancelled tool results during hydrate:', error);
        for (const messageId of late.droppedResultIds) {
          try {
            await safeInvoke('db_delete_message', { messageId });
          } catch (fallbackError) {
            console.error('Failed to delete late tool result message:', fallbackError);
          }
        }
      }
    }

    const scrubbedById = new Map<string, Message>([
      ...late.scrubbedById.entries(),
      ...result.scrubbedById.entries(),
    ]);
    const toPersist = [
      ...scrubbedById.values(),
      ...(result.notice ? [result.notice] : []),
    ].map((message) => messageToDb(message, sessionId));
    if (toPersist.length > 0) {
      try {
        await safeInvoke('db_save_messages', { messages: toPersist });
      } catch (error) {
        console.error('Failed to persist hydrate terminalize (scrub + notice) atomically:', error);
        for (const message of toPersist) {
          try {
            await safeInvoke('db_save_message', { message });
          } catch (fallbackError) {
            console.error('Failed to persist message during hydrate terminalize fallback:', fallbackError);
          }
        }
      }
    }
  }

  return true;
}

/**
 * Write the current in-memory sessions snapshot back to localStorage so a
 * subsequent reload of the localStorage fallback path does not re-see orphans.
 */
export function persistSessionsToLocalStorage(get: () => ChatState): boolean {
  try {
    return safeSetItem(SESSIONS_LOCAL_STORAGE_KEY, JSON.stringify(get().sessions));
  } catch (error) {
    console.error('Failed to persist terminalized sessions to localStorage:', error);
    return false;
  }
}

/**
 * Terminalize every loaded session after DB / localStorage hydration.
 * When `persist: 'localStorage'`, writes the updated sessions snapshot once
 * after all sessions are terminalized (in-memory store is already updated).
 */
export async function terminalizeInterruptedToolTurnsForSessions(
  set: ChatSetState,
  get: () => ChatState,
  options: TerminalizeInterruptedOptions = {},
): Promise<number> {
  const persist = options.persist ?? 'db';
  const sessionIds = get().sessions.map((session) => session.id);
  let terminalized = 0;
  for (const sessionId of sessionIds) {
    if (await terminalizeInterruptedToolTurns(sessionId, set, get, {
      ...options,
      // Per-session localStorage writes would race; defer to one snapshot below.
      persist: persist === 'localStorage' ? 'none' : persist,
    })) {
      terminalized += 1;
    }
  }
  if (persist === 'localStorage' && terminalized > 0) {
    persistSessionsToLocalStorage(get);
  }
  return terminalized;
}
