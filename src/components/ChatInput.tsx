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

import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from 'react';
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
  const [references, setReferences] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isStreaming, sendMessage, stopGeneration, currentSessionId, startSession } = useChatStore();

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input, references]);

  // Auto-focus on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Handle file attachment - trigger hidden file input
   */
  const handleAttachFile = () => {
    fileInputRef.current?.click();
  };

  /**
   * Handle file selection from native file input
   */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // In Tauri, files have a .path property
      const path = (file as unknown as { path?: string }).path || file.name;
      paths.push(path);
    }
    setReferences(prev => [...prev, ...paths]);

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  /**
   * Remove a file reference
   */
  const removeReference = (path: string) => {
    setReferences(prev => prev.filter(p => p !== path));
  };

  /**
   * Handle message submission
   */
  const handleSubmit = async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && references.length === 0) || isStreaming) return;

    // Build the message with references
    let finalMessage = trimmedInput;
    if (references.length > 0) {
      const refText = references.map(p => `[File Reference: ${p}]`).join('\n');
      finalMessage = `${refText}\n\n${trimmedInput}`;
    }

    // Create session if none exists
    if (!currentSessionId) {
      await startSession();
    }

    // Clear state
    setInput('');
    setReferences([]);
    
    // Send message
    onSend?.(finalMessage);
    await sendMessage(finalMessage);
  };

  /**
   * Handle stop generation
   */
  const handleStop = async () => {
    await stopGeneration();
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
        {/* References list */}
        {references.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {references.map((path) => (
              <div 
                key={path} 
                className="flex items-center gap-1.5 bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-1 rounded-full border border-blue-100 group animate-in slide-in-from-bottom-1 duration-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
                <span className="max-w-[150px] truncate">{path.split('/').pop()}</span>
                <button 
                  onClick={() => removeReference(path)}
                  className="p-0.5 hover:bg-blue-200 rounded-full transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex items-end gap-2 bg-gray-50 rounded-xl border border-gray-200 focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-gray-100 transition-all">
          {/* Text Input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={references.length > 0 ? "Ask about the attached files..." : "Type a message..."}
            disabled={isDisabled}
            rows={1}
            className="flex-1 bg-transparent px-4 py-3 max-h-[200px] resize-none focus:outline-none text-gray-900 placeholder-gray-400 disabled:opacity-50"
            style={{ minHeight: '48px' }}
          />

          {/* Hidden file input for native file selection */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Actions */}
          <div className="flex items-center gap-1 pr-2 pb-2">
            {/* File Upload Button (Optional) */}
            <button
              onClick={handleAttachFile}
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

            {/* Send/Stop Button */}
            {isStreaming ? (
              <button
                onClick={handleStop}
                className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
                title="Stop generation"
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
                disabled={isDisabled || (!input.trim() && references.length === 0)}
                className="p-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Send message"
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
