/**
 * Setup form input fields for configuring an AutoResearch run.
 * Moved verbatim out of src/pages/AutoResearch.tsx (AG-27); state and handlers stay in the page.
 */

import type { Dispatch, SetStateAction } from 'react';
import { t } from '@/i18n';
import {
  AutoResearchInlineHint,
  AutoResearchPathSummary,
} from '@/components/autoresearch/AutoResearchSetupHelpers';
import type { SshConfig } from '@/store/autoresearchStore';
import { buildAutoResearchDefaultConfig } from '@/services/autoresearch/defaultConfig';
import { sanitizePathInput } from '@/services/autoresearch/pathInput';

export interface AutoResearchSetupFieldsProps {
  setupForm: SshConfig;
  setSetupForm: Dispatch<SetStateAction<SshConfig>>;
  handlePickLocalWorkDir: () => Promise<void>;
  experimentDir: string;
  setExperimentDir: Dispatch<SetStateAction<string>>;
  handlePickExperimentDir: () => Promise<void>;
  metric: string;
  setMetric: Dispatch<SetStateAction<string>>;
  direction: 'lower' | 'higher';
  setDirection: Dispatch<SetStateAction<'lower' | 'higher'>>;
  baselineInput: string;
  setBaselineInput: Dispatch<SetStateAction<string>>;
  baselineInvalid: boolean;
  maxIter: number;
  setMaxIter: Dispatch<SetStateAction<number>>;
}

export function AutoResearchSetupFields({
  setupForm,
  setSetupForm,
  handlePickLocalWorkDir,
  experimentDir,
  setExperimentDir,
  handlePickExperimentDir,
  metric,
  setMetric,
  direction,
  setDirection,
  baselineInput,
  setBaselineInput,
  baselineInvalid,
  maxIter,
  setMaxIter,
}: AutoResearchSetupFieldsProps) {
  return (
    <>
      {/* Mode toggle */}
      <div className="flex gap-1 rounded-2xl bg-gray-100/80 p-1">
        <button
          type="button"
          onClick={() => setSetupForm(f => ({ ...f, mode: 'ssh' }))}
          className={`flex-1 rounded-xl py-1.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${setupForm.mode === 'ssh' ? 'bg-white text-neutral-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >{t('autoresearch.modeRemote')}</button>
        <button
          type="button"
          onClick={() => setSetupForm(f => ({ ...f, mode: 'local' }))}
          className={`flex-1 rounded-xl py-1.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:text-gray-400 ${setupForm.mode === 'local' ? 'bg-white text-neutral-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >{t('autoresearch.modeLocal')}</button>
      </div>

      {setupForm.mode === 'ssh' && (
        <>
          <input
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            placeholder={t('autoresearch.hostPlaceholder')}
            value={setupForm.host}
            onChange={e => setSetupForm(f => ({ ...f, host: e.target.value }))}
          />
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              placeholder={t('autoresearch.userPlaceholder')}
              value={setupForm.user}
              onChange={e => setSetupForm(f => ({ ...f, user: e.target.value }))}
            />
            <input
              className="w-20 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              placeholder={t('autoresearch.portPlaceholder')}
              type="number"
              value={setupForm.port}
              onChange={e => setSetupForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
            />
          </div>
          <select
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            value={setupForm.authMode}
            onChange={e => setSetupForm(f => ({ ...f, authMode: e.target.value as SshConfig['authMode'] }))}
          >
            <option value="agent">{t('autoresearch.authAgent')}</option>
            <option value="password">{t('autoresearch.authPassword')}</option>
            <option value="key">{t('autoresearch.authKey')}</option>
          </select>
          {setupForm.authMode === 'password' && (
            <input
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              placeholder={t('autoresearch.passwordPlaceholder')}
              type="password"
              autoComplete="off"
              value={setupForm.password}
              onChange={e => setSetupForm(f => ({ ...f, password: e.target.value }))}
            />
          )}
          {setupForm.authMode === 'key' && (
            <input
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              placeholder={t('autoresearch.sshKeyPathPlaceholder')}
              value={setupForm.keyPath}
              onChange={e => setSetupForm(f => ({ ...f, keyPath: e.target.value }))}
            />
          )}
        </>
      )}
      {setupForm.mode === 'local' ? (
        <>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              placeholder={t('autoresearch.localWorkDirPlaceholder')}
              value={setupForm.remoteWorkDir}
              onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: sanitizePathInput(e.target.value) }))}
            />
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              onClick={handlePickLocalWorkDir}
            >
              {t('autoresearch.chooseDirectory')}
            </button>
          </div>
          <AutoResearchPathSummary label={t('autoresearch.summaryWorkdir')} path={setupForm.remoteWorkDir} />
          <AutoResearchInlineHint>{t('autoresearch.workdirHelper')}</AutoResearchInlineHint>
        </>
      ) : (
        <>
          <input
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            placeholder={t('autoresearch.remoteWorkDirPlaceholder')}
            value={setupForm.remoteWorkDir}
            onChange={e => setSetupForm(f => ({ ...f, remoteWorkDir: sanitizePathInput(e.target.value) }))}
          />
          <AutoResearchPathSummary label={t('autoresearch.summaryWorkdir')} path={setupForm.remoteWorkDir} />
          <AutoResearchInlineHint>{t('autoresearch.workdirHelper')}</AutoResearchInlineHint>
        </>
      )}

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
          placeholder={t('autoresearch.experimentDirPlaceholder')}
          value={experimentDir}
          onChange={e => setExperimentDir(sanitizePathInput(e.target.value))}
        />
        <button
          type="button"
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
          onClick={handlePickExperimentDir}
          aria-label={t('autoresearch.chooseDirectory')}
        >
          {t('autoresearch.chooseDirectory')}
        </button>
      </div>
      <AutoResearchPathSummary label={t('autoresearch.summaryExperimentDir')} path={experimentDir} />
      <AutoResearchInlineHint>{t('autoresearch.experimentDirHelper')}</AutoResearchInlineHint>

      <hr className="border-gray-200" />

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
          placeholder={t('autoresearch.metricNamePlaceholder')}
          value={metric}
          onChange={e => setMetric(e.target.value)}
        />
        <select
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
          value={direction}
          onChange={e => setDirection(e.target.value as 'lower' | 'higher')}
        >
          <option value="lower">{t('autoresearch.lowerIsBetter')}</option>
          <option value="higher">{t('autoresearch.higherIsBetter')}</option>
        </select>
      </div>
      <AutoResearchInlineHint>{t('autoresearch.metricHelper')}</AutoResearchInlineHint>
      <input
        className={`w-full rounded-xl border bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 ${baselineInvalid ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-neutral-400'}`}
        placeholder={t('autoresearch.baselinePlaceholder')}
        value={baselineInput}
        onChange={e => setBaselineInput(e.target.value)}
      />
      {baselineInvalid && (
        <div className="text-xs text-rose-500">{t('autoresearch.validationBaselineNumber')}</div>
      )}
      <AutoResearchInlineHint>{t('autoresearch.baselineHelper')}</AutoResearchInlineHint>
      <input
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-neutral-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        placeholder={t('autoresearch.maxIterationsPlaceholder')}
        type="number"
        value={maxIter}
        onChange={e => setMaxIter(buildAutoResearchDefaultConfig({ iterations: parseInt(e.target.value, 10) || 50 }).iterations)}
      />
    </>
  );
}
