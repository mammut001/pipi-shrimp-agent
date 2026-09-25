import type { Dispatch, SetStateAction } from 'react';
import type { SafetyBlock, ComposerBlock } from './types';

/**
 * Safety block editor moved verbatim out of BlockComposer.tsx (AG-29).
 * State stays in BlockComposer.
 */
export interface SafetyBlockEditorProps {
  block: SafetyBlock;
  index: number;
  updateBlock: (index: number, updated: ComposerBlock) => void;
  newForbiddens: Record<string, string>;
  setNewForbiddens: Dispatch<SetStateAction<Record<string, string>>>;
}

export function SafetyBlockEditor({
  block,
  index,
  updateBlock,
  newForbiddens,
  setNewForbiddens,
}: SafetyBlockEditorProps) {
  return (
    <>
      <div className="flex gap-2 items-center">
        <label className="text-[10px] font-bold text-neutral-500 select-none">Rule:</label>
        <select
          value={block.approvalMode}
          onChange={(e) => updateBlock(index, { ...block, approvalMode: e.target.value as any })}
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-0.5 text-xs text-neutral-800 focus:outline-none"
        >
          <option value="ask_on_risky">Ask for Risky Actions</option>
          <option value="no_destructive">Prohibit Destructive Tools</option>
          <option value="bypass_normal_tools">Bypass approvals (Trust mode)</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-t border-neutral-100 pt-2">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.confirmBefore.delete}
            onChange={(e) => updateBlock(index, {
              ...block,
              confirmBefore: { ...block.confirmBefore, delete: e.target.checked },
            })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Confirm Delete
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.confirmBefore.network}
            onChange={(e) => updateBlock(index, {
              ...block,
              confirmBefore: { ...block.confirmBefore, network: e.target.checked },
            })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Confirm Network
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.confirmBefore.external_write}
            onChange={(e) => updateBlock(index, {
              ...block,
              confirmBefore: { ...block.confirmBefore, external_write: e.target.checked },
            })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Confirm Ext Write
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-neutral-700 font-medium select-none">
          <input
            type="checkbox"
            checked={block.confirmBefore.dependency_install}
            onChange={(e) => updateBlock(index, {
              ...block,
              confirmBefore: { ...block.confirmBefore, dependency_install: e.target.checked },
            })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
          />
          Confirm Package Install
        </label>
      </div>

      {/* Forbidden list */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={newForbiddens[block.id] || ''}
          onChange={(e) => setNewForbiddens({ ...newForbiddens, [block.id]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const val = (newForbiddens[block.id] || '').trim();
              if (val && !block.forbiddenActions.includes(val)) {
                updateBlock(index, { ...block, forbiddenActions: [...block.forbiddenActions, val] });
                setNewForbiddens({ ...newForbiddens, [block.id]: '' });
              }
            }
          }}
          placeholder="Forbidden Action (e.g. Do not touch main.go)"
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            const val = (newForbiddens[block.id] || '').trim();
            if (val && !block.forbiddenActions.includes(val)) {
              updateBlock(index, { ...block, forbiddenActions: [...block.forbiddenActions, val] });
              setNewForbiddens({ ...newForbiddens, [block.id]: '' });
            }
          }}
          className="rounded-lg border border-neutral-200 hover:bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600 font-medium"
        >
          Add
        </button>
      </div>
      {block.forbiddenActions.length > 0 && (
        <div className="flex flex-col gap-1 max-h-16 overflow-y-auto">
          {block.forbiddenActions.map((forbidden, fIdx) => (
            <div key={fIdx} className="flex justify-between items-center bg-neutral-50 border border-neutral-100 rounded px-1.5 py-0.5 text-[10px] text-neutral-600 font-sans group/f">
              <span className="truncate flex-1 pr-1">{forbidden}</span>
              <button
                type="button"
                onClick={() => updateBlock(index, { ...block, forbiddenActions: block.forbiddenActions.filter((_, idx) => idx !== fIdx) })}
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
