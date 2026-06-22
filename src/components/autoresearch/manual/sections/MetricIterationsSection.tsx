import React from 'react';
import { t } from '@/i18n';
import { buildAutoResearchDefaultConfig } from '@/services/autoresearch/defaultConfig';

interface MetricIterationsSectionProps {
  metric: string;
  setMetric: (val: string) => void;
  direction: 'lower' | 'higher';
  setDirection: (val: 'lower' | 'higher') => void;
  baselineInput: string;
  setBaselineInput: (val: string) => void;
  baselineInvalid: boolean;
  maxIter: number;
  setMaxIter: (val: number) => void;
}

export function MetricIterationsSection({
  metric,
  setMetric,
  direction,
  setDirection,
  baselineInput,
  setBaselineInput,
  baselineInvalid,
  maxIter,
  setMaxIter,
}: MetricIterationsSectionProps) {
  return (
    <div className="space-y-4 font-sans">
      <div className="space-y-1.5 font-sans">
        <label className="text-xs font-semibold text-gray-700">主要指标名称 (Primary Metric)</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
            placeholder={t('autoresearch.metricNamePlaceholder')}
            value={metric}
            onChange={(event) => setMetric(event.target.value)}
          />
          <select
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
            value={direction}
            onChange={(event) => setDirection(event.target.value as 'lower' | 'higher')}
          >
            <option value="lower">目标越小越好</option>
            <option value="higher">目标越大越好</option>
          </select>
        </div>
        <p className="text-[11px] text-gray-500 font-sans">{t('autoresearch.metricHelper')}</p>
      </div>

      <div className="space-y-1.5 font-sans">
        <label className="text-xs font-semibold text-gray-700">当前基线 (Baseline - 可选)</label>
        <input
          className={`w-full rounded-xl border bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:outline-none ${baselineInvalid ? 'border-rose-300 focus:border-rose-400' : 'border-gray-200 focus:border-neutral-400'}`}
          placeholder={t('autoresearch.baselinePlaceholder')}
          value={baselineInput}
          onChange={(event) => setBaselineInput(event.target.value)}
        />
        {baselineInvalid && (
          <div className="text-[11px] text-rose-500 font-sans">{t('autoresearch.validationBaselineNumber')}</div>
        )}
        <p className="text-[11px] text-gray-500 font-sans">{t('autoresearch.baselineHelper')}</p>
      </div>

      <div className="space-y-1.5 font-sans">
        <label className="text-xs font-semibold text-gray-700">最大迭代轮数 (Max Iterations)</label>
        <input
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
          placeholder={t('autoresearch.maxIterationsPlaceholder')}
          type="number"
          value={maxIter}
          onChange={(event) => setMaxIter(buildAutoResearchDefaultConfig({ iterations: Number.parseInt(event.target.value, 10) || 50 }).iterations)}
        />
      </div>
    </div>
  );
}
