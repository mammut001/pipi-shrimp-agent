/**
 * useSearch - Reusable search state management hook
 *
 * Provides:
 * - Search query state
 * - Filtered results based on query
 * - Clear search function
 * - Search active status
 */

import { useState, useCallback, useMemo } from 'react';

export interface UseSearchOptions<T> {
  items: T[];
  filter: (item: T, query: string) => boolean;
  placeholder?: string;
}

export interface UseSearchReturn<T> {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredItems: T[] | null;
  isSearchActive: boolean;
  clearSearch: () => void;
  resultCount: number | null;
}

export function useSearch<T>({
  items,
  filter,
}: UseSearchOptions<T>): UseSearchReturn<T> {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = useMemo((): T[] | null => {
    if (!searchQuery.trim()) return null; // null = no filter active
    const q = searchQuery.toLowerCase();
    return items.filter((item) => filter(item, q));
  }, [items, searchQuery, filter]);

  const isSearchActive = searchQuery.trim().length > 0;

  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const resultCount = filteredItems !== null ? filteredItems.length : null;

  return {
    searchQuery,
    setSearchQuery,
    filteredItems,
    isSearchActive,
    clearSearch,
    resultCount,
  };
}
