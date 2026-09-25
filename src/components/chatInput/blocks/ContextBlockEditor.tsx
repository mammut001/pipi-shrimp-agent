import type { Dispatch, SetStateAction } from 'react';
import type { ContextBlock, ComposerBlock } from './types';

/**
 * Context block editor moved verbatim out of BlockComposer.tsx (AG-29).
 * State stays in BlockComposer.
 */
export interface ContextBlockEditorProps {
  block: ContextBlock;
  index: number;
  updateBlock: (index: number, updated: ComposerBlock) => void;
  newPaths: Record<string, string>;
  setNewPaths: Dispatch<SetStateAction<Record<string, string>>>;
  newSymbols: Record<string, string>;
  setNewSymbols: Dispatch<SetStateAction<Record<string, string>>>;
}

export function ContextBlockEditor({
  block,
  index,
  updateBlock,
  newPaths,
  setNewPaths,
  newSymbols,
  setNewSymbols,
}: ContextBlockEditorProps) {
  return (
    <>
      <div className="flex gap-2 items-center">
        <label className="text-[10px] font-bold text-neutral-500 select-none">Scope:</label>
        <select
          value={block.scope}
          onChange={(e) => updateBlock(index, { ...block, scope: e.target.value as any })}
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-0.5 text-xs text-neutral-800 focus:outline-none"
        >
          <option value="selected_files">Selected Files/Paths</option>
          <option value="whole_project">Whole Project</option>
          <option value="current_folder">Current Folder</option>
          <option value="manual_paths">Manual Paths / Symbols</option>
        </select>
      </div>

      {/* Paths Chip List Input */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={newPaths[block.id] || ''}
          onChange={(e) => setNewPaths({ ...newPaths, [block.id]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const val = (newPaths[block.id] || '').trim();
              if (val && !block.paths.includes(val)) {
                updateBlock(index, { ...block, paths: [...block.paths, val] });
                setNewPaths({ ...newPaths, [block.id]: '' });
              }
            }
          }}
          placeholder="Target path (e.g. src/App.tsx)"
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            const val = (newPaths[block.id] || '').trim();
            if (val && !block.paths.includes(val)) {
              updateBlock(index, { ...block, paths: [...block.paths, val] });
              setNewPaths({ ...newPaths, [block.id]: '' });
            }
          }}
          className="rounded-lg border border-neutral-200 hover:bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600 font-medium"
        >
          Add
        </button>
      </div>
      {block.paths.length > 0 && (
        <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
          {block.paths.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-[10px] text-neutral-700 font-mono"
            >
              <span className="truncate max-w-[120px]">{p}</span>
              <button
                type="button"
                onClick={() => updateBlock(index, { ...block, paths: block.paths.filter((x) => x !== p) })}
                className="text-neutral-400 hover:text-neutral-600 font-bold px-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Symbols Input */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={newSymbols[block.id] || ''}
          onChange={(e) => setNewSymbols({ ...newSymbols, [block.id]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const val = (newSymbols[block.id] || '').trim();
              if (val && !block.symbols.includes(val)) {
                updateBlock(index, { ...block, symbols: [...block.symbols, val] });
                setNewSymbols({ ...newSymbols, [block.id]: '' });
              }
            }
          }}
          placeholder="Target Symbol (e.g. ChatInput)"
          className="flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            const val = (newSymbols[block.id] || '').trim();
            if (val && !block.symbols.includes(val)) {
              updateBlock(index, { ...block, symbols: [...block.symbols, val] });
              setNewSymbols({ ...newSymbols, [block.id]: '' });
            }
          }}
          className="rounded-lg border border-neutral-200 hover:bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600 font-medium"
        >
          Add
        </button>
      </div>
      {block.symbols.length > 0 && (
        <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto">
          {block.symbols.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-[10px] text-neutral-700 font-mono"
            >
              <span className="truncate max-w-[120px]">{s}</span>
              <button
                type="button"
                onClick={() => updateBlock(index, { ...block, symbols: block.symbols.filter((x) => x !== s) })}
                className="text-neutral-400 hover:text-neutral-600 font-bold px-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={block.notes || ''}
        onChange={(e) => updateBlock(index, { ...block, notes: e.target.value })}
        placeholder="Context Details / Notes..."
        className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-xs focus:outline-none"
      />
    </>
  );
}
