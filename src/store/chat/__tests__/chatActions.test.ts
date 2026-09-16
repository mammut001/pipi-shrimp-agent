import { describe, expect, it } from '@jest/globals';
import type { Message } from '../../../types/chat';
import {
  removeEmptyAssistantPlaceholderById,
  shouldRemoveEmptyAssistantPlaceholder,
  withUpdatedTimestamp,
} from '../chatActions';
import type { ChatState } from '../../../types/chat';

describe('chatActions', () => {
  it('detects empty assistant placeholders that can be removed after failures', () => {
    const emptyAssistant: Message = { id: 'm1', role: 'assistant', content: '', timestamp: 1 };
    const assistantWithReasoning: Message = { ...emptyAssistant, reasoning: 'thinking' };
    const userMessage: Message = { ...emptyAssistant, role: 'user' };

    expect(shouldRemoveEmptyAssistantPlaceholder(emptyAssistant)).toBe(true);
    expect(shouldRemoveEmptyAssistantPlaceholder(assistantWithReasoning)).toBe(false);
    expect(shouldRemoveEmptyAssistantPlaceholder(userMessage)).toBe(false);
    expect(shouldRemoveEmptyAssistantPlaceholder(undefined)).toBe(false);
  });

  it('removes empty assistant placeholder by message id only (not last-message)', () => {
    const oldPlaceholder: Message = { id: 'old-ph', role: 'assistant', content: '', timestamp: 1 };
    const newerPlaceholder: Message = { id: 'new-ph', role: 'assistant', content: '', timestamp: 2 };
    let sessions = [{
      id: 'session-1',
      title: 't',
      messages: [
        { id: 'u1', role: 'user' as const, content: 'old', timestamp: 1 },
        oldPlaceholder,
        { id: 'u2', role: 'user' as const, content: 'new', timestamp: 2 },
        newerPlaceholder,
      ],
      createdAt: 1,
      updatedAt: 1,
    }];

    const set = (updater: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => {
      const partial = typeof updater === 'function'
        ? updater({ sessions } as ChatState)
        : updater;
      if (partial.sessions) {
        sessions = partial.sessions as typeof sessions;
      }
    };

    // Stale turn targets its own id — must not delete the newer placeholder.
    removeEmptyAssistantPlaceholderById(set as any, 'session-1', 'old-ph');
    expect(sessions[0]!.messages.map((m) => m.id)).toEqual(['u1', 'u2', 'new-ph']);

    // Targeting newer id removes only that placeholder.
    removeEmptyAssistantPlaceholderById(set as any, 'session-1', 'new-ph');
    expect(sessions[0]!.messages.map((m) => m.id)).toEqual(['u1', 'u2']);
  });

  it('updates timestamp-shaped values immutably', () => {
    const original = { id: 's1', updatedAt: 1 };
    expect(withUpdatedTimestamp(original, 2)).toEqual({ id: 's1', updatedAt: 2 });
    expect(original.updatedAt).toBe(1);
  });
});
