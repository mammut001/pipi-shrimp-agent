/**
 * ChatInput - Message input component
 *
 * Features:
 * - Text input field
 * - Send button (disabled when streaming)
 * - File upload button (optional)
 * - Placeholder text
 * - Auto focus
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { safeInvoke, safeInvokeOrNull } from '@/utils/safeInvoke';
import { startNewChatFlow } from '@/services/newChatFlow';
import { buildImageDataUrl, fileToImageAttachment } from '@/services/vision/imageAttachments';
import { useChatStore } from '@/store';
import { useUIStore } from '@/store';
import { useSessionGoalStore } from '@/store/sessionGoalStore';
import { useMCPStore } from '@/store/mcpStore';
import { MCPChatButton, MCPDropdown } from '@/components/mcp';
import { BrowserIntentConfirm } from './BrowserIntentConfirm';
import { ExecutionModeDropdown } from './chatInput/ExecutionModeDropdown';
import { ExecutionModeDropdownErrorBoundary } from './chatInput/ExecutionModeDropdownErrorBoundary';
import { SessionFolderChip } from './chatInput/SessionFolderChip';
import {
  decideChatInputSubmission,
  isStaleChatDraftValue,
  resolveChatTargetSessionId,
  shouldClearDraftAfterBrowserWorkflow,
  shouldDismissBrowserIntentConfirm,
} from './chatInputFlow';
import { t } from '@/i18n';
import { resolveSessionExecutionModeId, type ExecutionModeId } from '@/services/executionMode';
import { quickCheckBrowserIntent, handleChatBrowserWorkflow } from '@/utils/chatBrowserBridge';
import type { ImageAttachment } from '@/types/vision';
import { BlockComposer } from './chatInput/BlockComposer';
import { type ComposerBlock } from './chatInput/blocks/types';
import { canSendFromComposer, hasMeaningfulComposerContent, isCompiledTaskPrompt, resolveComposerSubmitMessage } from './chatInput/blocks/promptBuilder';
import { BypassWarningDialog } from './chatInput/ExecutionModeDropdown';
import { EXECUTION_MODES } from '@/services/executionMode';

// AUDIT-FIX [audit-1#6] — Debounce window for localStorage writes. 300ms is
// short enough that a navigation away from the tab will still flush the
// last keystroke before unmount, and long enough to coalesce typical typing.
const DRAFT_PERSIST_DEBOUNCE_MS = 300;

// Check if running inside Tauri
const isTauri = !!(window as any).__TAURI__;

/**
 * Cleanup old drafts from localStorage to prevent unbounded growth.
 * Removes drafts older than 7 days.
 */
function cleanupOldDrafts(): void {
  try {
    const cleanupKey = 'draft_cleanup_timestamp';
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

    const lastCleanup = parseInt(localStorage.getItem(cleanupKey) || '0', 10);
    if (lastCleanup && now - lastCleanup < maxAge) {
      return; // Recently cleaned, skip
    }

    // Mark cleanup time
    localStorage.setItem(cleanupKey, now.toString());

    // Find and remove old drafts. We iterate the raw localStorage keys so we
    // can also delete the matching `<key>__ts` timestamp entry.
    const draftPrefix = 'chat_draft_';
    const timestampSuffix = '__ts';
    const keysToRemove: string[] = [];
    const timestampsToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.endsWith(timestampSuffix)) {
        continue;
      }
      const isTextDraft = key.startsWith('chat_draft_');
      const isBlockDraft = key.startsWith('chat_blocks_draft_');
      if (!isTextDraft && !isBlockDraft) {
        continue;
      }
      const value = localStorage.getItem(key);
      if (!value || value.length === 0) {
        keysToRemove.push(key);
        continue;
      }

      const tsRaw = localStorage.getItem(`${key}${timestampSuffix}`);
      const lastTouchedAt = tsRaw ? Number.parseInt(tsRaw, 10) : null;

      // AUDIT-FIX [audit-1#6] — isStaleChatDraftValue now consults the
      // timestamp when present, so a large but recently-touched prompt is
      // preserved. Only the size+age combination triggers removal.
      if (isStaleChatDraftValue(value, Number.isFinite(lastTouchedAt) ? lastTouchedAt : null)) {
        keysToRemove.push(key);
        timestampsToRemove.push(`${key}${timestampSuffix}`);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    timestampsToRemove.forEach((key) => localStorage.removeItem(key));
    if (keysToRemove.length > 0) {
      console.log(`[ChatInput] Cleaned up ${keysToRemove.length} old drafts`);
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

/**
 * Props for ChatInput component
 */
interface ChatInputProps {
  /** Optional callback when message is sent */
  onSend?: (message: string, attachments?: ImageAttachment[]) => void | Promise<void>;
  /** Key used to namespace the draft in localStorage (default: 'default') */
  draftKey?: string;
  /** Submit mode. callback-only skips the global chat store and forwards text to onSend. */
  submitMode?: 'chat-store' | 'callback-only';
  /** Visual density. Compact is intended for embedded/modal surfaces. */
  density?: 'default' | 'compact';
  /** Default block composer open state */
  defaultComposerOpen?: boolean;
  /** Default block composer blocks */
  defaultBlocks?: ComposerBlock[];
}

/**
 * Chat input component
 */
export function ChatInput({
  onSend,
  draftKey = 'default',
  submitMode = 'chat-store',
  density = 'default',
  defaultComposerOpen = false,
  defaultBlocks,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isBindingFolder, setIsBindingFolder] = useState<'project' | 'output' | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [browserIntentCandidate, setBrowserIntentCandidate] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [goalPopoverOpen, setGoalPopoverOpen] = useState(false);
  const [goalInputText, setGoalInputText] = useState<string>('');
  const goalPopoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const draftStorageKey = `chat_draft_${draftKey}`;
  const [composerOpen, setComposerOpen] = useState(defaultComposerOpen);
  const [composerBlocks, setComposerBlocks] = useState<ComposerBlock[]>(defaultBlocks ?? []);
  const [pendingBypassBlocks, setPendingBypassBlocks] = useState<ComposerBlock[] | null>(null);
  const blockDraftStorageKey = `chat_blocks_draft_${draftKey}`;
  const isCompact = density === 'compact';
  const textareaMaxHeight = isCompact ? 96 : 200;
  const textareaMinHeight = isCompact ? '36px' : '48px';
  const rootClassName = isCompact
    ? 'bg-white'
    : 'border-t border-gray-200 bg-white p-4';
  const inputShellClassName = isCompact
    ? 'relative bg-gray-50 rounded-xl border transition-all px-3'
    : 'relative bg-gray-50 rounded-xl border transition-all px-4';
  const textareaClassName = isCompact
    ? 'flex-1 bg-transparent px-0 py-2 max-h-[96px] resize-none focus:outline-none text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50'
    : 'flex-1 bg-transparent px-0 py-3 max-h-[200px] resize-none focus:outline-none text-gray-900 placeholder-gray-400 disabled:opacity-50';
  const actionRowClassName = isCompact
    ? 'flex items-center gap-0.5 pr-1 pb-1.5 flex-wrap'
    : 'flex items-center gap-1 pr-2 pb-2 flex-wrap';
  const actionButtonClassName = isCompact
    ? 'p-1.5 rounded-md'
    : 'p-2 rounded-lg';
  const actionIconClassName = isCompact ? 'h-4 w-4' : 'h-5 w-5';

  // ── macOS WKWebView arrow-key tofu fix ──────────────────────────────────────
  // WKWebView forwards unhandled NSEvents back through NSTextInputClient, which
  // calls insertText: with Apple private-use characters:
  //   U+F700 ↑  U+F701 ↓  U+F702 ←  U+F703 →
  // These have no font glyph and render as □ squares.
  // The `beforeinput` event fires *before* the value changes, so preventDefault()
  // cancels the insertion cleanly. We attach both a React handler (onBeforeInput)
  // and a native capture-phase listener as belt-and-suspenders.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const blockPrivateUse = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.data && /[\uE000-\uF8FF]/.test(ie.data)) {
        e.preventDefault();
      }
    };
    el.addEventListener('beforeinput', blockPrivateUse, { capture: true });
    return () => el.removeEventListener('beforeinput', blockPrivateUse, { capture: true });
  }, []);
  // ────────────────────────────────────────────────────────────────────────────

  const {
    isStreaming,
    sendMessage,
    stopGeneration,
    currentSessionId,
    sessions,
    // Two-folder model: each folder has its own bind/clear action.
    setSessionProjectDir,
    setSessionPipiOutputDir,
    clearSessionProjectDir,
    clearSessionPipiOutputDir,
    updateSessionExecutionMode,
  } = useChatStore();
  const { toggleSettings, addNotification } = useUIStore();
  const { setDropdownOpen } = useMCPStore();
  const toggleTerminalPanel = useUIStore((s) => s.toggleTerminalPanel);
  const terminalPanelVisible = useUIStore((s) => s.terminalPanelVisible);
  const hydrateGoals = useSessionGoalStore((s) => s.hydrate);
  const bindSessionGoal = useSessionGoalStore((s) => s.bindSession);
  const setSessionObjective = useSessionGoalStore((s) => s.setObjective);
  const clearSessionGoal = useSessionGoalStore((s) => s.clearGoal);
  const sessionGoal = useSessionGoalStore((s) => (
    currentSessionId ? s.goalsBySession[currentSessionId]?.objective ?? '' : ''
  ));

  useEffect(() => {
    hydrateGoals();
  }, [hydrateGoals]);

  useEffect(() => {
    bindSessionGoal(currentSessionId);
  }, [bindSessionGoal, currentSessionId]);

  // Load goal draft on session switch
  useEffect(() => {
    if (!currentSessionId) {
      setGoalInputText('');
      return;
    }
    setGoalInputText(useSessionGoalStore.getState().goalsBySession[currentSessionId]?.objective ?? '');
  }, [currentSessionId]);

  // Click outside to close goal popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (goalPopoverRef.current && !goalPopoverRef.current.contains(event.target as Node)) {
        setGoalPopoverOpen(false);
      }
    }
    if (goalPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [goalPopoverOpen]);

  // Get current session
  const currentSession = sessions.find(s => s.id === currentSessionId);
  // Two-folder model: surface both folders independently. The
  // Project Folder is the user's repo (tool cwd); the PiPi Output
  // Folder is the app-owned output root (default: the per-session
  // `{Documents|HOME}/PiPi-Shrimp/chats/{id}/`). Both default to
  // `undefined` when not yet bound; the chat store resolves the
  // PiPi Output Folder fallback lazily.
  const projectDir = currentSession?.projectDir ?? currentSession?.workDir;
  const pipiOutputDir = currentSession?.pipiOutputDir;

  // Selected 5-mode execution mode. Resolve from persisted id or legacy
  // permission_mode so the dropdown matches what chatActions will use.
  const selectedExecutionModeId: ExecutionModeId = resolveSessionExecutionModeId(currentSession);
  const handleExecutionModeSelect = useCallback(
    (modeId: ExecutionModeId) => {
      if (!currentSessionId) return;
      void updateSessionExecutionMode(currentSessionId, modeId);
    },
    [currentSessionId, updateSessionExecutionMode],
  );

  // Restore draft from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(draftStorageKey);
    if (saved) setInput(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStorageKey]);

  // Restore block draft on draftKey switch
  useEffect(() => {
    const saved = localStorage.getItem(blockDraftStorageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setComposerBlocks(parsed);
          setComposerOpen(true);
        } else {
          // Legacy format or corrupt data
          setComposerBlocks(defaultBlocks ?? []);
          setComposerOpen(defaultComposerOpen);
          localStorage.removeItem(blockDraftStorageKey);
        }
      } catch (error) {
        setComposerBlocks(defaultBlocks ?? []);
        setComposerOpen(defaultComposerOpen);
      }
    } else {
      setComposerBlocks(defaultBlocks ?? []);
      setComposerOpen(defaultComposerOpen);
    }
  }, [blockDraftStorageKey, defaultBlocks, defaultComposerOpen]);

  // Persist block draft
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const isDirty = composerBlocks.length > 0;
      if (composerOpen && isDirty) {
        localStorage.setItem(blockDraftStorageKey, JSON.stringify(composerBlocks));
        localStorage.setItem(`${blockDraftStorageKey}__ts`, String(Date.now()));
      } else {
        localStorage.removeItem(blockDraftStorageKey);
        localStorage.removeItem(`${blockDraftStorageKey}__ts`);
      }
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [composerBlocks, composerOpen, blockDraftStorageKey]);

  // Bidirectional execution mode synchronization
  // 1. Sync from store/dropdown to composer
  useEffect(() => {
    if (!selectedExecutionModeId) return;
    setComposerBlocks((prev) => {
      const modeBlockIdx = prev.findIndex((b) => b.type === 'mode');
      if (modeBlockIdx === -1) {
        return prev;
      }
      const modeBlock = prev[modeBlockIdx];
      if (modeBlock.type !== 'mode' || modeBlock.executionMode === selectedExecutionModeId) {
        return prev;
      }
      const nextBlocks = [...prev];
      nextBlocks[modeBlockIdx] = {
        ...modeBlock,
        executionMode: selectedExecutionModeId,
      };
      return nextBlocks;
    });
  }, [selectedExecutionModeId]);

  // 2. Sync from composer to store
  const handleComposerBlocksChange = useCallback((newBlocks: ComposerBlock[]) => {
    const modeBlock = newBlocks.find((b) => b.type === 'mode') as any;
    if (modeBlock && modeBlock.executionMode === 'bypass' && selectedExecutionModeId !== 'bypass') {
      setPendingBypassBlocks(newBlocks);
    } else {
      setComposerBlocks(newBlocks);
      if (modeBlock && modeBlock.executionMode !== selectedExecutionModeId && currentSessionId) {
        void updateSessionExecutionMode(currentSessionId, modeBlock.executionMode);
      }
    }
  }, [selectedExecutionModeId, currentSessionId, updateSessionExecutionMode]);

  const handleConfirmBypass = useCallback(() => {
    if (!pendingBypassBlocks) return;
    setComposerBlocks(pendingBypassBlocks);
    if (currentSessionId) {
      void updateSessionExecutionMode(currentSessionId, 'bypass');
    }
    setPendingBypassBlocks(null);
  }, [pendingBypassBlocks, currentSessionId, updateSessionExecutionMode]);

  const handleCancelBypass = useCallback(() => {
    if (!pendingBypassBlocks) return;
    const nextBlocks = pendingBypassBlocks.map((b) => {
      if (b.type === 'mode') {
        return { ...b, executionMode: selectedExecutionModeId };
      }
      return b;
    });
    setComposerBlocks(nextBlocks);
    setPendingBypassBlocks(null);
  }, [pendingBypassBlocks, selectedExecutionModeId]);

  // AUDIT-FIX [audit-1#6] — Persist the draft with a short debounce so
  // every keystroke (especially for large copy-pasted prompts) doesn't
  // trigger a synchronous localStorage.setItem on the main thread. We also
  // store a `lastTouchedAt` timestamp alongside the value so the staleness
  // heuristic can make an actual time-based decision instead of guessing
  // from content length (see MAX_CHAT_DRAFT_STALE_MS).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (input) {
        try {
          localStorage.setItem(draftStorageKey, input);
          localStorage.setItem(`${draftStorageKey}__ts`, String(Date.now()));
        } catch (error) {
          // localStorage may be full / disabled; degrade silently.
          console.warn('[ChatInput] failed to persist draft:', error);
        }
      } else {
        localStorage.removeItem(draftStorageKey);
        localStorage.removeItem(`${draftStorageKey}__ts`);
      }
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [input, draftStorageKey]);

  useEffect(() => {
    if (shouldDismissBrowserIntentConfirm(browserIntentCandidate, input)) {
      setBrowserIntentCandidate(null);
    }
  }, [browserIntentCandidate, input]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, textareaMaxHeight)}px`;
    }
  }, [input, textareaMaxHeight]);

  // Auto-focus on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  // Cleanup old drafts on mount to prevent localStorage accumulation
  useEffect(() => {
    cleanupOldDrafts();
  }, []);

  /**
   * Handle opening the current Project Folder in Finder
   */
  const handleOpenFolder = useCallback(async () => {
    try {
      // Two-folder model: the "Open folder" button targets the
      // Project Folder (the user's repo), not the PiPi Output
      // Folder. Falling back to the app-managed PiPi Output Folder
      // is still useful so the user has *some* folder to land in
      // when no Project Folder is bound.
      let targetPath: string | undefined = projectDir;
      if (!targetPath && currentSessionId) {
        targetPath = await safeInvokeOrNull<string>('get_app_default_dir', { sessionId: currentSessionId }, { source: 'ChatInput.getDefaultDir' }) ?? undefined;
      }
      if (targetPath) {
        await safeInvoke('reveal_in_finder', { path: targetPath }, { source: 'ChatInput.openFolder' });
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, [projectDir, currentSessionId]);

  const clearInputDraft = useCallback(() => {
    setInput('');
    setAttachments([]);
    setBrowserIntentCandidate(null);
    localStorage.removeItem(draftStorageKey);
    localStorage.removeItem(blockDraftStorageKey);
    setComposerBlocks([]);
    setComposerOpen(false);
  }, [draftStorageKey, blockDraftStorageKey]);

  const appendImageAttachments = useCallback(async (
    files: File[],
    source: ImageAttachment['source'],
  ) => {
    if (files.length === 0) {
      return;
    }

    try {
      const nextAttachments = await Promise.all(files.map((file) => fileToImageAttachment(file, source)));
      setAttachments((current) => [...current, ...nextAttachments]);
      addNotification('success', `${t('chat.imagesAdded')}: ${nextAttachments.length}`);
    } catch (error) {
      addNotification('error', `${t('chat.imagesAddFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [addNotification]);

  const sendAsRegularChat = useCallback(async (message: string, messageAttachments: ImageAttachment[], rawInput?: string) => {
    setIsSubmitting(true);
    try {
      const targetSessionId = await resolveChatTargetSessionId(
        currentSessionId,
        () => startNewChatFlow('chat-input'),
      );
      if (!targetSessionId) {
        return;
      }

      onSend?.(message);
      await sendMessage(message, targetSessionId, { attachments: messageAttachments });
      // Only clear draft after successful send
      clearInputDraft();
    } catch (error) {
      // Preserve input on failure so user can retry
      console.error('[ChatInput] sendMessage failed, preserving input:', error);
      setInput(rawInput !== undefined ? rawInput : message);
      setAttachments(messageAttachments);
    } finally {
      setIsSubmitting(false);
    }
  }, [clearInputDraft, currentSessionId, onSend, sendMessage]);

  const sendToBrowserWorkflow = useCallback(async (message: string) => {
    setIsSubmitting(true);
    try {
      const handled = await handleChatBrowserWorkflow(message);
      if (shouldClearDraftAfterBrowserWorkflow(handled)) {
        clearInputDraft();
      } else if (!handled) {
        // Browser handoff declined — preserve input and show fallback prompt
        setInput(message);
        setBrowserIntentCandidate(message);
      }
      return handled;
    } catch (error) {
      console.error('[ChatInput] Failed to hand off browser workflow:', error);
      // Preserve input and re-show intent confirm so user can choose "send as normal"
      setInput(message);
      setBrowserIntentCandidate(message);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [clearInputDraft]);

  const submitOutboundMessage = useCallback(async (compiledOverride?: string) => {
    const promptContext = {
      projectFolder: projectDir ?? undefined,
      pipiOutputDir: pipiOutputDir ?? undefined,
    };
    const message = compiledOverride ?? resolveComposerSubmitMessage({
      composerOpen,
      composerBlocks,
      input,
      context: promptContext,
    });

    if (!message) {
      return;
    }

    const messageAttachments = compiledOverride !== undefined ? [] : attachments;
    const rawInput = input.trim();

    if (submitMode === 'callback-only') {
      if (isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      try {
        await onSend?.(message, messageAttachments);
        clearInputDraft();
      } catch (error) {
        console.error('[ChatInput] callback-only onSend failed, preserving input:', error);
        setInput(rawInput);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const decision = decideChatInputSubmission({
      input: message,
      hasAttachments: messageAttachments.length > 0,
      isStreaming,
      isSubmitting,
      isBrowserIntent: quickCheckBrowserIntent,
    });

    if (decision.type === 'noop') {
      return;
    }

    if (decision.type === 'confirm-browser') {
      setBrowserIntentCandidate((current) => current === decision.message ? current : decision.message);
      return;
    }

    await sendAsRegularChat(decision.message, messageAttachments, rawInput);
  }, [
    attachments,
    clearInputDraft,
    composerBlocks,
    composerOpen,
    input,
    isStreaming,
    isSubmitting,
    onSend,
    pipiOutputDir,
    projectDir,
    sendAsRegularChat,
    submitMode,
  ]);

  /**
   * Handle message submission
   */
  const handleSubmit = useCallback(async () => {
    const rawMessage = input.trim();
    const hasMeaningfulBlock = composerOpen && hasMeaningfulComposerContent(composerBlocks);
    if (!rawMessage && attachments.length === 0 && !hasMeaningfulBlock) {
      return;
    }

    await submitOutboundMessage();
  }, [attachments.length, composerBlocks, composerOpen, input, submitOutboundMessage]);

  const handleConfirmBrowserIntent = useCallback(async () => {
    if (!browserIntentCandidate || isSubmitting) return;
    await sendToBrowserWorkflow(browserIntentCandidate);
  }, [browserIntentCandidate, isSubmitting, sendToBrowserWorkflow]);

  const handleSendAsNormalMessage = useCallback(async () => {
    const message = browserIntentCandidate ?? input.trim();
    if (!message || isSubmitting) return;
    const rawInput = input.trim();
    let finalMessage = message;
    if (composerOpen && !isCompiledTaskPrompt(message)) {
      finalMessage = resolveComposerSubmitMessage({
        composerOpen,
        composerBlocks,
        input: message,
        context: {
          projectFolder: projectDir ?? undefined,
          pipiOutputDir: pipiOutputDir ?? undefined,
        },
      }) ?? message;
    }
    await sendAsRegularChat(finalMessage, [], rawInput);
  }, [browserIntentCandidate, composerBlocks, composerOpen, input, isSubmitting, pipiOutputDir, projectDir, sendAsRegularChat]);

  const handleCancelBrowserIntent = useCallback(() => {
    if (isSubmitting) return;
    setBrowserIntentCandidate(null);
    textareaRef.current?.focus();
  }, [isSubmitting]);

  /**
   * Handle stop generation
   */
  const handleStop = useCallback(async () => {
    await stopGeneration();
  }, [stopGeneration]);

  /**
   * Handle paste events — convert pasted screenshots into image attachments.
   */
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const hasImage = imageFiles.length > 0;
    if (!hasImage) return; // plain text paste — let browser handle it normally
 
    e.preventDefault(); // stop the tofu characters from being inserted
    void appendImageAttachments(imageFiles, 'paste');
  }, [appendImageAttachments]);

  const handleFileSelection = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    await appendImageAttachments(files, 'upload');
    e.target.value = '';
  }, [appendImageAttachments]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      return;
    }
    e.preventDefault();
    void appendImageAttachments(files, 'upload');
  }, [appendImageAttachments]);


  const isDisabled = isStreaming || isSubmitting;

  return (
    <div className={rootClassName}>
      <div className="max-w-4xl relative">
        {/* Two-folder chips — always visible once a session exists */}
        {currentSession && (
          <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
            <SessionFolderChip
              kind="project"
              value={projectDir ?? null}
              isBinding={isBindingFolder === 'project'}
              onBind={async () => {
                if (!currentSession) return null;
                setIsBindingFolder('project');
                try {
                  return await setSessionProjectDir(currentSession.id);
                } finally {
                  setIsBindingFolder(null);
                }
              }}
              onClear={async () => {
                if (!currentSession) return;
                setIsBindingFolder('project');
                try {
                  await clearSessionProjectDir(currentSession.id);
                } finally {
                  setIsBindingFolder(null);
                }
              }}
            />
            <SessionFolderChip
              kind="output"
              value={pipiOutputDir ?? null}
              isBinding={isBindingFolder === 'output'}
              onBind={async () => {
                if (!currentSession) return null;
                setIsBindingFolder('output');
                try {
                  return await setSessionPipiOutputDir(currentSession.id);
                } finally {
                  setIsBindingFolder(null);
                }
              }}
              onClear={async () => {
                if (!currentSession) return;
                setIsBindingFolder('output');
                try {
                  await clearSessionPipiOutputDir(currentSession.id);
                } finally {
                  setIsBindingFolder(null);
                }
              }}
            />

            {/* Terminal toggle button */}
            {isTauri && (
              <button
                onClick={toggleTerminalPanel}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full
                           border text-xs transition-all duration-150
                           ${terminalPanelVisible
                             ? 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'
                             : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                           }`}
                title={terminalPanelVisible ? t('chat.hideTerminal') : t('chat.showTerminal')}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {t('chat.terminal')}
              </button>
            )}
          </div>
        )}

        {browserIntentCandidate && (
          <BrowserIntentConfirm
            message={browserIntentCandidate}
            isProcessing={isSubmitting}
            onConfirmBrowser={() => { void handleConfirmBrowserIntent(); }}
            onSendNormally={() => { void handleSendAsNormalMessage(); }}
            onCancel={handleCancelBrowserIntent}
          />
        )}

        {composerOpen && (
          <BlockComposer
            blocks={composerBlocks}
            onChange={handleComposerBlocksChange}
            onClose={() => setComposerOpen(false)}
            onUseAsMessage={(compiledPrompt) => {
              setInput(compiledPrompt);
              setComposerBlocks([]);
              setComposerOpen(false);
            }}
            onSend={(compiledPrompt) => {
              void submitOutboundMessage(compiledPrompt);
            }}
            context={{
              projectFolder: projectDir ?? undefined,
              pipiOutputDir: pipiOutputDir ?? undefined,
            }}
            disabled={isDisabled}
            defaultMode={selectedExecutionModeId}
            density={density}
          />
        )}

        {pendingBypassBlocks && (
          <BypassWarningDialog
            profile={EXECUTION_MODES.find((p) => p.id === 'bypass')!}
            onCancel={handleCancelBypass}
            onConfirm={handleConfirmBypass}
          />
        )}

        <div
          className={`${inputShellClassName} ${
          isFocused
            ? 'border-gray-400 ring-2 ring-gray-200 shadow-sm'
            : 'border-gray-200'
          }`}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer?.items ?? []).some((item) => item.type.startsWith('image/'))) {
              e.preventDefault();
            }
          }}
          onDrop={handleDrop}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-3">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5"
                >
                  <img
                    src={buildImageDataUrl(attachment)}
                    alt={attachment.origPath || 'attachment'}
                    className="h-10 w-10 rounded object-cover"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-gray-700">
                      {attachment.origPath || t('chat.imageAttachment')}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {(attachment.bytes / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                    className="text-gray-300 transition-colors hover:text-gray-500"
                    aria-label={t('common.delete')}
                    title={t('common.delete')}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative flex items-end gap-2">
          {/* Text Input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              // Last-resort filter: strip any Apple private-use chars that slipped through
              // beforeinput (e.g. older WKWebView versions that don't fire beforeinput).
              const cleaned = e.target.value.replace(/[\uE000-\uF8FF]/g, '');
              setInput(cleaned);
            }}
            // onBeforeInput: cancel insertText: calls from WKWebView's NSTextInputClient
            // before they write private-use chars (U+F700-U+F703) into the DOM.
            onBeforeInput={(e) => {
              const ie = e.nativeEvent as InputEvent;
              if (ie.data && /[\uE000-\uF8FF]/.test(ie.data)) {
                e.preventDefault();
              }
            }}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                // If we're composing (IME), prevent the Enter key from submitting
                if (isComposingRef.current || e.nativeEvent.isComposing) {
                  return;
                }
                e.preventDefault();
                void handleSubmit();
              }
            }}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { 
              // Delay resetting to false so the KeyDown event for the same Enter key still sees true
              setTimeout(() => { isComposingRef.current = false; }, 100); 
            }}
            placeholder={t('chat.inputPlaceholder')}
            disabled={isDisabled}
            rows={1}
            className={textareaClassName}
            style={{ minHeight: textareaMinHeight }}
          />

          {/* Actions */}
          <div className={actionRowClassName}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { void handleFileSelection(e); }}
            />

            {/* Execution mode dropdown (Ask / Plan / Debug / Agent / Multitask / Bypass) */}
            <ExecutionModeDropdownErrorBoundary>
              <ExecutionModeDropdown
                selectedModeId={selectedExecutionModeId}
                onSelect={handleExecutionModeSelect}
                disabled={isDisabled}
              />
            </ExecutionModeDropdownErrorBoundary>

            {/* Toggle Block Composer button */}
            <button
              type="button"
              onClick={() => setComposerOpen(!composerOpen)}
              disabled={isDisabled}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                composerOpen
                  ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
              title={t('chat.blockComposerToggle') || 'Toggle Block Composer'}
            >
              <span>🧩</span>
              <span>{t('chat.composerLabel') || 'Composer'}</span>
            </button>

            {/* Goal button and Popover */}
            <div className="relative" ref={goalPopoverRef}>
              <button
                type="button"
                data-testid="goal-button"
                data-goal-trigger="true"
                onClick={() => {
                  setGoalPopoverOpen(!goalPopoverOpen);
                  if (!goalPopoverOpen) {
                    setGoalInputText(sessionGoal);
                  }
                }}
                disabled={isDisabled}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  sessionGoal.trim()
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100/70'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                title={sessionGoal.trim() ? `${t('goal.active')}: ${sessionGoal}` : t('goal.setTooltip')}
              >
                {sessionGoal.trim() ? (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                ) : (
                  <svg
                    className="h-3 w-3 text-gray-500"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 016 6h-2a4 4 0 00-4-4V4z" />
                  </svg>
                )}
                <span>{t('goal.label')}</span>
              </button>

              {goalPopoverOpen && (
                <div className="absolute bottom-full mb-2 left-0 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4 max-w-none flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <h3 className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 016 6h-2a4 4 0 00-4-4V4z" />
                      </svg>
                      {t('goal.title')}
                    </h3>
                    {sessionGoal.trim() && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-medium">
                        {t('goal.active')}
                      </span>
                    )}
                  </div>
                  
                  <p className="text-[11px] text-gray-500 leading-normal">
                    {t('goal.description')}
                  </p>

                  <textarea
                    rows={3}
                    className="w-full text-xs border border-gray-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 resize-none placeholder-gray-400"
                    placeholder={t('goal.inputPlaceholder')}
                    value={goalInputText}
                    onChange={(e) => setGoalInputText(e.target.value)}
                  />

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (!currentSessionId) return;
                        clearSessionGoal(currentSessionId);
                        setGoalInputText('');
                        setGoalPopoverOpen(false);
                        addNotification('success', t('goal.clearSuccess'));
                      }}
                      className="px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
                    >
                      {t('goal.clear')}
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setGoalPopoverOpen(false)}
                        className="px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                      >
                        {t('workflow.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!currentSessionId) return;
                          const trimmed = goalInputText.trim();
                          if (trimmed) {
                            setSessionObjective(currentSessionId, trimmed);
                          } else {
                            clearSessionGoal(currentSessionId);
                          }
                          setGoalPopoverOpen(false);
                          addNotification('success', trimmed ? t('goal.saveSuccess') : t('goal.clearSuccess'));
                        }}
                        className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors font-medium shadow-sm"
                      >
                        {t('goal.save')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* MCP toggle button and dropdown */}
            <div className="relative">
              <MCPChatButton />
              <MCPDropdown
                onOpenSettings={() => {
                  setDropdownOpen(false);
                  toggleSettings();
                }}
              />
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              type="button"
              className={`${actionButtonClassName} hover:bg-gray-200 text-gray-500 transition-colors`}
              title={t('chat.addImage')}
            >
              <svg className={actionIconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>

            {/* Open Folder Button */}
            <button
              onClick={handleOpenFolder}
              type="button"
              className={`${actionButtonClassName} hover:bg-gray-200 text-gray-500 transition-colors`}
              title={t('chat.openChatFolder')}
            >
              <svg className={actionIconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </button>

            {/* Send/Stop Button */}
            {isStreaming ? (
              <button
                onClick={handleStop}
                className={`${actionButtonClassName} bg-red-600 hover:bg-red-700 text-white transition-colors`}
                title={t('chat.stop')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={actionIconClassName}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => { void handleSubmit(); }}
                disabled={isDisabled || (attachments.length === 0 && !canSendFromComposer(composerOpen ? composerBlocks : [], input))}
                className={`${actionButtonClassName} bg-gray-900 hover:bg-gray-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                title={t('chat.send')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className={actionIconClassName}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            )}
          </div>
          </div>
        </div>

        {!isCompact && (
          <p className="text-center text-[10px] text-gray-400 mt-2 uppercase tracking-tight font-bold">
            {t('chat.enterHint')} <span className="text-gray-300 mx-1">/</span> {t('chat.newLineHint')}
          </p>
        )}
      </div>
    </div>
  );
}

export default ChatInput;
