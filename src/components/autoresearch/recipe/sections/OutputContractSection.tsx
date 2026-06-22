import React from 'react';
import { t } from '@/i18n';
import type { Recipe } from '../../bootstrapRecipePrompt';

interface OutputContractSectionProps {
  outputContract: Recipe['outputContract'];
  onChange: (field: keyof Recipe['outputContract'], checked: boolean) => void;
}

export function OutputContractSection({ outputContract, onChange }: OutputContractSectionProps) {
  return (
    <div className="space-y-3 font-sans text-xs text-gray-700">
      <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
        <input
          type="checkbox"
          checked={outputContract.includeMetrics}
          onChange={(e) => onChange('includeMetrics', e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
        />
        {t('autoresearch.recipe.output.metrics') || 'Include Evaluation Metrics'}
      </label>

      <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
        <input
          type="checkbox"
          checked={outputContract.includeArtifacts}
          onChange={(e) => onChange('includeArtifacts', e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
        />
        {t('autoresearch.recipe.output.artifacts') || 'Include Created/Modified Artifacts'}
      </label>

      <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
        <input
          type="checkbox"
          checked={outputContract.includeCommandsRun}
          onChange={(e) => onChange('includeCommandsRun', e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
        />
        {t('autoresearch.recipe.output.commands') || 'Include Command Execution Log'}
      </label>

      <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
        <input
          type="checkbox"
          checked={outputContract.includeFailureReason}
          onChange={(e) => onChange('includeFailureReason', e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
        />
        {t('autoresearch.recipe.output.failure') || 'Include Detailed Failure Diagnostics'}
      </label>

      <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
        <input
          type="checkbox"
          checked={outputContract.includeRemainingRisks}
          onChange={(e) => onChange('includeRemainingRisks', e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
        />
        {t('autoresearch.recipe.output.risks') || 'Include Remaining Risks / Future Directives'}
      </label>
    </div>
  );
}
