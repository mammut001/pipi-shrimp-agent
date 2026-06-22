import React from 'react';
import { t } from '@/i18n';
import type { Recipe } from '../../bootstrapRecipePrompt';

interface ResearchGoalSectionProps {
  recipe: Recipe;
  onChange: (val: Partial<Recipe['researchGoal']>) => void;
}

export function ResearchGoalSection({ recipe, onChange }: ResearchGoalSectionProps) {
  return (
    <>
      <div className="space-y-1.5 font-sans">
        <label className="text-xs font-semibold text-gray-700">{t('autoresearch.recipe.taskType') || '任务类型'}</label>
        <select
          value={recipe.researchGoal.taskType}
          onChange={(e) => onChange({ taskType: e.target.value as any })}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
        >
          <option value="reproduce_paper">{t('autoresearch.recipe.taskType.reproduce') || 'Reproduce Paper'}</option>
          <option value="beat_baseline">{t('autoresearch.recipe.taskType.baseline') || 'Beat Baseline'}</option>
          <option value="ablation">{t('autoresearch.recipe.taskType.ablation') || 'Ablation Studies'}</option>
          <option value="from_scratch">{t('autoresearch.recipe.taskType.scratch') || 'From Scratch'}</option>
        </select>
        <p className="text-[10px] text-gray-400 leading-normal">
          {recipe.researchGoal.taskType === 'reproduce_paper' && (t('autoresearch.recipe.taskType.reproduceDesc') || 'Guide the agent to duplicate paper claimed metrics.')}
          {recipe.researchGoal.taskType === 'beat_baseline' && (t('autoresearch.recipe.taskType.baselineDesc') || 'Instruct the agent to search for methods to beat target scores.')}
          {recipe.researchGoal.taskType === 'ablation' && (t('autoresearch.recipe.taskType.ablationDesc') || 'Isolate specific features/parameters to observe degradation.')}
          {recipe.researchGoal.taskType === 'from_scratch' && (t('autoresearch.recipe.taskType.scratchDesc') || 'Start an exploratory greenfield implementation.')}
        </p>
      </div>

      <div className="space-y-1.5 font-sans">
        <label className="text-xs font-semibold text-gray-700 font-sans">{t('autoresearch.recipe.goalLabel') || '目标描述'}</label>
        <textarea
          value={recipe.researchGoal.goalText}
          onChange={(e) => onChange({ goalText: e.target.value })}
          placeholder={t('autoresearch.recipe.goalPlaceholder') || 'Summarize the core target and scope of the experiment...'}
          rows={3}
          className="w-full rounded-lg border border-gray-200 p-2.5 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none font-sans"
        />
      </div>
    </>
  );
}
