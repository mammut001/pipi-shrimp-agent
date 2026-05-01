import type { Message } from '@/types/chat';

export const DEFAULT_MESSAGE_WINDOW_SIZE = 80;

export function getVisibleMessageWindow<T extends Pick<Message, 'id'>>(
  messages: T[],
  windowSize = DEFAULT_MESSAGE_WINDOW_SIZE,
): T[] {
  if (windowSize <= 0 || messages.length <= windowSize) {
    return messages;
  }

  return messages.slice(messages.length - windowSize);
}

export function getHiddenMessageCount(messages: readonly unknown[], visibleMessages: readonly unknown[]): number {
  return Math.max(0, messages.length - visibleMessages.length);
}
