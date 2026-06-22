import React from 'react';
import { t } from '@/i18n';
import type { SshConfig } from '@/store/autoresearchStore';
import { AutoResearchPathSummary } from '../../AutoResearchSetupHelpers';
import { sanitizePathInput } from '@/services/autoresearch/pathInput';

interface WorkspaceTargetSectionProps {
  setupForm: SshConfig;
  setSetupForm: React.Dispatch<React.SetStateAction<SshConfig>>;
  experimentDir: string;
  setExperimentDir: (val: string) => void;
  handlePickLocalWorkDir: () => void | Promise<void>;
  handlePickExperimentDir: () => void | Promise<void>;
}

export function WorkspaceTargetSection({
  setupForm,
  setSetupForm,
  experimentDir,
  setExperimentDir,
  handlePickLocalWorkDir,
  handlePickExperimentDir,
}: WorkspaceTargetSectionProps) {
  return (
    <div className="space-y-4 font-sans">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-700">{t('autoresearch.manual.workspace')}</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
            placeholder={setupForm.mode === 'local' ? t('autoresearch.localWorkDirPlaceholder') : t('autoresearch.remoteWorkDirPlaceholder')}
            value={setupForm.remoteWorkDir}
            onChange={(event) => setSetupForm((current) => ({ ...current, remoteWorkDir: sanitizePathInput(event.target.value) }))}
          />
          {setupForm.mode === 'local' && (
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 font-sans"
              onClick={handlePickLocalWorkDir}
            >
              {t('autoresearch.chooseDirectory')}
            </button>
          )}
        </div>
        <AutoResearchPathSummary label={t('autoresearch.summaryWorkdir')} path={setupForm.remoteWorkDir} />
        <p className="text-[11px] text-gray-500 font-sans">{t('autoresearch.manual.workspaceHelper')}</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-700">{t('autoresearch.manual.targetProject')}</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
            placeholder={t('autoresearch.experimentDirPlaceholder')}
            value={experimentDir}
            onChange={(event) => setExperimentDir(sanitizePathInput(event.target.value))}
          />
          {setupForm.mode === 'local' && (
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 font-sans"
              onClick={handlePickExperimentDir}
              aria-label={t('autoresearch.chooseDirectory')}
            >
              {t('autoresearch.chooseDirectory')}
            </button>
          )}
        </div>
        <AutoResearchPathSummary label={t('autoresearch.summaryExperimentDir')} path={experimentDir} />
        <p className="text-[11px] text-gray-500 font-sans">{t('autoresearch.manual.targetProjectHelper')}</p>
      </div>
    </div>
  );
}
