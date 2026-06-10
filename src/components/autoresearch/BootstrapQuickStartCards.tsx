import { CONVERSATIONAL_TEMPLATE_OPTIONS } from '@/services/autoresearch/bootstrap/conversationalTemplates';

interface BootstrapQuickStartCardsProps {
  onSelect: (templateId: (typeof CONVERSATIONAL_TEMPLATE_OPTIONS)[number]['id']) => void;
}

export function BootstrapQuickStartCards({ onSelect }: BootstrapQuickStartCardsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {CONVERSATIONAL_TEMPLATE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onSelect(option.id)}
          className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-600 hover:shadow-md"
        >
          <p className="text-sm font-semibold text-gray-900">{option.title}</p>
          <p className="mt-2 text-sm leading-6 text-gray-600">{option.opener}</p>
        </button>
      ))}
    </div>
  );
}

export default BootstrapQuickStartCards;