/**
 * Empty state view when no AutoResearch runs exist.
 * Moved verbatim out of src/pages/AutoResearch.tsx (AG-27); state and handlers stay in the page.
 */

import { t } from '@/i18n';

export interface AutoResearchEmptyStateProps {
  handleShowSetup: () => Promise<void>;
}

export function AutoResearchEmptyState({ handleShowSetup }: AutoResearchEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 rounded-2xl bg-neutral-100 p-4 text-neutral-500">
        <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-800">AutoResearch</h2>
      <p className="mt-2 max-w-md text-sm text-gray-500">{t('autoresearch.emptyIdle')}</p>
      <button
        onClick={() => { void handleShowSetup(); }}
        className="mt-5 rounded-2xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800"
      >
        {t('autoresearch.setupAndStart')}
      </button>
    </div>
  );
}
