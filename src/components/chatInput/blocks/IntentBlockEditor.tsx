import type { ComposerBlock, IntentBlock } from './types';

/**
 * Intent editor moved verbatim out of BlockComposer.tsx (AG-29).
 * State stays in BlockComposer.
 */
export interface IntentBlockEditorProps {
  block: IntentBlock;
  index: number;
  updateBlock: (index: number, updated: ComposerBlock) => void;
}

export function IntentBlockEditor({ block, index, updateBlock }: IntentBlockEditorProps) {
  return (
    <>
      <select
        value={block.intentType}
        onChange={(e) => updateBlock(index, { ...block, intentType: e.target.value as any })}
        className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-800 focus:outline-none focus:border-neutral-300"
      >
        <option value="implement">Implement Feature</option>
        <option value="debug">Debug / Fix Bug</option>
        <option value="plan">Design Plan / Proposal</option>
        <option value="question">Question / Explain Code</option>
        <option value="refactor">Refactor Code</option>
        <option value="test">Write Tests</option>
        <option value="document">Documentation</option>
        <option value="run_command">Run Command</option>
        <option value="autoresearch">AutoResearch Task</option>
      </select>
      <textarea
        value={block.detail}
        onChange={(e) => updateBlock(index, { ...block, detail: e.target.value })}
        placeholder="What specific outcome are you targeting?"
        rows={2}
        className="w-full rounded-lg border border-neutral-200 p-2 text-xs focus:outline-none focus:border-neutral-300 resize-none flex-1 font-sans"
      />
    </>
  );
}
