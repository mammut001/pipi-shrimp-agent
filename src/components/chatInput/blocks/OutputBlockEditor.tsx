import type { OutputBlock, ComposerBlock } from './types';

/**
 * Output block editor moved verbatim out of BlockComposer.tsx (AG-29).
 * State stays in BlockComposer.
 */
export interface OutputBlockEditorProps {
  block: OutputBlock;
  index: number;
  updateBlock: (index: number, updated: ComposerBlock) => void;
}

export function OutputBlockEditor({
  block,
  index,
  updateBlock,
}: OutputBlockEditorProps) {
  return (
    <>
      <div className="flex gap-2 items-center">
        <label className="text-[10px] font-bold text-neutral-500 select-none">Output Type:</label>
        <select
          value={block.outputType}
          onChange={(e) => updateBlock(index, { ...block, outputType: e.target.value as any })}
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-0.5 text-xs text-neutral-800 focus:outline-none"
        >
          <option value="patch">Code Patch (Diff)</option>
          <option value="answer">Direct Answer / Explanation</option>
          <option value="plan">Structured Plan Document</option>
          <option value="test_report">Test verification report</option>
          <option value="release_notes">Changelog / Release Notes</option>
          <option value="checklist">Post-change checklist</option>
          <option value="docs">Technical Documentation</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-t border-neutral-100 pt-2">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.includeFilesChanged}
            onChange={(e) => updateBlock(index, { ...block, includeFilesChanged: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Files Changed list
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.includeCommandsRun}
            onChange={(e) => updateBlock(index, { ...block, includeCommandsRun: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Commands Run log
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.includeRemainingRisks}
            onChange={(e) => updateBlock(index, { ...block, includeRemainingRisks: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Remaining Risks
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.includeManualQA}
            onChange={(e) => updateBlock(index, { ...block, includeManualQA: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Manual QA details
        </label>
      </div>

      <input
        type="text"
        value={block.customOutput || ''}
        onChange={(e) => updateBlock(index, { ...block, customOutput: e.target.value })}
        placeholder="Expected deliverable specifics..."
        className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
      />
    </>
  );
}
