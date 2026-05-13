import type { ConversationalTemplateId } from './types';

export interface ConversationalTemplateOption {
  id: ConversationalTemplateId;
  title: string;
  opener: string;
}

export const CONVERSATIONAL_TEMPLATE_OPENERS: Record<ConversationalTemplateId, string> = {
  'reproduce-paper': 'I want to reproduce a paper end-to-end. Help me choose the goal, papers, baselines, metric, and starter scaffold.',
  'beat-baseline': 'I want to beat a baseline on a known task. Propose the goal, keep the comparison honest, and scaffold the experiment workspace.',
  ablation: 'I want to run an ablation study on an existing method. Help me lock the question, metrics, and an experiment scaffold.',
  'from-scratch': 'I want to start a new AutoResearch project from scratch. Propose a concrete research goal and bootstrap the workspace.',
};

export const CONVERSATIONAL_TEMPLATE_OPTIONS: ConversationalTemplateOption[] = [
  {
    id: 'reproduce-paper',
    title: 'Reproduce a paper',
    opener: CONVERSATIONAL_TEMPLATE_OPENERS['reproduce-paper'],
  },
  {
    id: 'beat-baseline',
    title: 'Beat a baseline',
    opener: CONVERSATIONAL_TEMPLATE_OPENERS['beat-baseline'],
  },
  {
    id: 'ablation',
    title: 'Ablation study',
    opener: CONVERSATIONAL_TEMPLATE_OPENERS.ablation,
  },
  {
    id: 'from-scratch',
    title: 'From scratch',
    opener: CONVERSATIONAL_TEMPLATE_OPENERS['from-scratch'],
  },
];