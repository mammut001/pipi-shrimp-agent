import type { ChatState, Message } from '../../types/chat';
import { messageToDb } from '../../utils/chatHelpers';
import { safeInvoke } from '../../utils/safeInvoke';

type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

/**
 * Strip orphan tool_calls from the last assistant message so a follow-up turn
 * does not present an unfinished tool request to the model.
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

  const lastMessage = session.messages[session.messages.length - 1];
  if (lastMessage.role !== 'assistant' || !lastMessage.tool_calls?.length) {
    return;
  }

  const cleanedMessage: Message = {
    ...lastMessage,
    content: lastMessage.content.trim() || '[Tool execution cancelled before completion.]',
    tool_calls: undefined,
  };

  set((state) => ({
    sessions: state.sessions.map((candidate) => (
      candidate.id === sessionId
        ? {
            ...candidate,
            updatedAt: Date.now(),
            messages: candidate.messages.map((message, index) => (
              index === candidate.messages.length - 1 ? cleanedMessage : message
            )),
          }
        : candidate
    )),
  }));

  try {
    await safeInvoke('db_save_message', { message: messageToDb(cleanedMessage, sessionId) });
  } catch (error) {
    console.error('Failed to scrub dangling tool_calls from database:', error);
  }
}
