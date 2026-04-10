/**
 * useMultiSelect - Reusable multi-select state management hook
 *
 * Provides:
 * - Multi-select mode toggle
 * - Item selection/deselection
 * - Select all / deselect all
 * - Selection count
 * - Clear selection
 */

import { useCallback, useState } from 'react';

export interface UseMultiSelectOptions<T> {
  items: T[];
  getItemId: (item: T) => string;
  initialSelected?: Set<string>;
}

export interface UseMultiSelectReturn<T> {
  // State
  isMultiSelectMode: boolean;
  selectedIds: Set<string>;
  selectedCount: number;

  // Actions
  toggleMultiSelectMode: () => void;
  exitMultiSelectMode: () => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  toggleSelectAll: () => void;
  isAllSelected: () => boolean;
  isSelected: (id: string) => boolean;

  // Batch operations
  getSelectedItems: () => T[];
  clearSelection: () => void;
}

export function useMultiSelect<T>({
  items,
  getItemId,
  initialSelected = new Set(),
}: UseMultiSelectOptions<T>): UseMultiSelectReturn<T> {
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelected);

  const toggleMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode((prev) => {
      if (prev) {
        setSelectedIds(new Set());
      }
      return !prev;
    });
  }, []);

  const exitMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    const allIds = items.map(getItemId);
    setSelectedIds(new Set(allIds));
  }, [items, getItemId]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleSelectAll = useCallback(() => {
    const allIds = items.map(getItemId);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    if (allSelected && selectedIds.size > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  }, [items, selectedIds, getItemId]);

  const isAllSelected = useCallback(() => {
    if (items.length === 0) return false;
    const allIds = items.map(getItemId);
    return allIds.every((id) => selectedIds.has(id));
  }, [items, selectedIds, getItemId]);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const getSelectedItems = useCallback(() => {
    return items.filter((item) => selectedIds.has(getItemId(item)));
  }, [items, selectedIds, getItemId]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    isMultiSelectMode,
    selectedIds,
    selectedCount: selectedIds.size,
    toggleMultiSelectMode,
    exitMultiSelectMode,
    toggleSelection,
    selectAll,
    deselectAll,
    toggleSelectAll,
    isAllSelected,
    isSelected,
    getSelectedItems,
    clearSelection,
  };
}
