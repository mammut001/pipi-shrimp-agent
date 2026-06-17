import { t } from '@/i18n';
import type { ConversationalTemplateId } from './types';

export interface ConversationalTemplateOption {
  id: ConversationalTemplateId;
  title: string;
  opener: string;
}

export const CONVERSATIONAL_TEMPLATE_OPENERS: Record<ConversationalTemplateId, string> = {
  'reproduce-paper': t('autoresearch.bootstrap.card.reproduce.opener'),
  'beat-baseline': t('autoresearch.bootstrap.card.baseline.opener'),
  ablation: t('autoresearch.bootstrap.card.ablation.opener'),
  'from-scratch': t('autoresearch.bootstrap.card.scratch.opener'),
};

export const CONVERSATIONAL_TEMPLATE_OPTIONS: ConversationalTemplateOption[] = [
  {
    id: 'reproduce-paper',
    title: t('autoresearch.bootstrap.card.reproduce.title'),
    opener: CONVERSATIONAL_TEMPLATE_OPENERS['reproduce-paper'],
  },
  {
    id: 'beat-baseline',
    title: t('autoresearch.bootstrap.card.baseline.title'),
    opener: CONVERSATIONAL_TEMPLATE_OPENERS['beat-baseline'],
  },
  {
    id: 'ablation',
    title: t('autoresearch.bootstrap.card.ablation.title'),
    opener: CONVERSATIONAL_TEMPLATE_OPENERS.ablation,
  },
  {
    id: 'from-scratch',
    title: t('autoresearch.bootstrap.card.scratch.title'),
    opener: CONVERSATIONAL_TEMPLATE_OPENERS['from-scratch'],
  },
];
