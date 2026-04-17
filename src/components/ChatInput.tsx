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
import { invoke } from '@tauri-apps/api/core';
import { useChatStore } from '@/store';
import { useUIStore } from '@/store';
import { useMCPStore } from '@/store/mcpStore';
import { MCPChatButton, MCPDropdown } from '@/components/mcp';
import { t } from '@/i18n';
import { quickCheckBrowserIntent, handleChatBrowserWorkflow } from '@/utils/chatBrowserBridge';

// Check if running inside Tauri
const isTauri = !!(window as any).__TAURI__;

/**
 * Props for ChatInput component
 */
interface ChatInputProps {
  /** Optional callback when message is sent */
  onSend?: (message: string) => void;
  /** Optional callback when user sends message but no session exists */
  onNewSessionRequired?: (message: string) => void;
  /** Key used to namespace the draft in localStorage (default: 'default') */
  draftKey?: string;
}

/**
 * Chat input component
 */
export function ChatInput({ onSend, onNewSessionRequired, draftKey = 'default' }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [isBindingFolder, setIsBindingFolder] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  const { isStreaming, sendMessage, stopGeneration, currentSessionId, startSession, sessions, setSessionWorkDir, clearSessionWorkDir } = useChatStore();
  const { toggleSettings } = useUIStore();
  const { setDropdownOpen } = useMCPStore();
  const toggleTerminalPanel = useUIStore((s) => s.toggleTerminalPanel);
  const terminalPanelVisible = useUIStore((s) => s.terminalPanelVisible);

  // Get current session
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const workDir = currentSession?.workDir;

  // Restore draft from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(`chat_draft_${draftKey}`);
    if (saved) setInput(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Persist draft to localStorage whenever input changes
  useEffect(() => {
    if (input) {
      localStorage.setItem(`chat_draft_${draftKey}`, input);
    } else {
      localStorage.removeItem(`chat_draft_${draftKey}`);
    }
  }, [input, draftKey]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Auto-focus on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  /**
   * Handle opening the current working directory in Finder
   */
  const handleOpenFolder = useCallback(async () => {
    try {
      let targetPath = workDir;
      if (!targetPath && currentSessionId) {
        try {
          targetPath = await invoke<string>('get_app_default_dir', { sessionId: currentSessionId });
        } catch (e) {
          console.error("Failed to get default dir:", e);
        }
      }
      if (targetPath) {
        await invoke('reveal_in_finder', { path: targetPath });
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, [workDir, currentSessionId]);

  /**
   * Handle message submission
   */
  const handleSubmit = useCallback(async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isStreaming) return;

    const finalMessage = trimmedInput;

    // Quick check for browser intent before creating session
    const mightBeBrowser = quickCheckBrowserIntent(finalMessage);

    // Browser workflow should be able to start from the empty-chat entry flow.
    // Route browser intents before the new-session modal early-return path.
    if (mightBeBrowser) {
      // Clear input state first so browser workflows feel the same as normal sends
      setInput('');

      const handled = await handleChatBrowserWorkflow(finalMessage);
      if (handled) {
        return;
      }
    }

    // Ensure session exists before sending
    if (!currentSessionId) {
      // 如果有回调函数，调用它来显示 project 选择模态框
      if (onNewSessionRequired) {
        onNewSessionRequired(finalMessage);
        setInput('');
        return;
      }
      // 否则直接创建 session（向后兼容）
      await startSession();
    }

    // Clear input state and draft
    setInput('');
    localStorage.removeItem(`chat_draft_${draftKey}`);

    // Send to AI (browser is controlled manually or via AI tools, not by client-side regex)
    onSend?.(finalMessage);
    await sendMessage(finalMessage);
  }, [input, isStreaming, currentSessionId, onNewSessionRequired, startSession, draftKey, onSend, sendMessage]);

  /**
   * Handle stop generation
   */
  const handleStop = useCallback(async () => {
    await stopGeneration();
  }, [stopGeneration]);


  const isDisabled = isStreaming;

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="max-w-3xl mx-auto relative">
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
                  onClick={() => invoke('reveal_in_finder', { path: workDir }).catch(console.error)}
                  className="text-gray-400 hover:text-blue-500 transition-colors ml-0.5"
                  title={`Open source folder: ${workDir}`}
                  aria-label="Open source folder in Finder"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>

                {/* Open .pipi-shrimp output folder in Finder */}
                <button
                  onClick={() => invoke('reveal_in_finder', { path: `${workDir}/.pipi-shrimp` }).catch(console.error)}
                  className="text-gray-400 hover:text-purple-500 transition-colors"
                  title={`Open output folder: ${workDir}/.pipi-shrimp`}
                  aria-label="Open .pipi-shrimp folder in Finder"
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
                  title="Change work directory"
                >
                  {isBindingFolder ? 'binding...' : 'change'}
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
                  title="Remove work directory"
                  aria-label="Remove work directory"
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
                {isBindingFolder ? 'binding...' : 'Bind work folder'}
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
                title={terminalPanelVisible ? 'Hide Terminal' : 'Show Terminal'}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Terminal
              </button>
            )}
          </div>
        )}

        <div className={`relative flex items-end gap-2 bg-gray-50 rounded-xl border transition-all px-4 ${
          isFocused
            ? 'border-gray-400 ring-2 ring-gray-200 shadow-sm'
            : 'border-gray-200'
        }`}>
          {/* Text Input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                // If we're composing (IME), prevent the Enter key from submitting
                if (isComposingRef.current || e.nativeEvent.isComposing) {
                  return;
                }
                e.preventDefault();
                handleSubmit();
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
            className="flex-1 bg-transparent px-0 py-3 max-h-[200px] resize-none focus:outline-none text-gray-900 placeholder-gray-400 disabled:opacity-50"
            style={{ minHeight: '48px' }}
          />

          {/* Actions */}
          <div className="flex items-center gap-1 pr-2 pb-2">
            {/* MCP toggle button */}
            <MCPChatButton />

            {/* Open Folder Button */}
            <button
              onClick={handleOpenFolder}
              type="button"
              className="p-2 rounded-lg hover:bg-gray-200 text-gray-500 transition-colors"
              title="Open chat folder"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </button>

            {/* Send/Stop Button */}
            {isStreaming ? (
              <button
                onClick={handleStop}
                className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
                title={t('chat.stop')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
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
                onClick={handleSubmit}
                disabled={isDisabled || !input.trim()}
                className="p-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('chat.send')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Hint */}
        <p className="text-center text-[10px] text-gray-400 mt-2 uppercase tracking-tight font-bold">
          Enter <span className="text-gray-300 mx-1">/</span> Shift + Enter for new line
        </p>
      </div>
    </div>
  );
}

export default ChatInput;
