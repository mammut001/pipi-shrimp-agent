import { useState, useCallback, useEffect } from 'react';
import { t } from '@/i18n';
import {
  type ComposerBlock,
  type BlockType,
  COMPOSER_PRESETS,
} from './blocks/types';
import { buildPromptFromBlocks, hasMeaningfulComposerContent } from './blocks/promptBuilder';
import { createComposerBlock } from './blocks/createComposerBlock';
import { ContextBlockEditor } from './blocks/ContextBlockEditor';
import { ConstraintsBlockEditor } from './blocks/ConstraintsBlockEditor';
import { OutputBlockEditor } from './blocks/OutputBlockEditor';
import { VerificationBlockEditor } from './blocks/VerificationBlockEditor';
import { SafetyBlockEditor } from './blocks/SafetyBlockEditor';
import { IntentBlockEditor } from './blocks/IntentBlockEditor';
import { ModeBlockEditor } from './blocks/ModeBlockEditor';
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
  disabled?: boolean;
  defaultMode?: ExecutionModeId;
  density?: 'default' | 'compact';
}

export function BlockComposer({
  blocks,
  onChange,
  onClose,
  onUseAsMessage,
  onSend,
  context,
  disabled = false,
  defaultMode = 'agent',
  density = 'default',
}: BlockComposerProps) {
  const isCompact = density === 'compact';
  const [showPreview, setShowPreview] = useState(false);
  const [activePreset, setActivePreset] = useState('');

  // Path/Symbol temp input states indexed by block ID to prevent interference
  const [newPaths, setNewPaths] = useState<Record<string, string>>({});
  const [newSymbols, setNewSymbols] = useState<Record<string, string>>({});
  const [newVerifications, setNewVerifications] = useState<Record<string, string>>({});
  const [newForbiddens, setNewForbiddens] = useState<Record<string, string>>({});
  const [newConstraints, setNewConstraints] = useState<Record<string, string>>({});

  const createBlock = (type: BlockType): ComposerBlock => createComposerBlock(type, defaultMode);

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

  useEffect(() => {
    if (!showPreview) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowPreview(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPreview]);

  if (!Array.isArray(blocks)) {
    return null;
  }

  const compiledPrompt = buildPromptFromBlocks(blocks, context);
  const canSendTask = hasMeaningfulComposerContent(blocks);

  return (
    <div className={`mb-4 border border-neutral-200 bg-neutral-50/60 shadow-sm transition-all animate-fadeIn ${isCompact ? 'p-2.5 mb-2 rounded-xl' : 'p-4 rounded-2xl'}`}>
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
            aria-label={t('chat.loadPreset') || 'Load Template Preset'}
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
              {t('chat.clearComposer') || 'Clear'}
            </button>
          )}

          {/* Close button */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 hover:bg-neutral-200/50 transition-colors"
              title={t('common.close') || 'Close'}
              aria-label={t('common.close') || 'Close composer'}
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
            {t('chat.canvasEmpty') || 'Canvas is empty. Select a preset template above or click any button below to add custom task blocks.'}
          </p>
        </div>
      ) : (
        <div className={`grid mt-3 ${isCompact ? 'grid-cols-1 gap-2.5 mt-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-3.5'}`}>
          {blocks.map((block, index) => {
            const isFirst = index === 0;
            const isLast = index === blocks.length - 1;

            return (
              <div
                key={block.id}
                className={`group relative border border-neutral-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md flex flex-col ${
                  isCompact ? 'rounded-lg p-2.5 gap-2' : 'rounded-xl p-3.5 gap-2.5'
                }`}
              >
                {/* Block Header / Action Controls */}
                <div className="flex items-center justify-between border-b border-neutral-100 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    {block.type === 'intent' && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-100">🎯 {t('chat.blockLabel.intent') || 'Intent'}</span>}
                    {block.type === 'context' && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-bold border border-orange-100">📁 {t('chat.blockLabel.context') || 'Context'}</span>}
                    {block.type === 'mode' && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-bold border border-purple-100">⚙️ {t('chat.blockLabel.mode') || 'Mode'}</span>}
                    {block.type === 'constraints' && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-bold border border-red-100">🛑 {t('chat.blockLabel.constraints') || 'Constraints'}</span>}
                    {block.type === 'output' && <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold border border-green-100">📄 {t('chat.blockLabel.output') || 'Output'}</span>}
                    {block.type === 'verification' && <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-bold border border-teal-100">✅ {t('chat.blockLabel.verification') || 'Verification'}</span>}
                    {block.type === 'safety' && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-100">🛡️ {t('chat.blockLabel.safety') || 'Safety'}</span>}
                  </div>

                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {/* Move Up */}
                    <button
                      type="button"
                      disabled={isFirst}
                      onClick={() => moveUp(index)}
                      className="p-0.5 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-30 disabled:hover:bg-transparent"
                      title={t('chat.moveUp') || 'Move Up'}
                      aria-label={t('chat.moveUp') || 'Move block up'}
                    >
                      ▲
                    </button>
                    {/* Move Down */}
                    <button
                      type="button"
                      disabled={isLast}
                      onClick={() => moveDown(index)}
                      className="p-0.5 rounded hover:bg-neutral-100 text-neutral-500 disabled:opacity-30 disabled:hover:bg-transparent"
                      title={t('chat.moveDown') || 'Move Down'}
                      aria-label={t('chat.moveDown') || 'Move block down'}
                    >
                      ▼
                    </button>
                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      className="ml-1 p-0.5 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500"
                      title={t('chat.removeBlock') || 'Remove Block'}
                      aria-label={t('chat.removeBlock') || 'Remove block'}
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Block Inputs Form Fields */}
                <div className="flex-1 flex flex-col gap-2">
                  {/* INTENT BLOCK EDITOR */}
                  {block.type === 'intent' && (
                    <IntentBlockEditor
                      block={block}
                      index={index}
                      updateBlock={updateBlock}
                    />
                  )}

                  {/* CONTEXT BLOCK EDITOR */}
                  {block.type === 'context' && (
                    <ContextBlockEditor
                      block={block}
                      index={index}
                      updateBlock={updateBlock}
                      newPaths={newPaths}
                      setNewPaths={setNewPaths}
                      newSymbols={newSymbols}
                      setNewSymbols={setNewSymbols}
                    />
                  )}

                  {/* MODE BLOCK EDITOR */}
                  {block.type === 'mode' && (
                    <ModeBlockEditor
                      block={block}
                      index={index}
                      updateBlock={updateBlock}
                    />
                  )}

                  {/* CONSTRAINTS BLOCK EDITOR */}
                  {block.type === 'constraints' && (
                    <ConstraintsBlockEditor
                      block={block}
                      index={index}
                      updateBlock={updateBlock}
                      newConstraints={newConstraints}
                      setNewConstraints={setNewConstraints}
                    />
                  )}

                  {/* OUTPUT BLOCK EDITOR */}
                  {block.type === 'output' && (
                    <OutputBlockEditor
                      block={block}
                      index={index}
                      updateBlock={updateBlock}
                    />
                  )}

                  {/* VERIFICATION BLOCK EDITOR */}
                  {block.type === 'verification' && (
                    <VerificationBlockEditor
                      block={block}
                      index={index}
                      updateBlock={updateBlock}
                      newVerifications={newVerifications}
                      setNewVerifications={setNewVerifications}
                    />
                  )}

                  {/* SAFETY BLOCK EDITOR */}
                  {block.type === 'safety' && (
                    <SafetyBlockEditor
                      block={block}
                      index={index}
                      updateBlock={updateBlock}
                      newForbiddens={newForbiddens}
                      setNewForbiddens={setNewForbiddens}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Block Picker Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-neutral-200/60 pt-3">
        <span className="text-[10px] font-bold text-neutral-400 select-none mr-1">
          {t('chat.addBlock') || 'ADD BLOCK:'}
        </span>
        <button
          type="button"
          onClick={() => addBlock('intent')}
          className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200 transition-colors"
        >
          + {t('chat.blockLabel.intent') || 'Intent'}
        </button>
        <button
          type="button"
          onClick={() => addBlock('context')}
          className="px-2 py-1 rounded bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-bold border border-orange-200 transition-colors"
        >
          + {t('chat.blockLabel.context') || 'Context'}
        </button>
        <button
          type="button"
          onClick={() => addBlock('mode')}
          className="px-2 py-1 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 text-[10px] font-bold border border-purple-200 transition-colors"
        >
          + {t('chat.blockLabel.mode') || 'Mode'}
        </button>
        <button
          type="button"
          onClick={() => addBlock('constraints')}
          className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold border border-red-200 transition-colors"
        >
          + {t('chat.blockLabel.constraints') || 'Constraints'}
        </button>
        <button
          type="button"
          onClick={() => addBlock('output')}
          className="px-2 py-1 rounded bg-green-50 hover:bg-green-100 text-green-700 text-[10px] font-bold border border-green-200 transition-colors"
        >
          + {t('chat.blockLabel.output') || 'Output'}
        </button>
        <button
          type="button"
          onClick={() => addBlock('verification')}
          className="px-2 py-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 text-[10px] font-bold border border-teal-200 transition-colors"
        >
          + {t('chat.blockLabel.verification') || 'Verification'}
        </button>
        <button
          type="button"
          onClick={() => addBlock('safety')}
          className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200 transition-colors"
        >
          + {t('chat.blockLabel.safety') || 'Safety'}
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

          {canSendTask && (
            <div className="flex items-center gap-2">
              {onUseAsMessage && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onUseAsMessage(compiledPrompt)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-neutral-200 hover:bg-neutral-100 text-neutral-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('chat.useAsMessage') || 'Use as message'}
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSend(compiledPrompt)}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('chat.sendTask') || 'Send task'}
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
