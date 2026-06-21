import { useState, useCallback } from 'react';
import { t } from '@/i18n';
import {
  type ComposerBlock,
  type BlockType,
  COMPOSER_PRESETS,
} from './blocks/types';
import { buildPromptFromBlocks } from './blocks/promptBuilder';
import type { ExecutionModeId } from '@/services/executionMode';

interface PromptContext {
  projectFolder?: string;
  pipiOutputDir?: string;
  contextFiles?: string[];
}

interface BlockComposerProps {
  blocks: ComposerBlock[];
  onChange: (blocks: ComposerBlock[]) => void;
  onClose?: () => void;
  onUseAsMessage?: (compiledPrompt: string) => void;
  onSend: (compiledPrompt: string) => void;
  context?: PromptContext;
}

export function BlockComposer({
  blocks,
  onChange,
  onClose,
  onUseAsMessage,
  onSend,
  context,
}: BlockComposerProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [activePreset, setActivePreset] = useState('');

  // Path/Symbol temp input states indexed by block ID to prevent interference
  const [newPaths, setNewPaths] = useState<Record<string, string>>({});
  const [newSymbols, setNewSymbols] = useState<Record<string, string>>({});
  const [newVerifications, setNewVerifications] = useState<Record<string, string>>({});
  const [newForbiddens, setNewForbiddens] = useState<Record<string, string>>({});
  const [newConstraints, setNewConstraints] = useState<Record<string, string>>({});

  const createBlock = (type: BlockType): ComposerBlock => {
    const id = `block-${Math.random().toString(36).substring(2, 9)}`;
    switch (type) {
      case 'intent':
        return { id, type: 'intent', intentType: 'implement', detail: '' };
      case 'context':
        return { id, type: 'context', paths: [], symbols: [], scope: 'selected_files' };
      case 'mode':
        return { id, type: 'mode', executionMode: 'agent' };
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
  };

  const handlePresetSelect = (presetId: string) => {
    const preset = COMPOSER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    
    // Deep clone blocks from preset to ensure references are clean and IDs are unique
    const clonedBlocks = preset.blocks.map((b) => {
      const id = `block-${Math.random().toString(36).substring(2, 9)}`;
      if (b.type === 'intent') {
        return { ...b, id };
      } else if (b.type === 'context') {
        return { ...b, id, paths: [...b.paths], symbols: [...b.symbols], contextFiles: b.contextFiles ? [...b.contextFiles] : [] };
      } else if (b.type === 'mode') {
        return { ...b, id };
      } else if (b.type === 'constraints') {
        return { ...b, id, customConstraints: [...b.customConstraints] };
      } else if (b.type === 'output') {
        return { ...b, id };
      } else if (b.type === 'verification') {
        return { ...b, id, commands: [...b.commands] };
      } else {
        return { ...b, id, forbiddenActions: [...b.forbiddenActions], confirmBefore: { ...b.confirmBefore } };
      }
    });

    onChange(clonedBlocks);
  };

  const addBlock = (type: BlockType) => {
    onChange([...blocks, createBlock(type)]);
  };

  const removeBlock = (id: string) => {
    onChange(blocks.filter((b) => b.id !== id));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...blocks];
    const temp = next[index];
    next[index] = next[index - 1]!;
    next[index - 1] = temp!;
    onChange(next);
  };

  const moveDown = (index: number) => {
    if (index === blocks.length - 1) return;
    const next = [...blocks];
    const temp = next[index];
    next[index] = next[index + 1]!;
    next[index + 1] = temp!;
    onChange(next);
  };

  const updateBlock = useCallback(
    (index: number, updated: ComposerBlock) => {
      const next = [...blocks];
      next[index] = updated;
      onChange(next);
    },
    [blocks, onChange]
  );

  const clearAll = () => {
    onChange([]);
    setActivePreset('');
  };

  if (!Array.isArray(blocks)) {
    return null;
  }

  const compiledPrompt = buildPromptFromBlocks(blocks, context);

  return (
    <div className="mb-4 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 shadow-sm transition-all animate-fadeIn">
      {/* Header Panel */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/60 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-1.5">
            <span className="text-base">🧩</span>
            {t('chat.blockComposerTitle') || 'Block Task Composer'}
          </h3>
          <p className="text-[11px] text-neutral-500">
            {t('chat.blockComposerSubtitle') || 'Build structured, robust prompts by stacking task blocks.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Preset Selector */}
          <select
            value={activePreset}
            onChange={(e) => handlePresetSelect(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          >
            <option value="" disabled>
              ⚡ {t('chat.loadPreset') || 'Load Template Preset...'}
            </option>
            {COMPOSER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>

          {/* Reset / Clear Button */}
          {blocks.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="px-2.5 py-1 text-xs rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 hover:text-red-600 transition-all font-medium text-neutral-600"
            >
              Clear
            </button>
          )}

          {/* Close button */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 hover:bg-neutral-200/50 transition-colors"
              title={t('common.close') || 'Close'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Block List Canvas */}
      {blocks.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center text-center">
          <span className="text-2xl mb-2 opacity-60">🥞</span>
          <p className="text-xs text-neutral-400 max-w-sm">
            Canvas is empty. Select a preset template above or click any button below to add custom task blocks.
          </p>
        </div>
      ) : (
        <div className="grid gap-3.5 mt-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
          {blocks.map((block, index) => {
            const isFirst = index === 0;
            const isLast = index === blocks.length - 1;

            return (
              <div
                key={block.id}
                className="group relative rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm transition-all duration-200 hover:shadow-md flex flex-col gap-2.5"
              >
                {/* Block Header / Action Controls */}
                <div className="flex items-center justify-between border-b border-neutral-100 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    {block.type === 'intent' && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-100">🎯 Intent</span>}
                    {block.type === 'context' && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-bold border border-orange-100">📁 Context</span>}
                    {block.type === 'mode' && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-bold border border-purple-100">⚙️ Mode</span>}
                    {block.type === 'constraints' && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-bold border border-red-100">🛑 Constraints</span>}
                    {block.type === 'output' && <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold border border-green-100">📄 Output</span>}
                    {block.type === 'verification' && <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-bold border border-teal-100">✅ Verification</span>}
                    {block.type === 'safety' && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-100">🛡️ Safety</span>}
                  </div>

                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {/* Move Up */}
                    <button
                      type="button"
                      disabled={isFirst}
                      onClick={() => moveUp(index)}
                      className="p-0.5 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Move Up"
                    >
                      ▲
                    </button>
                    {/* Move Down */}
                    <button
                      type="button"
                      disabled={isLast}
                      onClick={() => moveDown(index)}
                      className="p-0.5 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Move Down"
                    >
                      ▼
                    </button>
                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      className="ml-1 p-0.5 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500"
                      title="Remove Block"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Block Inputs Form Fields */}
                <div className="flex-1 flex flex-col gap-2">
                  {/* INTENT BLOCK EDITOR */}
                  {block.type === 'intent' && (
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
                  )}

                  {/* CONTEXT BLOCK EDITOR */}
                  {block.type === 'context' && (
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
                  )}

                  {/* MODE BLOCK EDITOR */}
                  {block.type === 'mode' && (
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
                  )}

                  {/* CONSTRAINTS BLOCK EDITOR */}
                  {block.type === 'constraints' && (
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
                  )}

                  {/* OUTPUT BLOCK EDITOR */}
                  {block.type === 'output' && (
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
                  )}

                  {/* VERIFICATION BLOCK EDITOR */}
                  {block.type === 'verification' && (
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
                  )}

                  {/* SAFETY BLOCK EDITOR */}
                  {block.type === 'safety' && (
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
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Block Picker Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-neutral-200/60 pt-3">
        <span className="text-[10px] font-bold text-neutral-400 select-none mr-1">ADD BLOCK:</span>
        <button
          type="button"
          onClick={() => addBlock('intent')}
          className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200 transition-colors"
        >
          + Intent
        </button>
        <button
          type="button"
          onClick={() => addBlock('context')}
          className="px-2 py-1 rounded bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-bold border border-orange-200 transition-colors"
        >
          + Context
        </button>
        <button
          type="button"
          onClick={() => addBlock('mode')}
          className="px-2 py-1 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 text-[10px] font-bold border border-purple-200 transition-colors"
        >
          + Mode
        </button>
        <button
          type="button"
          onClick={() => addBlock('constraints')}
          className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold border border-red-200 transition-colors"
        >
          + Constraints
        </button>
        <button
          type="button"
          onClick={() => addBlock('output')}
          className="px-2 py-1 rounded bg-green-50 hover:bg-green-100 text-green-700 text-[10px] font-bold border border-green-200 transition-colors"
        >
          + Output
        </button>
        <button
          type="button"
          onClick={() => addBlock('verification')}
          className="px-2 py-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 text-[10px] font-bold border border-teal-200 transition-colors"
        >
          + Verification
        </button>
        <button
          type="button"
          onClick={() => addBlock('safety')}
          className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200 transition-colors"
        >
          + Safety
        </button>
      </div>

      {/* Accordion Prompt Preview & Canvas Action Controls */}
      <div className="mt-3.5 border-t border-neutral-200/60 pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-[11px] font-semibold text-neutral-500 hover:text-neutral-700 select-none transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${showPreview ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
            {showPreview ? 'Hide Compiled Prompt Preview' : 'Show Compiled Prompt Preview'}
          </button>

          {blocks.length > 0 && (
            <div className="flex items-center gap-2">
              {onUseAsMessage && (
                <button
                  type="button"
                  onClick={() => onUseAsMessage(compiledPrompt)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-neutral-200 hover:bg-neutral-100 text-neutral-700 transition-colors"
                >
                  Use as message
                </button>
              )}
              <button
                type="button"
                onClick={() => onSend(compiledPrompt)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white shadow-sm transition-colors"
              >
                Send task
              </button>
            </div>
          )}
        </div>

        {showPreview && (
          <div className="mt-1.5 max-h-48 overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-900 p-3.5 font-mono text-[10px] text-neutral-300 leading-normal select-all select-text whitespace-pre-wrap">
            <pre className="whitespace-pre-wrap">{compiledPrompt}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
