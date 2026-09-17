/**
 * @jest-environment jsdom
 *
 * INFRA-01 / Top-15 #3 sample: RTL renderHook coverage for useChatMessageScroll
 * (debounce + unmount cleanup + auto-scroll when pinned to bottom).
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, renderHook } from '@testing-library/react';

import { useChatMessageScroll } from '@/hooks/useChatMessageScroll';

const SCROLL_AWAY_THRESHOLD_PX = 100;
const SCROLL_DEBOUNCE_MS = 100;

function attachScrollContainer(
  result: { current: ReturnType<typeof useChatMessageScroll> },
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (v: number) => {
        metrics.scrollTop = v;
      },
    },
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
  });
  act(() => {
    (result.current.scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  });
  return el;
}

function attachMessagesEnd(
  result: { current: ReturnType<typeof useChatMessageScroll> },
): { el: HTMLDivElement; scrollIntoView: jest.Mock } {
  const el = document.createElement('div');
  const scrollIntoView = jest.fn();
  el.scrollIntoView = scrollIntoView as unknown as typeof el.scrollIntoView;
  act(() => {
    (result.current.messagesEndRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  });
  return { el, scrollIntoView };
}

describe('useChatMessageScroll (INFRA-01 sample / R10-13)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('exposes scroll refs and helpers', () => {
    const { result } = renderHook(() => useChatMessageScroll([]));
    expect(result.current.scrollContainerRef).toBeTruthy();
    expect(result.current.messagesEndRef).toBeTruthy();
    expect(result.current.userScrolledUp).toBe(false);
    expect(typeof result.current.handleScroll).toBe('function');
    expect(typeof result.current.scrollToBottom).toBe('function');
  });

  it('auto-scrolls on new messages while pinned to bottom', () => {
    const { result, rerender } = renderHook(
      ({ messages }) => useChatMessageScroll(messages),
      { initialProps: { messages: [{ id: '1' }] as unknown[] } },
    );
    const { scrollIntoView } = attachMessagesEnd(result);
    scrollIntoView.mockClear();

    rerender({ messages: [{ id: '1' }, { id: '2' }] });
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('marks userScrolledUp after scrolling away past the threshold (debounced)', () => {
    const { result } = renderHook(() => useChatMessageScroll([]));
    const metrics = { scrollHeight: 1000, scrollTop: 0, clientHeight: 400 };
    attachScrollContainer(result, metrics);
    // distanceFromBottom = 1000 - 0 - 400 = 600 > 100
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.userScrolledUp).toBe(false);

    act(() => {
      jest.advanceTimersByTime(SCROLL_DEBOUNCE_MS);
    });
    expect(result.current.userScrolledUp).toBe(true);
    expect(SCROLL_AWAY_THRESHOLD_PX).toBe(100);
  });

  it('clears the scroll debounce timer on unmount', () => {
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useChatMessageScroll([]));
    const metrics = { scrollHeight: 1000, scrollTop: 0, clientHeight: 400 };
    attachScrollContainer(result, metrics);

    act(() => {
      result.current.handleScroll();
    });
    const clearsBefore = clearSpy.mock.calls.length;
    unmount();
    expect(clearSpy.mock.calls.length).toBeGreaterThan(clearsBefore);
  });

  it('scrollToBottom clears userScrolledUp and scrolls into view', () => {
    const { result } = renderHook(() => useChatMessageScroll([]));
    const metrics = { scrollHeight: 1000, scrollTop: 0, clientHeight: 400 };
    attachScrollContainer(result, metrics);
    const { scrollIntoView } = attachMessagesEnd(result);

    act(() => {
      result.current.handleScroll();
      jest.advanceTimersByTime(SCROLL_DEBOUNCE_MS);
    });
    expect(result.current.userScrolledUp).toBe(true);

    act(() => {
      result.current.scrollToBottom();
    });
    expect(result.current.userScrolledUp).toBe(false);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
