import type { ExecutionModeId } from '@/services/executionMode';

export type BlockType = 'intent' | 'context' | 'mode' | 'constraints' | 'output' | 'verification' | 'safety';

export interface IntentBlock {
  id: string;
  type: 'intent';
  intentType: 'question' | 'plan' | 'debug' | 'implement' | 'refactor' | 'test' | 'document' | 'run_command' | 'autoresearch';
  detail: string;
}

export interface ContextBlock {
  id: string;
  type: 'context';
  projectFolder?: string;
  contextFiles?: string[];
  paths: string[];
  symbols: string[];
  notes?: string;
  scope: 'whole_project' | 'selected_files' | 'current_folder' | 'manual_paths';
}

export interface ModeBlock {
  id: string;
  type: 'mode';
  executionMode: ExecutionModeId;
}

export interface ConstraintsBlock {
  id: string;
  type: 'constraints';
  noBroadRefactor: boolean;
  preservePublicApi: boolean;
  noDestructiveCommands: boolean;
  readOnly: boolean;
  maxFiles?: number;
  maxToolRounds?: number;
  language?: string;
  customConstraints: string[];
}

export interface OutputBlock {
  id: string;
  type: 'output';
  outputType: 'answer' | 'plan' | 'patch' | 'test_report' | 'release_notes' | 'checklist' | 'docs';
  includeFilesChanged: boolean;
  includeCommandsRun: boolean;
  includeRemainingRisks: boolean;
  includeManualQA: boolean;
  customOutput?: string;
}

export interface VerificationBlock {
  id: string;
  type: 'verification';
  commands: string[];
  requireBuild: boolean;
  requireTests: boolean;
  requireTypecheck: boolean;
  requireI18nCheck: boolean;
  customVerification?: string;
}

export interface SafetyBlock {
  id: string;
  type: 'safety';
  approvalMode: 'ask_on_risky' | 'no_destructive' | 'bypass_normal_tools';
  forbiddenActions: string[];
  confirmBefore: {
    delete: boolean;
    network: boolean;
    external_write: boolean;
    dependency_install: boolean;
  };
}

export type ComposerBlock =
  | IntentBlock
  | ContextBlock
  | ModeBlock
  | ConstraintsBlock
  | OutputBlock
  | VerificationBlock
  | SafetyBlock;

export interface BlockPreset {
  id: string;
  name: string;
  description: string;
  blocks: ComposerBlock[];
}

export const PRESET_ASK_QUESTION: ComposerBlock[] = [
  {
    id: 'p-ask-intent',
    type: 'intent',
    intentType: 'question',
    detail: '',
  },
  {
    id: 'p-ask-mode',
    type: 'mode',
    executionMode: 'ask',
  },
  {
    id: 'p-ask-output',
    type: 'output',
    outputType: 'answer',
    includeFilesChanged: false,
    includeCommandsRun: false,
    includeRemainingRisks: false,
    includeManualQA: false,
  },
];

export const PRESET_MAKE_PLAN: ComposerBlock[] = [
  {
    id: 'p-plan-intent',
    type: 'intent',
    intentType: 'plan',
    detail: '',
  },
  {
    id: 'p-plan-mode',
    type: 'mode',
    executionMode: 'plan',
  },
  {
    id: 'p-plan-constraints',
    type: 'constraints',
    noBroadRefactor: false,
    preservePublicApi: false,
    noDestructiveCommands: true,
    readOnly: true,
    customConstraints: [],
  },
  {
    id: 'p-plan-output',
    type: 'output',
    outputType: 'plan',
    includeFilesChanged: false,
    includeCommandsRun: false,
    includeRemainingRisks: true,
    includeManualQA: false,
  },
];

export const PRESET_DEBUG_BUG: ComposerBlock[] = [
  {
    id: 'p-debug-intent',
    type: 'intent',
    intentType: 'debug',
    detail: '',
  },
  {
    id: 'p-debug-mode',
    type: 'mode',
    executionMode: 'debug',
  },
  {
    id: 'p-debug-constraints',
    type: 'constraints',
    noBroadRefactor: true,
    preservePublicApi: true,
    noDestructiveCommands: false,
    readOnly: false,
    maxFiles: 5,
    customConstraints: [],
  },
  {
    id: 'p-debug-output',
    type: 'output',
    outputType: 'patch',
    includeFilesChanged: true,
    includeCommandsRun: true,
    includeRemainingRisks: false,
    includeManualQA: false,
  },
  {
    id: 'p-debug-verification',
    type: 'verification',
    commands: [],
    requireBuild: false,
    requireTests: true,
    requireTypecheck: false,
    requireI18nCheck: false,
  },
];

export const PRESET_IMPLEMENT_FEATURE: ComposerBlock[] = [
  {
    id: 'p-feature-intent',
    type: 'intent',
    intentType: 'implement',
    detail: '',
  },
  {
    id: 'p-feature-mode',
    type: 'mode',
    executionMode: 'agent',
  },
  {
    id: 'p-feature-constraints',
    type: 'constraints',
    noBroadRefactor: false,
    preservePublicApi: true,
    noDestructiveCommands: false,
    readOnly: false,
    maxFiles: 5,
    customConstraints: [],
  },
  {
    id: 'p-feature-output',
    type: 'output',
    outputType: 'patch',
    includeFilesChanged: true,
    includeCommandsRun: true,
    includeRemainingRisks: true,
    includeManualQA: true,
  },
  {
    id: 'p-feature-verification',
    type: 'verification',
    commands: [],
    requireBuild: true,
    requireTests: true,
    requireTypecheck: false,
    requireI18nCheck: false,
  },
];

export const PRESET_FAST_TRUSTED_EDIT: ComposerBlock[] = [
  {
    id: 'p-trust-intent',
    type: 'intent',
    intentType: 'refactor',
    detail: '',
  },
  {
    id: 'p-trust-mode',
    type: 'mode',
    executionMode: 'bypass',
  },
  {
    id: 'p-trust-safety',
    type: 'safety',
    approvalMode: 'bypass_normal_tools',
    forbiddenActions: ['Do not run large script migrations'],
    confirmBefore: {
      delete: true,
      network: true,
      external_write: false,
      dependency_install: true,
    },
  },
  {
    id: 'p-trust-output',
    type: 'output',
    outputType: 'patch',
    includeFilesChanged: true,
    includeCommandsRun: true,
    includeRemainingRisks: false,
    includeManualQA: false,
  },
];

export const PRESET_AUTORESEARCH_SMOKE: ComposerBlock[] = [
  {
    id: 'p-auto-intent',
    type: 'intent',
    intentType: 'autoresearch',
    detail: '',
  },
  {
    id: 'p-auto-mode',
    type: 'mode',
    executionMode: 'agent',
  },
  {
    id: 'p-auto-context',
    type: 'context',
    paths: [],
    symbols: [],
    scope: 'selected_files',
    notes: 'small fixture repo',
  },
  {
    id: 'p-auto-output',
    type: 'output',
    outputType: 'test_report',
    includeFilesChanged: false,
    includeCommandsRun: true,
    includeRemainingRisks: true,
    includeManualQA: false,
    customOutput: 'metrics + artifacts + failure reason',
  },
];

export const COMPOSER_PRESETS: BlockPreset[] = [
  {
    id: 'ask-question',
    name: 'Ask a question',
    description: 'Quick informational query. Run in read-only Ask mode.',
    blocks: PRESET_ASK_QUESTION,
  },
  {
    id: 'make-plan',
    name: 'Make a plan',
    description: 'Propose and refine a detailed plan before executing.',
    blocks: PRESET_MAKE_PLAN,
  },
  {
    id: 'debug-bug',
    name: 'Debug a bug',
    description: 'Locate a bug, fix it, and output a patch & reproduction steps.',
    blocks: PRESET_DEBUG_BUG,
  },
  {
    id: 'implement-feature',
    name: 'Implement feature',
    description: 'Write a new feature, run verification tests, and provide documentation.',
    blocks: PRESET_IMPLEMENT_FEATURE,
  },
  {
    id: 'fast-trusted-edit',
    name: 'Fast trusted edit',
    description: 'Autonomous edits with auto-approval (Bypass mode) for trusted tasks.',
    blocks: PRESET_FAST_TRUSTED_EDIT,
  },
  {
    id: 'autoresearch-smoke',
    name: 'AutoResearch smoke',
    description: 'AutoResearch loop preset for structured agent runs on fixture repos.',
    blocks: PRESET_AUTORESEARCH_SMOKE,
  },
];
