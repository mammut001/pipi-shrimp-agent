import type { ComposerBlock, ModeBlock } from './types';
import type { ExecutionModeId } from '@/services/executionMode';

/**
 * Mode editor moved verbatim out of BlockComposer.tsx (AG-29).
 * State stays in BlockComposer.
 */
export interface ModeBlockEditorProps {
  block: ModeBlock;
  index: number;
  updateBlock: (index: number, updated: ComposerBlock) => void;
}

export function ModeBlockEditor({ block, index, updateBlock }: ModeBlockEditorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-1">
        {(['ask', 'plan', 'debug', 'agent', 'bypass'] as ExecutionModeId[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => updateBlock(index, { ...block, executionMode: m })}
            className={`py-1 px-1.5 text-[10px] font-bold rounded border uppercase tracking-wider text-center transition-all ${
              block.executionMode === m
                ? 'bg-neutral-900 border-neutral-900 text-white shadow-sm'
                : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100 hover:border-neutral-300'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-neutral-500 italic px-1">
        {block.executionMode === 'ask' && 'Read-only mode. Answers queries without executing actions.'}
        {block.executionMode === 'plan' && 'Read-only analysis mode. Formulates a plan document before editing.'}
        {block.executionMode === 'debug' && 'Diagnoses issues, runs minimal localized fixes, verifies results.'}
        {block.executionMode === 'agent' && 'Runs full agent cycle. Modifies code, runs build verification commands.'}
        {block.executionMode === 'bypass' && '⚠️ TRUST MODE. Runs local commands with no manual step approval dialogs.'}
      </p>
    </div>
  );
}
