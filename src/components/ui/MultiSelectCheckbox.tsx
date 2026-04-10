/**
 * MultiSelectCheckbox - Reusable multi-select checkbox component
 *
 * Vercel-style checkbox for multi-select lists
 */

import React from 'react';

interface MultiSelectCheckboxProps {
  checked: boolean;
  onChange: (e: React.MouseEvent) => void;
  className?: string;
}

export function MultiSelectCheckbox({
  checked,
  onChange,
  className = '',
}: MultiSelectCheckboxProps) {
  return (
    <div
      className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 cursor-pointer ${checked
          ? 'bg-blue-600 border-blue-600 shadow-md shadow-blue-500/20'
          : 'border-gray-300 hover:border-blue-400 hover:shadow-sm'
        } ${className}`}
      onClick={onChange}
    >
      {checked && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5 text-white"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </div>
  );
}

export default MultiSelectCheckbox;
