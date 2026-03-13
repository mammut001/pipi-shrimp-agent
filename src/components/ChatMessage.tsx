/**
 * ChatMessage - Single chat message component
 *
 * Features:
 * - Different styles for user/assistant messages
 * - Markdown rendering (react-markdown)
 * - Code block syntax highlighting
 * - Artifact inline links
 * - Timestamp display
 */

import { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Message } from '@/types/chat';

/**
 * Props for ChatMessage component
 */
interface ChatMessageProps {
  /** The message to display */
  message: Message;
  /** Whether this is the latest message (may show loading animation) */
  isLatest?: boolean;
}

/**
 * Format timestamp for display
 */
const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Single chat message component
 */
export function ChatMessage({ message, isLatest = false }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (isLatest && contentRef.current) {
      contentRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [message.content, isLatest]);

  return (
    <div
      ref={contentRef}
      className={`py-4 px-4 ${isUser ? 'bg-gray-50' : 'bg-white'}`}
    >
      <div className="max-w-3xl mx-auto">
        <div className="flex gap-4">
          {/* Avatar */}
          <div
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              isUser
                ? 'bg-gray-200 text-gray-600'
                : 'bg-blue-500 text-white'
            }`}
          >
            {isUser ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
                <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
              </svg>
            )}
          </div>

          {/* Message Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-gray-900">
                {isUser ? 'You' : 'AI Agent'}
              </span>
              <span className="text-xs text-gray-400">
                {formatTimestamp(message.timestamp)}
              </span>
            </div>

            {/* Message Body */}
            <div className="prose prose-sm max-w-none">
              {isUser ? (
                // User messages: plain text
                <p className="text-gray-700 whitespace-pre-wrap">{message.content}</p>
              ) : (
                // Assistant messages: markdown
                <ReactMarkdown
                  components={{
                    // Custom code block rendering
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const isInline = !match;

                      if (isInline) {
                        return (
                          <code
                            className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-800 text-sm"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      }

                      return (
                        <div className="my-2 rounded-lg overflow-hidden">
                          <div className="bg-gray-800 text-gray-300 px-4 py-1 text-xs">
                            {match[1]}
                          </div>
                          <pre className="bg-gray-800 text-gray-100 p-4 overflow-x-auto">
                            <code className={className} {...props}>
                              {children}
                            </code>
                          </pre>
                        </div>
                      );
                    },
                    // Custom link rendering
                    a({ href, children, ...props }) {
                      return (
                        <a
                          href={href}
                          className="text-blue-600 hover:underline"
                          target="_blank"
                          rel="noopener noreferrer"
                          {...props}
                        >
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              )}

              {/* Artifacts */}
              {message.artifacts && message.artifacts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.artifacts.map((artifact) => (
                    <a
                      key={artifact.id}
                      href={`#artifact-${artifact.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-sm hover:bg-blue-100 transition-colors"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {artifact.title || artifact.type}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Loading indicator for latest message */}
            {isLatest && !isUser && message.content === '' && (
              <div className="mt-2 flex items-center gap-2 text-gray-400">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <span
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0.1s' }}
                  />
                  <span
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0.2s' }}
                  />
                </div>
                <span className="text-sm">Thinking...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatMessage;
