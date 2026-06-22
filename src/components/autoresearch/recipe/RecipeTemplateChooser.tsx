import React from 'react';
import { t } from '@/i18n';
import { BootstrapQuickStartCards } from '../BootstrapQuickStartCards';

interface RecipeTemplateChooserProps {
  selectedTemplateId: string | null;
  templatesExpanded: boolean;
  setTemplatesExpanded: (val: boolean) => void;
  onSelectTemplate: (templateId: any) => void;
}

export function RecipeTemplateChooser({
  selectedTemplateId,
  templatesExpanded,
  setTemplatesExpanded,
  onSelectTemplate,
}: RecipeTemplateChooserProps) {
  if (selectedTemplateId && !templatesExpanded) {
    return (
      <div className="flex items-center justify-between bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-2.5 w-full">
        <div className="flex items-center gap-2 text-xs text-slate-700 font-sans">
          <span className="text-gray-400 font-semibold">{t('autoresearch.recipe.currentTemplate') || '当前模板'}:</span>
          <span className="font-bold text-slate-900">
            {selectedTemplateId === 'reproduce-paper' && (t('autoresearch.recipe.taskType.reproduce') || '复现论文')}
            {selectedTemplateId === 'beat-baseline' && (t('autoresearch.recipe.taskType.baseline') || '超越基线')}
            {selectedTemplateId === 'ablation' && (t('autoresearch.recipe.taskType.ablation') || '消融实验')}
            {selectedTemplateId === 'from-scratch' && (t('autoresearch.recipe.taskType.scratch') || '从零开始')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setTemplatesExpanded(true)}
          className="text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors font-sans"
        >
          {t('autoresearch.recipe.changeTemplate') || '更换模板'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 w-full font-sans">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-gray-400 font-sans">
          {t('autoresearch.recipe.selectTemplateTitle') || '选择启动模板'}
        </h3>
        {selectedTemplateId && (
          <button
            type="button"
            onClick={() => setTemplatesExpanded(false)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors font-sans"
          >
            {t('autoresearch.recipe.collapseTemplate') || '收起模板选择'}
          </button>
        )}
      </div>
      <BootstrapQuickStartCards selectedId={selectedTemplateId} onSelect={onSelectTemplate} />
    </div>
  );
}
