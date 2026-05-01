import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_MESSAGE_WINDOW_SIZE,
  getHiddenMessageCount,
  getVisibleMessageWindow,
} from '../messageWindowing';

describe('messageWindowing', () => {
  it('returns the original list when it fits within the window', () => {
    const messages = [{ id: '1' }, { id: '2' }];
    expect(getVisibleMessageWindow(messages, 3)).toBe(messages);
  });

  it('keeps the most recent messages when the list is larger than the window', () => {
    const messages = Array.from({ length: DEFAULT_MESSAGE_WINDOW_SIZE + 2 }, (_, index) => ({ id: String(index) }));
    const visible = getVisibleMessageWindow(messages);

    expect(visible).toHaveLength(DEFAULT_MESSAGE_WINDOW_SIZE);
    expect(visible[0]?.id).toBe('2');
    expect(visible.at(-1)?.id).toBe(String(DEFAULT_MESSAGE_WINDOW_SIZE + 1));
  });

  it('reports hidden message count defensively', () => {
    expect(getHiddenMessageCount([1, 2, 3], [2, 3])).toBe(1);
    expect(getHiddenMessageCount([1], [1, 2])).toBe(0);
  });
});
