import React from 'react';
import { t } from '@/i18n';
import type { Recipe } from '../../bootstrapRecipePrompt';
import { formatReferenceGuidance } from '../recipeFormatting';

interface ReferencesSectionProps {
  recipe: Recipe;
  locale: string;
  importedFiles: Array<{ id: string; name: string; path: string }>;
  onAddFiles: () => void | Promise<void>;
  onRemoveFile: (id: string) => void;
}

export function ReferencesSection({
  recipe,
  locale,
  importedFiles,
  onAddFiles,
  onRemoveFile,
}: ReferencesSectionProps) {
  return (
    <>
      <div className="space-y-2 font-sans">
        <button
          type="button"
          onClick={onAddFiles}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold border border-gray-200 hover:border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all active:scale-[0.98]"
        >
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('autoresearch.recipe.selectFiles') || 'Select and Add Files'}
        </button>
      </div>

      {importedFiles.length > 0 ? (
        <div className="grid gap-2 grid-cols-1 md:grid-cols-2 font-sans">
          {importedFiles.map((file) => (
            <div key={file.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-gray-200 transition-colors group">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm shrink-0">
                  {file.name.endsWith('.pdf') ? '📕' : '📄'}
                </span>
                <span className="text-xs font-medium text-gray-700 truncate" title={file.path}>
                  {file.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveFile(file.id)}
                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                title="Remove"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-1 font-sans">
          <p className="font-semibold text-slate-700">
            {t('autoresearch.recipe.noFiles') || '暂未添加参考文件。'}
          </p>
          <p className="text-slate-500 leading-relaxed font-sans">
            {(() => {
              const keyMap = {
                reproduce_paper: 'reproduce',
                beat_baseline: 'baseline',
                ablation: 'ablation',
                from_scratch: 'scratch'
              };
              const key = keyMap[recipe.researchGoal.taskType as keyof typeof keyMap];
              return key ? (t(`autoresearch.recipe.referenceGuidance.${key}` as any) || formatReferenceGuidance(recipe.researchGoal.taskType, locale)) : '';
            })()}
          </p>
        </div>
      )}
    </>
  );
}
