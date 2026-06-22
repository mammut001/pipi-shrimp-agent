import { CONVERSATIONAL_TEMPLATE_OPTIONS } from '@/services/autoresearch/bootstrap/conversationalTemplates';
import { t } from '@/i18n';

interface BootstrapQuickStartCardsProps {
  selectedId?: string | null;
  onSelect: (templateId: (typeof CONVERSATIONAL_TEMPLATE_OPTIONS)[number]['id']) => void;
}

export function BootstrapQuickStartCards({ selectedId, onSelect }: BootstrapQuickStartCardsProps) {
  const selectedOption = CONVERSATIONAL_TEMPLATE_OPTIONS.find((opt) => opt.id === selectedId);

  return (
    <div className="space-y-2">
      {/* Selected Template Badge */}
      {selectedId && selectedOption && (
        <div className="text-xs font-medium text-slate-700 bg-slate-100/80 border border-slate-200/50 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
          <span>{t('autoresearch.recipe.currentTemplate') || '当前模板'}:</span>
          <span className="text-slate-900 font-bold">{selectedOption.title}</span>
        </div>
      )}

      {/* Compact Cards Grid */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        {CONVERSATIONAL_TEMPLATE_OPTIONS.map((option) => {
          const isSelected = selectedId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              className={`rounded-xl border px-3 py-2 text-left transition-all duration-200 outline-none flex flex-col justify-between min-h-[52px] ${
                isSelected
                  ? 'border-slate-400 bg-slate-50 ring-2 ring-slate-100'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between w-full gap-1">
                <p className={`text-xs font-semibold truncate ${isSelected ? 'text-slate-900' : 'text-gray-700'}`}>
                  {option.title}
                </p>
                {isSelected && (
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                    <svg className="h-2 w-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
              </div>
              <p className="text-[10px] text-gray-400 truncate w-full mt-0.5 leading-normal">
                {option.opener}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default BootstrapQuickStartCards;