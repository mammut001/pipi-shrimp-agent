import React from 'react';
import { t } from '@/i18n';
import type { SshConfig } from '@/store/autoresearchStore';

interface AdvancedFieldsSectionProps {
  setupForm: SshConfig;
  experimentDir: string;
  prefillSource: string;
  windowsShellProfile?: string;
  handleResetToDefaults: () => void;
}

export function AdvancedFieldsSection({
  setupForm,
  experimentDir,
  prefillSource,
  windowsShellProfile,
  handleResetToDefaults,
}: AdvancedFieldsSectionProps) {
  return (
    <details className="group rounded-2xl border border-gray-200 bg-white p-3 font-sans">
      <summary className="cursor-pointer text-xs font-semibold text-gray-700 flex items-center justify-between select-none">
        <div className="flex flex-col gap-0.5">
          <span>⚙️ {t('autoresearch.manual.advancedFields') || '高级字段'}</span>
          <span className="text-[10px] font-normal text-gray-400">
            {t('autoresearch.manual.advancedFieldsHelper')}
          </span>
        </div>
        <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
      </summary>
      <div className="mt-3 space-y-3 pt-3 border-t border-gray-100 text-xs font-sans">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 font-mono text-[11px]">
          <div>
            <span className="text-gray-400 font-sans">remoteWorkDir:</span> {setupForm.remoteWorkDir || '—'}
          </div>
          <div>
            <span className="text-gray-400 font-sans">experimentDir:</span> {experimentDir || '—'}
          </div>
          <div>
            <span className="text-gray-400 font-sans">Prefill Source:</span> {prefillSource}
          </div>
          {windowsShellProfile && (
            <div>
              <span className="text-gray-400 font-sans">Windows Shell Profile:</span> {windowsShellProfile}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 font-sans"
            onClick={handleResetToDefaults}
          >
            {t('autoresearch.resetToDefaults')}
          </button>
        </div>
      </div>
    </details>
  );
}
