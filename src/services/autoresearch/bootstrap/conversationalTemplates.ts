import { t } from '@/i18n';
import type { ConversationalTemplateId } from './types';

export interface ConversationalTemplateOption {
  id: ConversationalTemplateId;
  title: string;
  opener: string;
}

export function getConversationalTemplateOpeners(): Record<ConversationalTemplateId, string> {
  return {
    'reproduce-paper': t('autoresearch.bootstrap.card.reproduce.opener'),
    'beat-baseline': t('autoresearch.bootstrap.card.baseline.opener'),
    ablation: t('autoresearch.bootstrap.card.ablation.opener'),
    'from-scratch': t('autoresearch.bootstrap.card.scratch.opener'),
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

