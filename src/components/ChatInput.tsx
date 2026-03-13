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

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useChatStore } from '@/store';

/**
 * Props for ChatInput component
 */
interface ChatInputProps {
  /** Optional callback when message is sent */
  onSend?: (message: string) => void;
}

/**
 * Chat input component
 */
export function ChatInput({ onSend }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isStreaming, sendMessage, currentSessionId, startSession } = useChatStore();

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
   * Handle message submission
   */
  const handleSubmit = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isStreaming) return;

    // Create session if none exists
    if (!currentSessionId) {
      await startSession();
    }

    // Clear input and send message
    setInput('');
    onSend?.(trimmedInput);
    await sendMessage(trimmedInput);
  };

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isDisabled = isStreaming;

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end gap-2 bg-gray-50 rounded-xl border border-gray-200 focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-gray-100 transition-all">
          {/* Text Input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={isDisabled}
            rows={1}
            className="flex-1 bg-transparent px-4 py-3 max-h-[200px] resize-none focus:outline-none text-gray-900 placeholder-gray-400 disabled:opacity-50"
            style={{ minHeight: '48px' }}
          />

          {/* Actions */}
          <div className="flex items-center gap-1 pr-2 pb-2">
            {/* File Upload Button (Optional) */}
            <button
              type="button"
              disabled={isDisabled}
              className="p-2 rounded-lg hover:bg-gray-200 text-gray-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Attach file"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Send Button */}
            <button
              onClick={handleSubmit}
              disabled={isDisabled || !input.trim()}
              className="p-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Send message"
            >
              {isStreaming ? (
                <svg
                  className="h-5 w-5 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Hint */}
        <p className="text-center text-xs text-gray-400 mt-2">
          Press <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">Enter</kbd> to send,{' '}
          <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">Shift + Enter</kbd> for new line
        </p>
      </div>
    </div>
  );
}

export default ChatInput;
