import React from 'react';
import { t } from '@/i18n';
import type { Recipe } from '../../bootstrapRecipePrompt';

interface BaselineMetricSectionProps {
  recipe: Recipe;
  onChange: (val: Partial<Recipe['baselineAndMetric']>) => void;
}

export function BaselineMetricSection({ recipe, onChange }: BaselineMetricSectionProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 font-sans">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-700 font-sans">
          {t('autoresearch.recipe.metricName') || 'Primary Metric Name'}
        </label>
        <input
          type="text"
          value={recipe.baselineAndMetric.primaryMetric}
          onChange={(e) => onChange({ primaryMetric: e.target.value })}
          placeholder={t('autoresearch.recipe.metricPlaceholder') || 'e.g. accuracy, loss, f1'}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-700 font-sans">
          {t('autoresearch.recipe.direction') || 'Optimization Direction'}
        </label>
        <select
          value={recipe.baselineAndMetric.direction}
          onChange={(e) => onChange({ direction: e.target.value as any })}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
        >
          <option value="higher">{t('autoresearch.recipe.direction.higher') || 'Higher is Better (e.g. Accuracy)'}</option>
          <option value="lower">{t('autoresearch.recipe.direction.lower') || 'Lower is Better (e.g. Loss/Latency)'}</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-700 font-sans">
          {t('autoresearch.recipe.baselineValue') || 'Baseline Value (Optional)'}
        </label>
        <input
          type="text"
          value={recipe.baselineAndMetric.baselineValue || ''}
          onChange={(e) => onChange({ baselineValue: e.target.value })}
          placeholder={t('autoresearch.recipe.baselinePlaceholder') || 'e.g. 0.85'}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-700 font-sans">
          {t('autoresearch.recipe.successCriteria') || 'Success Criteria (Optional)'}
        </label>
        <input
          type="text"
          value={recipe.baselineAndMetric.successCriteria || ''}
          onChange={(e) => onChange({ successCriteria: e.target.value })}
          placeholder={t('autoresearch.recipe.successPlaceholder') || 'e.g. Beating paper baseline of 0.88'}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </div>
    </div>
  );
}
