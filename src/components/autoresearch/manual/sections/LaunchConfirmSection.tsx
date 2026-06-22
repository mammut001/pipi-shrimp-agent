import React from 'react';
import { t, getCurrentLocale } from '@/i18n';
import type { SshConfig } from '@/store/autoresearchStore';
import { AutoResearchSummaryItem } from '../../AutoResearchSetupHelpers';
import { formatRuntimeTargetSummary, formatMetricIterationsSummary } from '../manualFormatting';

interface LaunchConfirmSectionProps {
  setupForm: SshConfig;
  experimentDir: string;
  metric: string;
  direction: 'lower' | 'higher';
  baselineInput: string;
  maxIter: number;
  providerReady: boolean;
  connectionTestStatus: 'idle' | 'testing' | 'success' | 'error';
}

export function LaunchConfirmSection({
  setupForm,
  experimentDir,
  metric,
  direction,
  baselineInput,
  maxIter,
  providerReady,
  connectionTestStatus,
}: LaunchConfirmSectionProps) {
  const locale = getCurrentLocale();
  return (
    <div className="space-y-3 font-sans">
      <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/70 p-3 font-sans">
        <h5 className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">{t('autoresearch.summaryTitle') || '摘要'}</h5>
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 text-xs font-sans">
          <AutoResearchSummaryItem
            label="运行目标"
            value={formatRuntimeTargetSummary(setupForm, locale)}
          />
          <AutoResearchSummaryItem
            label="工作区目录"
            value={setupForm.remoteWorkDir || '—'}
          />
          <AutoResearchSummaryItem
            label="目标项目"
            value={experimentDir || '—'}
          />
          <AutoResearchSummaryItem
            label="主要指标"
            value={formatMetricIterationsSummary({ metric, direction, baselineInput, maxIter }, locale)}
          />
          <AutoResearchSummaryItem
            label="模型 API"
            value={providerReady ? '已配置 (Ready)' : '未配置 (Missing)'}
          />
          <AutoResearchSummaryItem
            label="环境测试"
            value={
              connectionTestStatus === 'success'
                ? '已测试通过'
                : connectionTestStatus === 'error'
                ? '测试失败'
                : '未通过测试'
            }
          />
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500 font-sans">
        <svg className="h-4 w-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        <span>查看配置总览确认无误后即可启动</span>
      </div>
    </div>
  );
}
