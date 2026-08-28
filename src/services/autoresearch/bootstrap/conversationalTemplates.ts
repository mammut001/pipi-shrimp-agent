import { t } from '@/i18n';
import type { ConversationalTemplateId } from './types';

export interface ConversationalTemplateOption {
  id: ConversationalTemplateId;
  title: string;
  opener: string;
}

export function getConversationalTemplateOpeners(): Record<ConversationalTemplateId, string> {
  const reproduce = t('autoresearch.bootstrap.card.reproduce.opener');
  const baseline = t('autoresearch.bootstrap.card.baseline.opener');
  const ablation = t('autoresearch.bootstrap.card.ablation.opener');
  const scratch = t('autoresearch.bootstrap.card.scratch.opener');
  return {
    'reproduce-paper': reproduce,
    'beat-baseline': baseline,
    ablation,
    'from-scratch': scratch,
    reproduce_paper: reproduce,
    beat_baseline: baseline,
    from_scratch: scratch,
  };
}

export function getConversationalTemplateOptions(): ConversationalTemplateOption[] {
  const openers = getConversationalTemplateOpeners();
  return [
    {
      id: 'reproduce-paper',
      title: t('autoresearch.bootstrap.card.reproduce.title'),
      opener: openers['reproduce-paper'],
    },
    {
      id: 'beat-baseline',
      title: t('autoresearch.bootstrap.card.baseline.title'),
      opener: openers['beat-baseline'],
    },
    {
      id: 'ablation',
      title: t('autoresearch.bootstrap.card.ablation.title'),
      opener: openers.ablation,
    },
    {
      id: 'from-scratch',
      title: t('autoresearch.bootstrap.card.scratch.title'),
      opener: openers['from-scratch'],
    },
  ];
}

export const CONVERSATIONAL_TEMPLATE_OPTIONS: ConversationalTemplateOption[] = getConversationalTemplateOptions();

