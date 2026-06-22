import React from 'react';
import { t } from '@/i18n';

interface ManualSectionCardProps {
  id: string;
  number: number;
  emoji: string;
  title: string;
  status: 'completed' | 'missing' | 'testing' | 'failed' | 'notTested';
  statusLabel: string;
  activeSection: string | null;
  setActiveSection: (section: string | null) => void;
  children: React.ReactNode;
  collapsedSummary: React.ReactNode;
}

export function ManualSectionCard({
  id,
  number,
  emoji,
  title,
  status,
  statusLabel,
  activeSection,
  setActiveSection,
  children,
  collapsedSummary,
}: ManualSectionCardProps) {
  const isActive = activeSection === id;
  const isCompleted = status === 'completed';
  const isMissing = status === 'missing' || status === 'failed';

  const getBorderClass = () => {
    if (isActive) {
      return 'border-neutral-300 ring-2 ring-neutral-100';
    }
    if (isMissing) {
      return 'border-amber-300 bg-amber-50/10';
    }
    return 'border-neutral-200 bg-white';
  };

  const getBadgeClass = () => {
    if (isCompleted) {
      return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
    }
    if (status === 'testing') {
      return 'bg-blue-50 text-blue-700 border border-blue-100';
    }
    return 'bg-amber-50 text-amber-700 border border-amber-100';
  };

  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden transition-all duration-200 ${getBorderClass()}`}>
      <div className="flex items-center justify-between p-4 bg-gray-50/50 border-b border-gray-100 font-sans">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-400 bg-gray-200/50 rounded-md w-5 h-5 flex items-center justify-center">
            {number}
          </span>
          <span className="text-base">{emoji}</span>
          <div>
            <h4 className="text-sm font-semibold text-gray-900 font-sans">{title}</h4>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${getBadgeClass()}`}>
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => setActiveSection(isActive ? null : id)}
            className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-1 rounded bg-white border border-gray-200 font-sans"
          >
            {isActive ? (t('autoresearch.recipe.collapse') || '收起') : (t('autoresearch.recipe.edit') || '编辑')}
          </button>
        </div>
      </div>

      {isActive && (
        <div className="p-4 space-y-4 animate-fadeIn">
          {children}
        </div>
      )}

      {!isActive && (
        <div className="px-4 py-2.5 text-xs text-gray-600 bg-white font-sans flex items-center justify-between">
          <div className="truncate flex-1 min-w-0 pr-4">
            {collapsedSummary}
          </div>
        </div>
      )}
    </div>
  );
}
