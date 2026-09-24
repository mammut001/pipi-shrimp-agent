/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { useChatMessageScroll } from '../useChatMessageScroll';

describe('useChatMessageScroll (TOP-15-03)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps windowed history changes from jumping to bottom and clears debounce on unmount', () => {
    jest.useFakeTimers();
    const { result, rerender, unmount } = renderHook(
      ({ messages }) => useChatMessageScroll(messages),
      { initialProps: { messages: [] as unknown[] } },
    );

    const container = document.createElement('div');
    Object.defineProperties(container, {
      scrollHeight: { value: 1000, configurable: true },
      scrollTop: { value: 0, writable: true, configurable: true },
      clientHeight: { value: 100, configurable: true },
    });
    const scrollIntoView = jest.fn();
    result.current.scrollContainerRef.current = container;
    result.current.messagesEndRef.current = { scrollIntoView } as unknown as HTMLDivElement;

    act(() => {
      result.current.handleScroll();
      jest.advanceTimersByTime(100);
    });

    expect(result.current.userScrolledUp).toBe(true);
    rerender({ messages: ['older message', 'latest message'] });
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => {
      result.current.handleScroll();
    });
    expect(jest.getTimerCount()).toBe(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
