/**
 * MultiSelectToolbar - Reusable batch action toolbar for multi-select mode
 *
 * Shows selected count and batch action buttons
 */

import React from 'react';

interface MultiSelectToolbarProps {
  selectedCount: number;
  isAllSelected: boolean;
  onToggleSelectAll: () => void;
  onExitMultiSelect: () => void;
  actions?: React.ReactNode;
  className?: string;
}

export function MultiSelectToolbar({
  selectedCount,
  isAllSelected,
  onToggleSelectAll,
  onExitMultiSelect,
  actions,
  className = '',
}: MultiSelectToolbarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      className={`mx-2 px-2.5 py-2 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden flex items-center gap-2 ${className}`}
    >
      {/* Exit multi-select button */}
      <button
        onClick={onExitMultiSelect}
        className="p-1 hover:bg-gray-100 rounded-md transition-colors"
        title="Exit multi-select"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4 text-gray-500"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Count */}
      <span className="text-xs font-semibold text-gray-700 tabular-nums whitespace-nowrap">
        {selectedCount} selected
      </span>

      {/* Right-side actions */}
      <div className="ml-auto flex-shrink-0 flex items-center gap-1.5">
        {/* Select All / None */}
        <button
          onClick={onToggleSelectAll}
          className="px-2 py-1 text-[11px] font-semibold text-gray-600
                     bg-gray-100 hover:bg-gray-200
                     active:scale-95 rounded-lg transition-all duration-150 whitespace-nowrap"
        >
          {isAllSelected && selectedCount > 0 ? 'None' : 'All'}
        </button>

        {/* Custom actions */}
        {actions}
      </div>
    </div>
  );
}

/**
 * Delete button for multi-select toolbar
 */
export function MultiSelectDeleteButton({
  onClick,
  disabled,
  label = 'Delete',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 text-[11px] font-bold
                 flex items-center gap-1 rounded-lg
                 transition-all duration-150 active:scale-95
                 disabled:opacity-40 disabled:cursor-not-allowed
                 text-red-600 bg-red-50 hover:bg-red-100 border border-red-100/80"
    >
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      {label}
    </button>
  );
}

export default MultiSelectToolbar;
