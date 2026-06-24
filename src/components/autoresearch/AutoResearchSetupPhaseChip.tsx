import { getCurrentLocale } from '@/i18n';
import {
  deriveAutoResearchSetupPhase,
  formatAutoResearchSetupPhaseLabel,
  getAutoResearchSetupPhaseTone,
  type AutoResearchSetupPhaseTone,
  type DeriveAutoResearchSetupPhaseInput,
} from '@/services/autoresearch/setupPhase';

const TONE_CLASS_NAMES: Record<AutoResearchSetupPhaseTone, string> = {
  neutral: 'border-neutral-200 bg-neutral-50 text-neutral-600',
  active: 'border-slate-200 bg-slate-50 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};

export interface AutoResearchSetupPhaseChipProps {
  input: DeriveAutoResearchSetupPhaseInput;
  locale?: 'en-US' | 'zh-CN';
  className?: string;
}

export function AutoResearchSetupPhaseChip({
  input,
  locale,
  className = '',
}: AutoResearchSetupPhaseChipProps) {
  const resolvedLocale = locale ?? (getCurrentLocale() === 'zh-CN' ? 'zh-CN' : 'en-US');
  const phase = deriveAutoResearchSetupPhase(input);
  const label = formatAutoResearchSetupPhaseLabel(phase, resolvedLocale);
  const tone = getAutoResearchSetupPhaseTone(phase);
  const toneClasses = TONE_CLASS_NAMES[tone];

  return (
    <span
      data-testid="autoresearch-setup-phase-chip"
      data-phase={phase}
      aria-label={`AutoResearch phase: ${label}`}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClasses} ${className}`.trim()}
    >
      {label}
    </span>
  );
}