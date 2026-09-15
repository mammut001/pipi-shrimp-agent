import type { ChatState, Message, ToolCall } from '../../types/chat';
import { createMessage } from '../../types/chat';
import { messageToDb, parseToolResultMessage } from '../../utils/chatHelpers';
import { safeInvoke } from '../../utils/safeInvoke';

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
  const notice = createMessage('assistant', buildToolCancelNoticeContent(toolNames, kind));
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

export function buildToolCancelNoticeContent(
  toolNames: string[],
  kind: ToolCancelNoticeKind = 'interrupted',
): string {
  const label = toolNames.join(', ') || 'unknown tool';
  if (kind === 'user_cancel') {
    return (
      `[Tool run cancelled by user: ${label}. `
      + 'Treat this as a terminal cancel for that attempt — do NOT re-request the same tool '
      + 'or assume it completed. Ask the user before retrying.]'
    );
  }
  return (
    `[Tool run interrupted before completion (session reloaded): ${label}. `
    + 'Treat this as a terminal cancel for that attempt — do NOT re-request the same tool '
    + 'or assume it completed. Ask the user before retrying.]'
  );
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

/**
 * On session load / DB hydration: terminalize interrupted tool turns using
 * persisted history only (no toolRuntimeState). Scrubs orphan tool_calls and
 * writes a durable cancel/interrupted notice into session + DB.
 */
export async function terminalizeInterruptedToolTurns(
  sessionId: string,
  set: ChatSetState,
  get: () => ChatState,
  options: { kind?: ToolCancelNoticeKind } = {},
): Promise<boolean> {
  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session || session.messages.length === 0) {
    return false;
  }

  const result = terminalizeInterruptedMessages(session.messages, {
    kind: options.kind ?? 'interrupted',
  });
  if (!result.changed || !result.notice) {
    return false;
  }

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

  for (const cleanedMessage of result.scrubbedById.values()) {
    try {
      await safeInvoke('db_save_message', { message: messageToDb(cleanedMessage, sessionId) });
    } catch (error) {
      console.error('Failed to persist scrubbed tool_calls during hydrate terminalize:', error);
    }
  }

  try {
    await safeInvoke('db_save_message', { message: messageToDb(result.notice, sessionId) });
  } catch (error) {
    console.error('Failed to persist interrupted-turn cancel notice:', error);
  }

  return true;
}

/**
 * Terminalize every loaded session after DB / localStorage hydration.
 */
export async function terminalizeInterruptedToolTurnsForSessions(
  set: ChatSetState,
  get: () => ChatState,
  options: { kind?: ToolCancelNoticeKind } = {},
): Promise<number> {
  const sessionIds = get().sessions.map((session) => session.id);
  let terminalized = 0;
  for (const sessionId of sessionIds) {
    if (await terminalizeInterruptedToolTurns(sessionId, set, get, options)) {
      terminalized += 1;
    }
  }
  return terminalized;
}
