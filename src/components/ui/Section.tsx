/**
 * Section - Collapsible section container component
 *
 * Used in AgentPanel and other places for organizing grouped content.
 */

import React, { useState } from 'react';

interface SectionProps {
  title: string;
  subtitle?: string;
  count?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

export function Section({ title, subtitle, count, defaultExpanded = true, children }: SectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mx-3 mb-2 bg-white rounded-xl border border-gray-200/60 shadow-sm overflow-hidden transition-all duration-300">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-gray-800 uppercase tracking-tight">{title}</h3>
          {subtitle && <span className="text-[10px] text-gray-400 font-medium">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-3">
          {count && <span className="text-[10px] text-gray-500 font-bold bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 text-gray-400 transition-transform duration-300 ${expanded ? '' : '-rotate-90'}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-300">
          {children}
        </div>
      )}
    </div>
  );
}
