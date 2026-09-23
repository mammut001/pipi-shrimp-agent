/**
 * BlockComposer wiring for ChatInput (AG-13).
 *
 * Main chat no longer mounts BlockComposer, but keeps inert composer state so
 * legacy block drafts are cleared and shared AutoResearch surfaces can still
 * reuse the same mode-sync / bypass-gate helpers.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ExecutionModeId } from '@/services/executionMode';
import { type ComposerBlock } from './blocks/types';
import {
  DRAFT_PERSIST_DEBOUNCE_MS,
  clearDraftPair,
  persistBlockDraft,
} from './draftPersistence';

export type ComposerBlocksChangeDecision =
  | { type: 'apply'; blocks: ComposerBlock[] }
  | { type: 'pending-bypass'; blocks: ComposerBlock[] };

/**
 * Sync store/dropdown execution mode into an existing mode block (no-op if absent).
 */
export function syncComposerModeFromExecutionMode(
  blocks: ComposerBlock[],
  selectedExecutionModeId: ExecutionModeId | null | undefined,
): ComposerBlock[] {
  if (!selectedExecutionModeId) return blocks;
  const modeBlockIdx = blocks.findIndex((b) => b.type === 'mode');
  if (modeBlockIdx === -1) return blocks;
  const modeBlock = blocks[modeBlockIdx];
  if (modeBlock.type !== 'mode' || modeBlock.executionMode === selectedExecutionModeId) {
    return blocks;
  }
  const nextBlocks = [...blocks];
  nextBlocks[modeBlockIdx] = {
    ...modeBlock,
    executionMode: selectedExecutionModeId,
  };
  return nextBlocks;
}

/**
 * Gate composer block edits that would flip into danger/bypass without confirmation.
 */
export function decideComposerBlocksChange(params: {
  newBlocks: ComposerBlock[];
  selectedExecutionModeId: ExecutionModeId;
}): ComposerBlocksChangeDecision {
  const { newBlocks, selectedExecutionModeId } = params;
  const modeBlock = newBlocks.find((b) => b.type === 'mode');
  if (
    modeBlock
    && modeBlock.type === 'mode'
    && (modeBlock.executionMode === 'danger' || modeBlock.executionMode === 'bypass')
    && selectedExecutionModeId !== 'danger'
  ) {
    return { type: 'pending-bypass', blocks: newBlocks };
  }
  return { type: 'apply', blocks: newBlocks };
}

/**
 * Confirm pending danger/bypass: keep the pending blocks as-is.
 */
export function applyConfirmBypass(pendingBypassBlocks: ComposerBlock[]): ComposerBlock[] {
  return pendingBypassBlocks;
}

/**
 * Cancel pending danger/bypass: revert mode blocks to the selected store mode.
 */
export function applyCancelBypass(
  pendingBypassBlocks: ComposerBlock[],
  selectedExecutionModeId: ExecutionModeId,
): ComposerBlock[] {
  return pendingBypassBlocks.map((b) => {
    if (b.type === 'mode') {
      return { ...b, executionMode: selectedExecutionModeId };
    }
    return b;
  });
}

export interface UseBlockComposerWiringParams {
  blockDraftStorageKey: string;
  selectedExecutionModeId: ExecutionModeId;
  currentSessionId: string | null;
  updateSessionExecutionMode: (sessionId: string, modeId: ExecutionModeId) => void | Promise<void>;
}

export interface UseBlockComposerWiringResult {
  composerOpen: boolean;
  composerBlocks: ComposerBlock[];
  pendingBypassBlocks: ComposerBlock[] | null;
  handleComposerBlocksChange: (newBlocks: ComposerBlock[]) => void;
  handleConfirmBypass: () => void;
  handleCancelBypass: () => void;
  resetComposer: () => void;
}

/**
 * Inert BlockComposer state machine used by ChatInput after the main-chat UI
 * was removed. Clears legacy drafts and keeps mode sync / bypass helpers ready.
 */
export function useBlockComposerWiring({
  blockDraftStorageKey,
  selectedExecutionModeId,
  currentSessionId,
  updateSessionExecutionMode,
}: UseBlockComposerWiringParams): UseBlockComposerWiringResult {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerBlocks, setComposerBlocks] = useState<ComposerBlock[]>([]);
  const [pendingBypassBlocks, setPendingBypassBlocks] = useState<ComposerBlock[] | null>(null);

  // Main-chat block composer was removed. Clear any legacy hidden draft so a
  // stale composer payload can never affect a normal send after the UI is gone.
  useEffect(() => {
    clearDraftPair(blockDraftStorageKey);
    setComposerBlocks([]);
    setComposerOpen(false);
    setPendingBypassBlocks(null);
  }, [blockDraftStorageKey]);

  // Persist block draft
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const isDirty = composerBlocks.length > 0;
      if (composerOpen && isDirty) {
        persistBlockDraft(blockDraftStorageKey, JSON.stringify(composerBlocks));
      } else {
        persistBlockDraft(blockDraftStorageKey, null);
      }
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [composerBlocks, composerOpen, blockDraftStorageKey]);

  // Sync from store/dropdown to composer
  useEffect(() => {
    setComposerBlocks((prev) => syncComposerModeFromExecutionMode(prev, selectedExecutionModeId));
  }, [selectedExecutionModeId]);

  const handleComposerBlocksChange = useCallback((newBlocks: ComposerBlock[]) => {
    const decision = decideComposerBlocksChange({ newBlocks, selectedExecutionModeId });
    if (decision.type === 'pending-bypass') {
      setPendingBypassBlocks(decision.blocks);
      return;
    }
    setComposerBlocks(decision.blocks);
    const modeBlock = decision.blocks.find((b) => b.type === 'mode');
    if (
      modeBlock
      && modeBlock.type === 'mode'
      && modeBlock.executionMode !== selectedExecutionModeId
      && currentSessionId
    ) {
      void updateSessionExecutionMode(currentSessionId, modeBlock.executionMode);
    }
  }, [selectedExecutionModeId, currentSessionId, updateSessionExecutionMode]);

  const handleConfirmBypass = useCallback(() => {
    if (!pendingBypassBlocks) return;
    setComposerBlocks(applyConfirmBypass(pendingBypassBlocks));
    if (currentSessionId) {
      void updateSessionExecutionMode(currentSessionId, 'danger');
    }
    setPendingBypassBlocks(null);
  }, [pendingBypassBlocks, currentSessionId, updateSessionExecutionMode]);

  const handleCancelBypass = useCallback(() => {
    if (!pendingBypassBlocks) return;
    setComposerBlocks(applyCancelBypass(pendingBypassBlocks, selectedExecutionModeId));
    setPendingBypassBlocks(null);
  }, [pendingBypassBlocks, selectedExecutionModeId]);

  const resetComposer = useCallback(() => {
    setComposerBlocks([]);
    setComposerOpen(false);
  }, []);

  return {
    composerOpen,
    composerBlocks,
    pendingBypassBlocks,
    handleComposerBlocksChange,
    handleConfirmBypass,
    handleCancelBypass,
    resetComposer,
  };
}
