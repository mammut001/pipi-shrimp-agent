import type { ReactNode } from 'react';

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
    <div className={`flex min-h-full w-full flex-col bg-[#f6f1e8] shadow-[0_32px_120px_rgba(15,23,42,0.3)] ${className}`}>
      <div className="sticky top-0 z-10 border-b border-[#e7ded1] bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(246,241,232,0.98))] px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {onBack && (
              <button
                onClick={onBack}
                className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f665c] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)] transition-colors hover:text-[#2f251a]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {backLabel}
              </button>
            )}

            {(badge || filename) && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {badge && (
                  <span className="rounded-full bg-[#dceeea] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0f766e]">
                    {badge}
                  </span>
                )}
                {filename && (
                  <span className="text-[11px] text-[#8a7f72]" title={filename}>
                    {filename}
                  </span>
                )}
              </div>
            )}
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-[#2f251a] sm:text-3xl">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#655a4f]">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 self-start">
            {headerActions}
            {onOpen && (
              <button
                onClick={onOpen}
                className="rounded-xl border border-[#e7ded1] bg-white/90 px-3 py-2 text-[12px] font-medium text-[#6f665c] transition-colors hover:border-[#d8cfc1] hover:text-[#2f251a]"
                title={openLabel}
              >
                {openLabel}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="rounded-xl border border-[#e7ded1] bg-white/90 p-2 text-[#6f665c] transition-colors hover:border-[#d8cfc1] hover:text-[#2f251a]"
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
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