import React from 'react';
import { t } from '@/i18n';

interface PromptPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  compiledPrompt: string;
  copySuccess: boolean;
  onCopyPrompt: () => void;
}

export function PromptPreviewDialog({
  isOpen,
  onClose,
  compiledPrompt,
  copySuccess,
  onCopyPrompt,
}: PromptPreviewDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl p-6 m-4 animate-scaleUp">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5 font-sans">
            <span>🔍</span> {t('autoresearch.recipe.previewPrompt') || '预览启动 Prompt'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 border border-gray-100 rounded-xl p-4 font-mono text-[11px] text-gray-800 whitespace-pre-wrap select-all">
          {compiledPrompt}
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100 mt-4 font-sans">
          <button
            type="button"
            onClick={onCopyPrompt}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all active:scale-[0.98]"
          >
            {copySuccess ? (t('autoresearch.recipe.copied') || 'Copied! ✓') : (t('autoresearch.recipe.copyPrompt') || 'Copy Prompt')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition-all active:scale-[0.98]"
          >
            {t('autoresearch.recipe.close') || 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
