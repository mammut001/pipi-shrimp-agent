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
import { useChatStore, useUIStore } from '@/store';
import { resolveComposerSendStopAffordance } from '@/store/chat/chatSelectors';
import { useMCPStore } from '@/store/mcpStore';
import { BrowserIntentConfirm } from './BrowserIntentConfirm';
import { SessionFolderBar } from './chatInput/SessionFolderBar';
import { ComposerActionToolbar } from './chatInput/ComposerActionToolbar';
import { ImageAttachmentChips } from './chatInput/ImageAttachmentChips';
import { hasImageItems } from './chatInput/imageAttachmentInput';
import {
  DRAFT_PERSIST_DEBOUNCE_MS,
  cleanupOldDrafts,
  persistTextDraft,
  readTextDraft,
} from './chatInput/draftPersistence';
import { useBlockComposerWiring } from './chatInput/blockComposerWiring';
import { resolveComposerDensityStyles } from './chatInput/composerDensity';
import { useChatInputImageAttachments } from './chatInput/useChatInputImageAttachments';
import { useSessionGoalComposerBindings } from './chatInput/useSessionGoalComposerBindings';
import { useSessionFolderBindings } from './chatInput/useSessionFolderBindings';
import { useChatInputSubmission } from './chatInput/useChatInputSubmission';
import { t } from '@/i18n';
import { resolveSessionExecutionModeId, type ExecutionModeId } from '@/services/executionMode';
import type { ImageAttachment } from '@/types/vision';
import type { ComposerBlock } from './chatInput/blocks/types';
import { canSendFromComposer } from './chatInput/blocks/promptBuilder';

// Check if running inside Tauri
const isTauri = !!(window as any).__TAURI__;

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
  /** Legacy block-composer props are retained for compatibility only. */
  defaultComposerOpen?: boolean;
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
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const draftStorageKey = `chat_draft_${draftKey}`;
  const blockDraftStorageKey = `chat_blocks_draft_${draftKey}`;
  const {
    isCompact,
    textareaMaxHeight,
    textareaMinHeight,
    rootClassName,
    inputShellClassName,
    textareaClassName,
    actionRowClassName,
    actionButtonClassName,
    actionIconClassName,
  } = resolveComposerDensityStyles(density);

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
    pendingToolCalls,
    pendingToolResults,
    sendMessage,
    stopGeneration,
    currentSessionId,
    sessions,
    updateSessionExecutionMode,
  } = useChatStore();
  const sendStopAffordance = resolveComposerSendStopAffordance({
    isStreaming,
    pendingToolCalls,
    pendingToolResultsLength: pendingToolResults.length,
  });
  const showStopControl = sendStopAffordance.showStop;
  const { toggleSettings, addNotification } = useUIStore();
  const { setDropdownOpen } = useMCPStore();
  const toggleTerminalPanel = useUIStore((s) => s.toggleTerminalPanel);
  const terminalPanelVisible = useUIStore((s) => s.terminalPanelVisible);
  const {
    goalPopoverOpen,
    setGoalPopoverOpen,
    goalInputText,
    setGoalInputText,
    sessionGoal,
    handleClearGoal,
    handleSaveGoal,
  } = useSessionGoalComposerBindings({
    currentSessionId,
    addNotification,
  });

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

  // Selected execution mode. Resolve from persisted id or legacy
  // permission_mode so the dropdown matches what chatActions will use.
  const selectedExecutionModeId: ExecutionModeId = resolveSessionExecutionModeId(currentSession);
  const handleExecutionModeSelect = useCallback(
    (modeId: ExecutionModeId) => {
      if (!currentSessionId) return;
      void updateSessionExecutionMode(currentSessionId, modeId);
    },
    [currentSessionId, updateSessionExecutionMode],
  );

  // Main chat no longer exposes BlockComposer UI; keep inert wiring (legacy draft
  // clear + mode sync / bypass helpers) for shared AutoResearch surfaces.
  const {
    composerOpen,
    composerBlocks,
    resetComposer,
  } = useBlockComposerWiring({
    blockDraftStorageKey,
    selectedExecutionModeId,
    currentSessionId,
    updateSessionExecutionMode,
  });

  const {
    isBindingFolder,
    handleBindProject,
    handleClearProject,
    handleBindOutput,
    handleClearOutput,
    handleOpenFolder,
  } = useSessionFolderBindings({
    currentSession,
    projectDir,
  });

  // Restore draft from localStorage on mount
  useEffect(() => {
    const saved = readTextDraft(draftStorageKey);
    if (saved) setInput(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStorageKey]);

  // AUDIT-FIX [audit-1#6] — Persist the draft with a short debounce via
  // persistTextDraft (timestamp + silent full/disabled degrade).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      persistTextDraft(draftStorageKey, input);
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [input, draftStorageKey]);

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

  const {
    handlePaste,
    handleFileSelection,
    handleDrop,
  } = useChatInputImageAttachments({
    setAttachments,
    addNotification,
  });

  const {
    isSubmitting,
    browserIntentCandidate,
    handleSubmit,
    handleConfirmBrowserIntent,
    handleSendAsNormalMessage,
    handleCancelBrowserIntent,
  } = useChatInputSubmission({
    input,
    setInput,
    attachments,
    setAttachments,
    draftStorageKey,
    blockDraftStorageKey,
    resetComposer,
    composerOpen,
    composerBlocks,
    projectDir,
    pipiOutputDir,
    currentSessionId,
    onSend,
    submitMode,
    showStopControl,
    sendMessage,
    textareaRef,
  });

  /**
   * Handle stop generation
   */
  const handleStop = useCallback(async () => {
    await stopGeneration();
  }, [stopGeneration]);

  const isDisabled = showStopControl || isSubmitting;

  return (
    <div className={rootClassName}>
      <div className="max-w-4xl relative">
        {/* Two-folder chips — always visible once a session exists */}
        {currentSession && (
          <SessionFolderBar
            currentSession={currentSession}
            projectDir={projectDir}
            pipiOutputDir={pipiOutputDir}
            isBindingFolder={isBindingFolder}
            onBindProject={handleBindProject}
            onClearProject={handleClearProject}
            onBindOutput={handleBindOutput}
            onClearOutput={handleClearOutput}
            terminalPanelVisible={terminalPanelVisible}
            onToggleTerminal={toggleTerminalPanel}
            showTerminal={isTauri}
          />
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

        <div
          className={`${inputShellClassName} ${
          isFocused
            ? 'border-gray-400 ring-2 ring-gray-200 shadow-sm'
            : 'border-gray-200'
          }`}
          onDragOver={(e) => {
            if (hasImageItems(e.dataTransfer)) {
              e.preventDefault();
            }
          }}
          onDrop={handleDrop}
        >
          <ImageAttachmentChips
            attachments={attachments}
            onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
          />

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
          <ComposerActionToolbar
            density={density}
            actionRowClassName={actionRowClassName}
            actionButtonClassName={actionButtonClassName}
            actionIconClassName={actionIconClassName}
            fileInputRef={fileInputRef}
            onFileSelection={handleFileSelection}
            selectedExecutionModeId={selectedExecutionModeId}
            onSelectExecutionMode={handleExecutionModeSelect}
            goalPopoverOpen={goalPopoverOpen}
            onGoalPopoverOpenChange={setGoalPopoverOpen}
            sessionGoal={sessionGoal}
            goalInputText={goalInputText}
            onGoalInputChange={setGoalInputText}
            hasSession={Boolean(currentSessionId)}
            onClearGoal={handleClearGoal}
            onSaveGoal={handleSaveGoal}
            onOpenSettings={() => {
              setDropdownOpen(false);
              toggleSettings();
            }}
            onOpenFolder={handleOpenFolder}
            showStopControl={showStopControl}
            sendStopAffordance={sendStopAffordance}
            isDisabled={isDisabled}
            canSend={attachments.length > 0 || canSendFromComposer(composerOpen ? composerBlocks : [], input)}
            onSend={handleSubmit}
            onStop={handleStop}
          />
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
