import { CONVERSATIONAL_TEMPLATE_OPTIONS } from '@/services/autoresearch/bootstrap/conversationalTemplates';

interface BootstrapQuickStartCardsProps {
  selectedId?: string | null;
  onSelect: (templateId: (typeof CONVERSATIONAL_TEMPLATE_OPTIONS)[number]['id']) => void;
}

export function BootstrapQuickStartCards({ selectedId, onSelect }: BootstrapQuickStartCardsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {CONVERSATIONAL_TEMPLATE_OPTIONS.map((option) => {
        const isSelected = selectedId === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            className={`rounded-2xl border p-4 text-left shadow-sm transition-all duration-200 outline-none ${
              isSelected
                ? 'border-neutral-900 bg-neutral-50/50 ring-2 ring-neutral-100'
                : 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">{option.title}</p>
              {isSelected && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              )}
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">{option.opener}</p>
          </button>
        );
      })}
    </div>
  );
}

export default BootstrapQuickStartCards;