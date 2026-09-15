import type { ChatState, Message } from '../../types/chat';
import { messageToDb, parseToolResultMessage } from '../../utils/chatHelpers';
import { safeInvoke } from '../../utils/safeInvoke';

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

function collectResolvedToolCallIds(messages: Message[]): Set<string> {
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
