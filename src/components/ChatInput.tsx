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
import { useMCPStore } from '@/store/mcpStore';
import { MCPChatButton, MCPDropdown } from '@/components/mcp';
import { BrowserIntentConfirm } from './BrowserIntentConfirm';
import { ExecutionModeDropdown } from './chatInput/ExecutionModeDropdown';
import { ExecutionModeDropdownErrorBoundary } from './chatInput/ExecutionModeDropdownErrorBoundary';
import {
  decideChatInputSubmission,
  isStaleChatDraftValue,
  resolveChatTargetSessionId,
  shouldClearDraftAfterBrowserWorkflow,
  shouldDismissBrowserIntentConfirm,
} from './chatInputFlow';
import { t } from '@/i18n';
import { getDefaultExecutionMode, isExecutionModeId, type ExecutionModeId } from '@/services/executionMode';
import { quickCheckBrowserIntent, handleChatBrowserWorkflow } from '@/utils/chatBrowserBridge';
import type { ImageAttachment } from '@/types/vision';

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
      if (!key || !key.startsWith(draftPrefix) || key.endsWith(timestampSuffix)) {
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
  const [isBindingFolder, setIsBindingFolder] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [browserIntentCandidate, setBrowserIntentCandidate] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const draftStorageKey = `chat_draft_${draftKey}`;
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
    ? 'flex items-center gap-0.5 pr-1 pb-1.5'
    : 'flex items-center gap-1 pr-2 pb-2';
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

  const { isStreaming, sendMessage, stopGeneration, currentSessionId, sessions, setSessionWorkDir, clearSessionWorkDir, updateSessionExecutionMode } = useChatStore();
  const { toggleSettings, addNotification } = useUIStore();
  const { setDropdownOpen } = useMCPStore();
  const toggleTerminalPanel = useUIStore((s) => s.toggleTerminalPanel);
  const terminalPanelVisible = useUIStore((s) => s.terminalPanelVisible);

  // Get current session
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const workDir = currentSession?.workDir;

  // Selected 6-mode execution mode. Fall back to default if missing/invalid.
  const selectedExecutionModeId: ExecutionModeId = isExecutionModeId(currentSession?.executionMode)
    ? (currentSession!.executionMode as ExecutionModeId)
    : getDefaultExecutionMode().id;
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
   * Handle opening the current working directory in Finder
   */
  const handleOpenFolder = useCallback(async () => {
    try {
      let targetPath: string | undefined = workDir;
      if (!targetPath && currentSessionId) {
        targetPath = await safeInvokeOrNull<string>('get_app_default_dir', { sessionId: currentSessionId }, { source: 'ChatInput.getDefaultDir' }) ?? undefined;
      }
      if (targetPath) {
        await safeInvoke('reveal_in_finder', { path: targetPath }, { source: 'ChatInput.openFolder' });
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, [workDir, currentSessionId]);

  const clearInputDraft = useCallback(() => {
    setInput('');
    setAttachments([]);
    setBrowserIntentCandidate(null);
    localStorage.removeItem(draftStorageKey);
  }, [draftStorageKey]);

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

  const sendAsRegularChat = useCallback(async (message: string, messageAttachments: ImageAttachment[]) => {
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
      setInput(message);
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

  /**
   * Handle message submission
   */
  const handleSubmit = useCallback(async () => {
    if (submitMode === 'callback-only') {
      const message = input.trim();
      if (!message || isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      try {
        await onSend?.(message, attachments);
        clearInputDraft();
      } catch (error) {
        console.error('[ChatInput] callback-only onSend failed, preserving input:', error);
        setInput(message);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const decision = decideChatInputSubmission({
      input,
      hasAttachments: attachments.length > 0,
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

    await sendAsRegularChat(decision.message, attachments);
  }, [attachments, clearInputDraft, input, isStreaming, isSubmitting, onSend, sendAsRegularChat, submitMode]);

  const handleConfirmBrowserIntent = useCallback(async () => {
    if (!browserIntentCandidate || isSubmitting) return;
    await sendToBrowserWorkflow(browserIntentCandidate);
  }, [browserIntentCandidate, isSubmitting, sendToBrowserWorkflow]);

  const handleSendAsNormalMessage = useCallback(async () => {
    const message = browserIntentCandidate ?? input.trim();
    if (!message || isSubmitting) return;
    await sendAsRegularChat(message, []);
  }, [browserIntentCandidate, input, isSubmitting, sendAsRegularChat]);

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
        {/* MCP server dropdown — positioned relative to this container */}
        <MCPDropdown
          onOpenSettings={() => {
            setDropdownOpen(false);
            toggleSettings();
          }}
        />
        {/* Work Dir chip — shown only when session has messages (conversation started) */}
        {currentSession && currentSession.messages.length > 0 && (
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            {workDir ? (
              // Has work dir — show path chip
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full
                              bg-gray-100 border border-gray-200/80
                              text-xs text-gray-600
                              hover:bg-gray-50 transition-colors group">
                {/* Folder icon */}
                <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>

                {/* Show only last folder name for brevity */}
                <span className="truncate max-w-[180px]">
                  {workDir.split('/').pop() ?? workDir}
                </span>

                {/* Subtle full path tooltip */}
                <span className="hidden group-hover:inline text-gray-400 text-[10px] truncate max-w-[120px]">
                  .pipi-shrimp/
                </span>

                {/* Open source folder in Finder */}
                <button
                  onClick={() => safeInvokeOrNull('reveal_in_finder', { path: workDir }, { source: 'ChatInput.openSourceFolder' })}
                  className="text-gray-400 hover:text-blue-500 transition-colors ml-0.5"
                  title={`${t('chat.openSourceFolder')}: ${workDir}`}
                  aria-label={t('chat.openSourceFolder')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>

                {/* Open .pipi-shrimp output folder in Finder */}
                <button
                  onClick={() => safeInvokeOrNull('reveal_in_finder', { path: `${workDir}/.pipi-shrimp` }, { source: 'ChatInput.openOutputFolder' })}
                  className="text-gray-400 hover:text-purple-500 transition-colors"
                  title={`${t('chat.openOutputFolder')}: ${workDir}/.pipi-shrimp`}
                  aria-label={t('chat.openOutputFolder')}
                >
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                </button>

                {/* Change button */}
                <button
                  onClick={async () => {
                    setIsBindingFolder(true);
                    try {
                      await setSessionWorkDir(currentSession.id);
                    } finally {
                      setIsBindingFolder(false);
                    }
                  }}
                  disabled={isBindingFolder}
                  className="ml-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[10px] font-medium"
                  title={t('chat.changeWorkDirectory')}
                >
                  {isBindingFolder ? t('chat.binding') : t('common.change')}
                </button>

                {/* Remove button */}
                <button
                  onClick={async () => {
                    setIsBindingFolder(true);
                    try {
                      await clearSessionWorkDir(currentSession.id);
                    } finally {
                      setIsBindingFolder(false);
                    }
                  }}
                  disabled={isBindingFolder}
                  className="text-gray-300 hover:text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-0.5"
                  title={t('chat.removeWorkDirectory')}
                  aria-label={t('chat.removeWorkDirectory')}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              // No work dir — show quiet "bind folder" prompt
              <button
                onClick={async () => {
                  setIsBindingFolder(true);
                  try {
                    await setSessionWorkDir(currentSession.id);
                  } finally {
                    setIsBindingFolder(false);
                  }
                }}
                disabled={isBindingFolder}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full
                           border border-dashed border-gray-200
                           text-xs text-gray-400
                           hover:border-gray-300 hover:text-gray-600
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all duration-150"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                {isBindingFolder ? t('chat.binding') : t('chat.bindWorkFolder')}
              </button>
            )}

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

            {/* MCP toggle button */}
            <MCPChatButton />

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
                disabled={isDisabled || (!input.trim() && attachments.length === 0)}
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
