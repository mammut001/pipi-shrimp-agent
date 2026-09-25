import type { Dispatch, SetStateAction } from 'react';
import type { VerificationBlock, ComposerBlock } from './types';

/**
 * Verification block editor moved verbatim out of BlockComposer.tsx (AG-29).
 * State stays in BlockComposer.
 */
export interface VerificationBlockEditorProps {
  block: VerificationBlock;
  index: number;
  updateBlock: (index: number, updated: ComposerBlock) => void;
  newVerifications: Record<string, string>;
  setNewVerifications: Dispatch<SetStateAction<Record<string, string>>>;
}

export function VerificationBlockEditor({
  block,
  index,
  updateBlock,
  newVerifications,
  setNewVerifications,
}: VerificationBlockEditorProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.requireBuild}
            onChange={(e) => updateBlock(index, { ...block, requireBuild: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Require Build
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.requireTests}
            onChange={(e) => updateBlock(index, { ...block, requireTests: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Require Tests
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.requireTypecheck}
            onChange={(e) => updateBlock(index, { ...block, requireTypecheck: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Require Typecheck
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.requireI18nCheck}
            onChange={(e) => updateBlock(index, { ...block, requireI18nCheck: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Require i18n Check
        </label>
      </div>

      {/* Commands list */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={newVerifications[block.id] || ''}
          onChange={(e) => setNewVerifications({ ...newVerifications, [block.id]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const val = (newVerifications[block.id] || '').trim();
              if (val && !block.commands.includes(val)) {
                updateBlock(index, { ...block, commands: [...block.commands, val] });
                setNewVerifications({ ...newVerifications, [block.id]: '' });
              }
            }
          }}
          placeholder="Verification command (e.g. npm test)"
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            const val = (newVerifications[block.id] || '').trim();
            if (val && !block.commands.includes(val)) {
              updateBlock(index, { ...block, commands: [...block.commands, val] });
              setNewVerifications({ ...newVerifications, [block.id]: '' });
            }
          }}
          className="rounded-lg border border-neutral-200 hover:bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600 font-medium"
        >
          Add
        </button>
      </div>
      {block.commands.length > 0 && (
        <div className="flex flex-col gap-1 max-h-16 overflow-y-auto">
          {block.commands.map((cmd, cmdIdx) => (
            <div key={cmdIdx} className="flex justify-between items-center bg-neutral-50 border border-neutral-100 rounded px-1.5 py-0.5 text-[10px] text-neutral-600 font-mono group/c">
              <span className="truncate flex-1 pr-1">{cmd}</span>
              <button
                type="button"
                onClick={() => updateBlock(index, { ...block, commands: block.commands.filter((_, idx) => idx !== cmdIdx) })}
                className="text-neutral-400 hover:text-red-500 font-bold"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        type="text"
        value={block.customVerification || ''}
        onChange={(e) => updateBlock(index, { ...block, customVerification: e.target.value })}
        placeholder="Additional verification guidelines..."
        className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
      />
    </>
  );
}
