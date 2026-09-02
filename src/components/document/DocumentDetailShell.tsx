import type { ReactNode } from 'react';
import { MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS } from '@/layout/edgeToggleGutter';

interface DocumentDetailShellProps {
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  filename?: string | null;
  onBack?: () => void;
  backLabel?: string;
  onOpen?: () => void;
  openLabel?: string;
  onClose?: () => void;
  sidebar?: ReactNode;
  children: ReactNode;
  className?: string;
  headerActions?: ReactNode;
}

export function DocumentDetailShell({
  title,
  subtitle,
  badge,
  filename,
  onBack,
  backLabel = 'Back',
  onOpen,
  openLabel = 'Open',
  onClose,
  sidebar,
  children,
  className = '',
  headerActions,
}: DocumentDetailShellProps) {
  return (
    <div className={`flex min-h-full w-full flex-col bg-[#f7f6f3] shadow-[0_32px_120px_rgba(15,23,42,0.12)] ${className}`}>
      {/* Document Header - Scrolls naturally with content to maximize viewport space */}
      <div className={`border-b border-slate-200/80 bg-white pl-4 sm:pl-5 ${MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS} py-3`}>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {backLabel}
                </button>
              )}

              {badge && (
                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                  {badge}
                </span>
              )}
              {filename && (
                <span className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]" title={filename}>
                  {filename}
                </span>
              )}
            </div>

            <h3 className="mt-1.5 text-base font-bold tracking-tight text-slate-900 truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 truncate max-w-3xl">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            {headerActions}
            {onOpen && (
              <button
                type="button"
                onClick={onOpen}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300"
                title={openLabel}
              >
                {openLabel}
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-800"
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid flex-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        {sidebar}
        <div className="px-4 py-5 sm:px-6 sm:py-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export default DocumentDetailShell;