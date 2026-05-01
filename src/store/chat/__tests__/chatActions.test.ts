import { describe, expect, it } from '@jest/globals';
import type { Message } from '../../../types/chat';
import { shouldRemoveEmptyAssistantPlaceholder, withUpdatedTimestamp } from '../chatActions';

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

  it('updates timestamp-shaped values immutably', () => {
    const original = { id: 's1', updatedAt: 1 };
    expect(withUpdatedTimestamp(original, 2)).toEqual({ id: 's1', updatedAt: 2 });
    expect(original.updatedAt).toBe(1);
  });
});
