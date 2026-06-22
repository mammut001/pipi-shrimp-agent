import React from 'react';
import { t } from '@/i18n';
import type { Recipe } from '../bootstrapRecipePrompt';
import type { RecipeReadiness } from './recipeReadiness';
import { getRecipeNextAction } from './recipeReadiness';
import type { SshConfig } from '@/store/autoresearchStore';
import { BlockComposer } from '@/components/chatInput/BlockComposer';
import type { ComposerBlock } from '@/components/chatInput/blocks/types';

interface RecipeCockpitPanelProps {
  recipe: Recipe;
  readiness: RecipeReadiness;
  activeSection: string | null;
  setActiveSection: (section: string | null) => void;
  disabled?: boolean;
  showAdvanced: boolean;
  setShowAdvanced: (val: boolean) => void;
  composerBlocks: ComposerBlock[];
  setComposerBlocks: (blocks: ComposerBlock[]) => void;
  sshConfig?: SshConfig;
  importedFiles: Array<{ id: string; name: string; path: string }>;
  onSend: (compiledPrompt: string) => void;
  onShowPromptPreview: () => void;
  onSubmit: () => void;
}

export function RecipeCockpitPanel({
  recipe,
  readiness,
  activeSection,
  setActiveSection,
  disabled = false,
  showAdvanced,
  setShowAdvanced,
  composerBlocks,
  setComposerBlocks,
  sshConfig,
  importedFiles,
  onSend,
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
    if (!isFormValid) {
      if (nextAction.labelKey) {
        return t(nextAction.labelKey as any) || '';
      }
    }
    return t('autoresearch.recipe.startScaffolding') || '开始生成脚手架';
  };

  return (
    <div className="sticky top-4 space-y-5 lg:w-[280px] w-full shrink-0 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm font-sans">
      {/* Launch progress checklist */}
      <div className="space-y-2.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 font-sans">
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
          ].map((item, idx) => {
            const isOk = item.status === 'completed' || item.status === 'optional';
            const isWarn = item.status === 'placeholder';
            const isActive = activeSection === item.key;
            const isButton = item.key !== 'ready';

            const stepContent = (
              <>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold text-[10px] ${
                  isOk
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : isWarn
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  {idx + 1}
                </span>
                <span className={isOk ? 'text-slate-700 font-medium font-sans' : 'text-slate-400 font-sans'}>
                  {item.label}
                </span>
                {isOk ? (
                  <span className="text-emerald-600 text-[10px] ml-auto">✓</span>
                ) : isWarn ? (
                  <span className="text-blue-600 text-[10px] ml-auto">⋯</span>
                ) : (
                  <span className="text-amber-600 text-[10px] ml-auto">⋯</span>
                )}
              </>
            );

            if (isButton) {
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(activeSection === item.key ? null : item.key)}
                  aria-label={`Configure ${item.label}`}
                  className={`w-full flex items-center gap-2 text-xs text-left p-1.5 rounded-lg border transition-all ${
                    isActive
                      ? 'bg-slate-50 border-slate-200 shadow-sm ring-1 ring-slate-100'
                      : 'bg-transparent border-transparent hover:bg-slate-50/50 hover:border-slate-100'
                  }`}
                >
                  {stepContent}
                </button>
              );
            }

            return (
              <div key={item.key} className="w-full flex items-center gap-2 text-xs p-1.5 border border-transparent">
                {stepContent}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recipe readiness summary */}
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/50 space-y-2.5">
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
            <span className="font-semibold truncate max-w-[120px]" title={recipe.baselineAndMetric.primaryMetric}>
              {recipe.baselineAndMetric.primaryMetric || '--'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{t('autoresearch.recipe.workspaceRoot') || '工作区目录'}:</span>
            <span className="font-semibold truncate max-w-[120px]" title={recipe.workspace.workDir}>
              {recipe.workspace.workDir ? recipe.workspace.workDir.split(/[\\/]/).pop() : '--'}
            </span>
          </div>
        </div>

        {/* Missing Requirements List */}
        {missingFields.length > 0 && (
          <div className="border-t border-slate-200/60 pt-2 space-y-1">
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">
              {t('autoresearch.recipe.todoItems') || '待完成项'}:
            </span>
            <div className="space-y-0.5">
              {missingFields.map((f, i) => (
                <span key={i} className="text-[10px] text-amber-700 block">⚠️ {f}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions panel */}
      <div className="space-y-2 pt-2 border-t border-gray-100">
        {/* Top missing required action button */}
        {!disabled && firstMissingAction && (
          <button
            type="button"
            onClick={() => setActiveSection(firstMissingAction.section)}
            className="w-full py-2 px-3 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100/80 border border-amber-200/50 rounded-xl transition-all flex items-center justify-center gap-1.5 animate-fadeIn"
          >
            <span>⚠️</span> {firstMissingAction.label}
          </button>
        )}

        {/* Preview start prompt button */}
        <button
          type="button"
          onClick={onShowPromptPreview}
          className="w-full py-2 px-3 text-xs font-semibold border border-slate-200 hover:border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-1.5"
        >
          <span>🔍</span> {t('autoresearch.recipe.previewPrompt') || '预览启动 Prompt'}
        </button>

        {/* Start button */}
        <button
          type="button"
          disabled={disabled || !isFormValid}
          onClick={onSubmit}
          className={`w-full py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 ${
            disabled || !isFormValid
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/50'
              : 'bg-slate-900 hover:bg-slate-800 text-white hover:-translate-y-0.5 active:translate-y-0'
          }`}
        >
          <span>🚀</span> {getStartButtonText()}
        </button>
      </div>

      {/* Bootstrap Agent Profile Info (Read-only) */}
      <div className="border-t border-gray-100 pt-3 text-[10px] text-gray-500 space-y-1">
        <p className="font-bold text-gray-400 uppercase tracking-wider">
          {t('autoresearch.recipe.agentProfileTitle') || 'Bootstrap Agent Profile'}
        </p>
        <p className="leading-relaxed">
          {t('autoresearch.recipe.agentProfileDesc') || 'Runs in headless session with restricted tool set.'}
        </p>
      </div>

      {/* Advanced prompt blocks toggler */}
      <div className="border-t border-gray-100 pt-3 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[10px] font-semibold text-gray-400 hover:text-gray-900 self-start transition-colors flex items-center gap-1"
        >
          <span>{showAdvanced ? '▼' : '▶'}</span>
          <span>{t('autoresearch.recipe.advancedTitle') || '高级：Prompt 积木'}</span>
        </button>
        <p className="text-[9px] text-gray-400 leading-normal">
          {t('autoresearch.recipe.advancedDesc') || '通常不需要打开。用于手动微调最终启动 Prompt。'}
        </p>

        {showAdvanced && (
          <div className="mt-2 p-2 bg-gray-50 rounded-xl border border-gray-200 text-xs text-left max-w-full overflow-x-auto">
            <BlockComposer
              blocks={composerBlocks}
              onChange={setComposerBlocks}
              onSend={onSend}
              context={{
                projectFolder: sshConfig?.mode === 'ssh' ? sshConfig.remoteWorkDir : undefined,
                contextFiles: importedFiles.map((file) => file.path),
              }}
              disabled={disabled}
              defaultMode="agent"
              density="compact"
            />
          </div>
        )}
      </div>
    </div>
  );
}
