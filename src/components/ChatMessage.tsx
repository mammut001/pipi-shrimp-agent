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

import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Message } from '@/types/chat';
import { t } from '@/i18n';

/**
 * Props for ChatMessage component
 */
interface ChatMessageProps {
  /** The message to display */
  message: Message;
  /** Whether this is the latest message (may show loading animation) */
  isLatest?: boolean;
  /** Whether the message is currently streaming */
  isStreaming?: boolean;
  /** Callback when user clicks preview on a Typst code block */
  onTypstPreview?: (code: string) => void;
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
export const ChatMessage = memo(function ChatMessage({ message, isLatest = false, isStreaming = false, onTypstPreview }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`py-4 px-4 ${isUser ? 'bg-gray-50' : 'bg-white'}`}
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
                {isUser ? 'You' : 'pipi-shrimp-agent'}
              </span>
              <span className="text-xs text-gray-400">
                {formatTimestamp(message.timestamp)}
              </span>
            </div>

            {/* AI Reasoning Block */}
            {!isUser && message.reasoning && (
              <ReasoningBlock content={message.reasoning} isStreaming={isStreaming} />
            )}

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
                      const language = match?.[1];
                      const isTypst = language === 'typst';
                      const codeContent = String(children).replace(/\n$/, '');

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
                        <div className="my-2 rounded-lg overflow-hidden relative group">
                          {/* Header with language and preview button */}
                          <div className="bg-gray-800 text-gray-300 px-4 py-1 text-xs flex items-center justify-between">
                            <span>{language}</span>
                            {isTypst && onTypstPreview && (
                              <button
                                onClick={() => onTypstPreview(codeContent)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs flex items-center gap-1"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-3 w-3"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                  <path
                                    fillRule="evenodd"
                                    d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                                Preview
                              </button>
                            )}
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
            {isLatest && !isUser && message.content === '' && !message.reasoning && (
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
                <span className="text-sm">{t('chat.thinking')}</span>
              </div>
            )}

            {/* Token usage display for assistant messages */}
            {!isUser && message.token_usage && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span>输入: {message.token_usage.input_tokens.toLocaleString()}</span>
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  <span>输出: {message.token_usage.output_tokens.toLocaleString()}</span>
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                  <span>总计: {(message.token_usage.input_tokens + message.token_usage.output_tokens).toLocaleString()}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
/**
 * ReasoningBlock - Redesigned think bubble component
 *
 * Features (per design doc):
 * - Default collapsed (idle state), auto-expand when streaming
 * - Provider badge and status indicator
 * - Collapsible content with max-height + scroll
 * - Copy button for reasoning content
 * - Clean visual hierarchy that doesn't compete with main answer
 */

/** Provider badge component */
function ProviderBadge({ source }: { source?: string }) {
  if (!source) return null;

  const label = source === 'anthropic' ? 'Anthropic' :
                source === 'minimax' ? 'MiniMax' :
                source === 'openai' ? 'OpenAI' :
                source === 'gemini' ? 'Gemini' : source;

  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
      {label}
    </span>
  );
}

/** Reasoning header - shows status, provider, char count, and expand arrow */
function ReasoningHeader({
  isStreaming,
  charCount,
  provider
}: {
  isStreaming: boolean;
  charCount: number;
  provider?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* Status indicator */}
      {isStreaming ? (
        <span className="flex gap-1">
          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
        </span>
      ) : (
        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      )}

      {/* Label */}
      <span className="text-sm text-gray-500">
        {isStreaming ? t('chat.aiThinking') : t('chat.thinking')}
      </span>

      {/* Provider badge */}
      <ProviderBadge source={provider} />

      {/* Char count */}
      <span className="text-xs text-gray-400">
        {charCount > 1000 ? `${(charCount / 1000).toFixed(1)}K` : charCount} chars
      </span>
    </div>
  );
}

/** Reasoning body - scrollable content with copy button */
function ReasoningBody({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="relative mt-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header with copy button */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Reasoning
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
          title="Copy reasoning"
        >
          {copied ? (
            <>
              <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* Content area */}
      <div className="max-h-64 overflow-y-auto">
        <pre className="p-3 text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
          {content}
          {isStreaming && <span className="inline-block w-1.5 h-4 ml-1 bg-blue-400 animate-pulse align-middle" />}
        </pre>
      </div>
    </div>
  );
}

/** Main ReasoningBlock component */
function ReasoningBlock({
  content,
  isStreaming,
  provider
}: {
  content: string;
  isStreaming?: boolean;
  provider?: string;
}) {
  // Default to collapsed, expand when streaming
  return (
    <details
      className="mt-3 cursor-pointer group"
      open={isStreaming ? true : undefined}
    >
      <summary className="flex items-center justify-between gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors py-2 list-none marker:hidden rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50">
        <ReasoningHeader
          isStreaming={!!isStreaming}
          charCount={content.length}
          provider={provider}
        />
        <svg
          className="w-4 h-4 transform transition-transform duration-200 text-gray-400 group-open:rotate-180 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <ReasoningBody content={content} isStreaming={!!isStreaming} />
    </details>
  );
}

export default ChatMessage;
