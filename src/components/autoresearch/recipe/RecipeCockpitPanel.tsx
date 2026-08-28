import React from 'react';
import { t } from '@/i18n';
import type { Recipe } from '../bootstrapRecipePrompt';
import type { RecipeReadiness } from './recipeReadiness';
import { getRecipeNextAction } from './recipeReadiness';

interface RecipeCockpitPanelProps {
  recipe: Recipe;
  readiness: RecipeReadiness;
  activeSection: string | null;
  setActiveSection: (section: string | null) => void;
  disabled?: boolean;
  onShowPromptPreview: () => void;
  onSubmit: () => void;
}

export function RecipeCockpitPanel({
  recipe,
  readiness,
  activeSection,
  setActiveSection,
  disabled = false,
  onShowPromptPreview,
  onSubmit,
}: RecipeCockpitPanelProps) {
  const isFormValid = readiness.isFormValid;
  const requiredCount = readiness.requiredCount;
  const totalCount = readiness.totalCount;

  const getSectionStatus = (section: string) =>
    readiness.sectionStatus[section as keyof typeof readiness.sectionStatus] || 'completed';

  const missingFields: string[] = readiness.missingKeys.map((key) => {
    switch (key) {
      case 'missingGoal':
        return t('autoresearch.recipe.missingGoal') || '缺少研究目标';
      case 'confirmResearchGoal':
        return t('autoresearch.recipe.confirmResearchGoal') || '请确认研究目标';
      case 'missingMetric':
        return t('autoresearch.recipe.missingMetric') || '缺少主指标';
      case 'missingWorkspace':
        return t('autoresearch.recipe.missingWorkspace') || '缺少工作区';
      default:
        return '';
    }
  });

  const nextAction = getRecipeNextAction(readiness);
  const firstMissingAction = nextAction.labelKey
    ? {
        label: t(nextAction.labelKey as any) || '',
        section: nextAction.section || '',
      }
    : null;

  const getStartButtonText = () => {
    if (!isFormValid && nextAction.labelKey) {
      return t(nextAction.labelKey as any) || '';
    }
    return t('autoresearch.recipe.startScaffolding') || '开始生成脚手架';
  };

  return (
    <div className="sticky top-4 w-full shrink-0 space-y-5 rounded-2xl border border-gray-200 bg-white p-4 font-sans shadow-sm lg:w-[280px]">
      <div className="space-y-2.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
          {t('autoresearch.bootstrap.progressTitle') || '启动进度'}
        </p>
        <div className="space-y-2">
          {[
            { key: 'goal', label: t('autoresearch.recipe.researchGoal') || '研究目标', status: getSectionStatus('goal') },
            { key: 'references', label: t('autoresearch.recipe.references') || '参考资料', status: getSectionStatus('references') },
            { key: 'baseline', label: t('autoresearch.recipe.baselineAndMetric') || '基线与指标', status: getSectionStatus('baseline') },
            { key: 'workspace', label: t('autoresearch.recipe.workspace') || '工作区', status: getSectionStatus('workspace') },
            { key: 'verification', label: t('autoresearch.recipe.verification') || '验证命令', status: getSectionStatus('verification') },
            { key: 'ready', label: t('autoresearch.recipe.ready') || '就绪', status: isFormValid ? 'completed' : 'missing' },
          ].map((item, index) => {
            const isOk = item.status === 'completed' || item.status === 'optional';
            const isWarn = item.status === 'placeholder';
            const isActive = activeSection === item.key;
            const isButton = item.key !== 'ready';
            const stepContent = (
              <>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  isOk
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : isWarn
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}>
                  {index + 1}
                </span>
                <span className={isOk ? 'font-medium text-slate-700' : 'text-slate-400'}>{item.label}</span>
                <span className={`ml-auto text-[10px] ${isOk ? 'text-emerald-600' : isWarn ? 'text-blue-600' : 'text-amber-600'}`}>
                  {isOk ? '✓' : '⋯'}
                </span>
              </>
            );

            if (isButton) {
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(activeSection === item.key ? null : item.key)}
                  aria-label={`Configure ${item.label}`}
                  className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-left text-xs transition-all ${
                    isActive
                      ? 'border-slate-200 bg-slate-50 shadow-sm ring-1 ring-slate-100'
                      : 'border-transparent bg-transparent hover:border-slate-100 hover:bg-slate-50/50'
                  }`}
                >
                  {stepContent}
                </button>
              );
            }

            return (
              <div key={item.key} className="flex w-full items-center gap-2 border border-transparent p-1.5 text-xs">
                {stepContent}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5 rounded-xl border border-slate-200/50 bg-slate-50 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {t('autoresearch.recipe.title') || '配置研究配方'}
        </p>
        <div className="space-y-1.5 text-xs text-slate-700">
          <div className="flex justify-between">
            <span className="text-slate-400">{t('autoresearch.recipe.requiredProgress') || '必填项'}:</span>
            <span className="font-semibold">{requiredCount} / 3</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{t('autoresearch.recipe.recipeProgress') || '配方项'}:</span>
            <span className="font-semibold">{totalCount} / 6</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{t('autoresearch.recipe.targetMetric') || '目标指标'}:</span>
            <span className="max-w-[120px] truncate font-semibold" title={recipe.baselineAndMetric.primaryMetric}>
              {recipe.baselineAndMetric.primaryMetric || '--'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{t('autoresearch.recipe.workspaceRoot') || '工作区目录'}:</span>
            <span className="max-w-[120px] truncate font-semibold" title={recipe.workspace.workDir}>
              {recipe.workspace.workDir ? recipe.workspace.workDir.split(/[\\/]/).pop() : '--'}
            </span>
          </div>
        </div>

        {missingFields.length > 0 && (
          <div className="space-y-1 border-t border-slate-200/60 pt-2">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-700">
              {t('autoresearch.recipe.todoItems') || '待完成项'}:
            </span>
            <div className="space-y-0.5">
              {missingFields.filter(Boolean).map((field, index) => (
                <span key={`${field}-${index}`} className="block text-[10px] text-amber-700">⚠️ {field}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-gray-100 pt-2">
        {!disabled && firstMissingAction && (
          <button
            type="button"
            onClick={() => setActiveSection(firstMissingAction.section)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200/50 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition-all hover:bg-amber-100/80"
          >
            <span>⚠️</span> {firstMissingAction.label}
          </button>
        )}

        <button
          type="button"
          onClick={onShowPromptPreview}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
        >
          <span>🔍</span> {t('autoresearch.recipe.previewPrompt') || '预览启动 Prompt'}
        </button>

        <button
          type="button"
          disabled={disabled || !isFormValid}
          onClick={onSubmit}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold shadow-md transition-all ${
            disabled || !isFormValid
              ? 'cursor-not-allowed border border-slate-200/50 bg-slate-100 text-slate-400'
              : 'bg-slate-900 text-white hover:-translate-y-0.5 hover:bg-slate-800 active:translate-y-0'
          }`}
        >
          <span>🚀</span> {getStartButtonText()}
        </button>
      </div>

      <div className="space-y-1 border-t border-gray-100 pt-3 text-[10px] text-gray-500">
        <p className="font-bold uppercase tracking-wider text-gray-400">
          {t('autoresearch.recipe.agentProfileTitle') || 'Bootstrap Agent Profile'}
        </p>
        <p className="leading-relaxed">
          {t('autoresearch.recipe.agentProfileDesc') || 'Runs in headless session with restricted tool set.'}
        </p>
      </div>
    </div>
  );
}
