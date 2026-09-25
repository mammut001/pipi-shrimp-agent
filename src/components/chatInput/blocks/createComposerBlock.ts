import type { ComposerBlock, BlockType } from './types';
import type { ExecutionModeId } from '@/services/executionMode';

/**
 * Moved verbatim from BlockComposer.tsx (AG-29).
 */
export function createComposerBlock(type: BlockType, defaultMode: ExecutionModeId): ComposerBlock {
  const id = `block-${Math.random().toString(36).substring(2, 9)}`;
  switch (type) {
    case 'intent':
      return { id, type: 'intent', intentType: 'implement', detail: '' };
    case 'context':
      return { id, type: 'context', paths: [], symbols: [], scope: 'selected_files' };
    case 'mode':
      return { id, type: 'mode', executionMode: defaultMode };
    case 'constraints':
      return {
        id,
        type: 'constraints',
        noBroadRefactor: false,
        preservePublicApi: false,
        noDestructiveCommands: false,
        readOnly: false,
        customConstraints: [],
      };
    case 'output':
      return {
        id,
        type: 'output',
        outputType: 'patch',
        includeFilesChanged: false,
        includeCommandsRun: false,
        includeRemainingRisks: false,
        includeManualQA: false,
      };
    case 'verification':
      return {
        id,
        type: 'verification',
        commands: [],
        requireBuild: false,
        requireTests: false,
        requireTypecheck: false,
        requireI18nCheck: false,
      };
    case 'safety':
      return {
        id,
        type: 'safety',
        approvalMode: 'ask_on_risky',
        forbiddenActions: [],
        confirmBefore: {
          delete: true,
          network: true,
          external_write: false,
          dependency_install: false,
        },
      };
  }
}
