import { describe, expect, it } from '@jest/globals';

import {
  isContextOverflowError,
  pruneMessagesForBudget,
  pruneTextForBudget,
} from '../contextBudget';

describe('contextBudget', () => {
  it('drops older messages and truncates oversized tool results', () => {
    const result = pruneMessagesForBudget([
      { role: 'user', content: 'old message 1' },
      { role: 'assistant', content: 'old message 2' },
      { role: 'user', content: `__TOOL_RESULT__:tool-1:${'x'.repeat(300)}` },
      { role: 'user', content: 'latest message' },
    ], {
      maxChars: 120,
      maxToolOutputChars: 40,
      maxMessages: 3,
    });

    expect(result.messages).toHaveLength(3);
    expect(result.messages.some((message) => String(message.content).includes('[tool output truncated]'))).toBe(true);
    expect(result.messages[result.messages.length - 1].content).toBe('latest message');
    expect(result.wasPruned).toBe(true);
    expect(result.droppedReasons).toContain('dropped older messages beyond maxMessages');
  });

  it('truncates oversized system prompt content', () => {
    const result = pruneTextForBudget('a'.repeat(200), 80, 'system prompt');

    expect(result.wasPruned).toBe(true);
    expect(result.text).toContain('[system prompt truncated]');
    expect(result.droppedReasons).toContain('system prompt exceeded budget');
  });

  it('detects context overflow failures from error objects', () => {
    expect(isContextOverflowError(new Error('Context compression check failed. Consider freeing up space.'))).toBe(true);
    expect(isContextOverflowError({ message: 'maximum context length exceeded', status: 413 })).toBe(true);
    expect(isContextOverflowError(new Error('401 Unauthorized'))).toBe(false);
  });
});
