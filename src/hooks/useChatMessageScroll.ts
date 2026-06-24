import { useCallback, useEffect, useRef, useState } from 'react';

const SCROLL_AWAY_THRESHOLD_PX = 100;
const SCROLL_DEBOUNCE_MS = 100;

export function useChatMessageScroll(messages: unknown[]) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const scrollDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = useCallback(() => {
    if (scrollDebounceTimer.current) {
      clearTimeout(scrollDebounceTimer.current);
    }
    scrollDebounceTimer.current = setTimeout(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setUserScrolledUp(distanceFromBottom > SCROLL_AWAY_THRESHOLD_PX);
    }, SCROLL_DEBOUNCE_MS);
  }, []);

  const scrollToBottom = useCallback(() => {
    setUserScrolledUp(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, userScrolledUp]);

  useEffect(() => {
    return () => {
      if (scrollDebounceTimer.current) {
        clearTimeout(scrollDebounceTimer.current);
        scrollDebounceTimer.current = null;
      }
    };
  }, []);

  return {
    scrollContainerRef,
    messagesEndRef,
    userScrolledUp,
    handleScroll,
    scrollToBottom,
  };
}