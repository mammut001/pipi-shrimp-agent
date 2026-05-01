import type { Message } from '../../types/chat';

export function shouldRemoveEmptyAssistantPlaceholder(message: Message | undefined): boolean {
  return Boolean(message && message.role === 'assistant' && !message.content && !message.reasoning);
}

export function withUpdatedTimestamp<T extends { updatedAt: number }>(value: T, now = Date.now()): T {
  return { ...value, updatedAt: now };
}
