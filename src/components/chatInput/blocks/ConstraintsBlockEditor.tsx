import type { Dispatch, SetStateAction } from 'react';
import type { ConstraintsBlock, ComposerBlock } from './types';

/**
 * Constraints block editor moved verbatim out of BlockComposer.tsx (AG-29).
 * State stays in BlockComposer.
 */
export interface ConstraintsBlockEditorProps {
  block: ConstraintsBlock;
  index: number;
  updateBlock: (index: number, updated: ComposerBlock) => void;
  newConstraints: Record<string, string>;
  setNewConstraints: Dispatch<SetStateAction<Record<string, string>>>;
}

export function ConstraintsBlockEditor({
  block,
  index,
  updateBlock,
  newConstraints,
  setNewConstraints,
}: ConstraintsBlockEditorProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.readOnly}
            onChange={(e) => updateBlock(index, { ...block, readOnly: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Read-Only
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.noBroadRefactor}
            onChange={(e) => updateBlock(index, { ...block, noBroadRefactor: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          No Broad Refactor
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.preservePublicApi}
            onChange={(e) => updateBlock(index, { ...block, preservePublicApi: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Preserve Public API
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.noDestructiveCommands}
            onChange={(e) => updateBlock(index, { ...block, noDestructiveCommands: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          No Destructive Cmds
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-neutral-100 pt-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-neutral-500">Max Files:</span>
          <input
            type="number"
            min={1}
            max={50}
            value={block.maxFiles || ''}
            onChange={(e) => updateBlock(index, { ...block, maxFiles: parseInt(e.target.value) || undefined })}
            placeholder="e.g. 5"
            className="w-12 rounded border border-neutral-200 px-1 py-0.5 text-xs text-center focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-neutral-500">Max Rounds:</span>
          <input
            type="number"
            min={1}
            max={100}
            value={block.maxToolRounds || ''}
            onChange={(e) => updateBlock(index, { ...block, maxToolRounds: parseInt(e.target.value) || undefined })}
            placeholder="e.g. 15"
            className="w-12 rounded border border-neutral-200 px-1 py-0.5 text-xs text-center focus:outline-none"
          />
        </div>
      </div>

      <input
        type="text"
        value={block.language || ''}
        onChange={(e) => updateBlock(index, { ...block, language: e.target.value })}
        placeholder="Language Style / Details (e.g. TS, strict checks)"
        className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
      />

      {/* Custom constraint adder */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={newConstraints[block.id] || ''}
          onChange={(e) => setNewConstraints({ ...newConstraints, [block.id]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const val = (newConstraints[block.id] || '').trim();
              if (val && !block.customConstraints.includes(val)) {
                updateBlock(index, { ...block, customConstraints: [...block.customConstraints, val] });
                setNewConstraints({ ...newConstraints, [block.id]: '' });
              }
            }
          }}
          placeholder="Custom Constraint rule..."
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            const val = (newConstraints[block.id] || '').trim();
            if (val && !block.customConstraints.includes(val)) {
              updateBlock(index, { ...block, customConstraints: [...block.customConstraints, val] });
              setNewConstraints({ ...newConstraints, [block.id]: '' });
            }
          }}
          className="rounded-lg border border-neutral-200 hover:bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600 font-medium"
        >
          Add
        </button>
      </div>
      {block.customConstraints.length > 0 && (
        <div className="flex flex-col gap-1 max-h-16 overflow-y-auto">
          {block.customConstraints.map((c, cIdx) => (
            <div key={cIdx} className="flex justify-between items-center bg-neutral-50 border border-neutral-100 rounded px-1.5 py-0.5 text-[10px] text-neutral-600 font-sans group/c">
              <span className="truncate flex-1 pr-1">{c}</span>
              <button
                type="button"
                onClick={() => updateBlock(index, { ...block, customConstraints: block.customConstraints.filter((_, idx) => idx !== cIdx) })}
                className="text-neutral-400 hover:text-red-500 font-bold"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
