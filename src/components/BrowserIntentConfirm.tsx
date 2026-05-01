import { t } from '@/i18n';

interface BrowserIntentConfirmProps {
  message: string;
  isProcessing?: boolean;
  onConfirmBrowser: () => void;
  onSendNormally: () => void;
  onCancel: () => void;
}

export function BrowserIntentConfirm({
  message,
  isProcessing = false,
  onConfirmBrowser,
  onSendNormally,
  onCancel,
}: BrowserIntentConfirmProps) {
  return (
    <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 shadow-sm" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-950">
            {t('browserIntent.confirmTitle')}
          </p>
          <p className="mt-1 text-xs text-amber-800 break-words">
            {message}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onConfirmBrowser}
              disabled={isProcessing}
              className="rounded-full bg-amber-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('browserIntent.useBrowser')}
            </button>
            <button
              type="button"
              onClick={onSendNormally}
              disabled={isProcessing}
              className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('browserIntent.sendNormally')}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BrowserIntentConfirm;