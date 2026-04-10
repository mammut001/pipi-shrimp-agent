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
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import DOMPurify from 'dompurify';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '@/types/chat';
import { t } from '@/i18n';
import { ChatImage } from './ChatImage';
import { useUIStore } from '@/store';

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
    <div className={`py-4 px-4 max-w-full overflow-hidden ${isUser ? 'bg-gray-50' : 'bg-white'}`}
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
            <div className="prose prose-sm max-w-none break-words">
              {isUser ? (
                /* User messages: plain text or Tool Results */
                <MessageContent content={message.content} />
              ) : (
                /* Assistant messages: markdown */
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
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

                      if (language === 'svg') {
                        return <ChatImage src={codeContent} isSVG alt="SVG Preview" />;
                      }

                      return (
                        <div className="my-4 rounded-xl overflow-hidden border border-gray-200/20 shadow-xl relative group max-w-full">
                          {/* Header with language and preview button */}
                          <div className="bg-[#1e1e1e] border-b border-gray-800 text-gray-400 px-4 py-1.5 text-xs flex items-center justify-between">
                            <span className="font-mono tracking-tighter opacity-70">{language || 'code'}</span>
                            <div className="flex items-center gap-2">
                              {isTypst && onTypstPreview && (
                                <button
                                  onClick={() => onTypstPreview(codeContent)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/20 rounded-md text-[10px] flex items-center gap-1.5 backdrop-blur-sm"
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
                                  {t('common.preview')}
                                </button>
                              )}
                              <button
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(codeContent);
                                    // Add a little temporary indicator or notification here if needed
                                  } catch (err) {
                                    console.error('Failed to copy code:', err);
                                  }
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-500 hover:text-gray-300"
                                title={t('common.copy')}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                                  <path d="M6 3a2 2 0 00-2 2v1h11a2 2 0 012 2v1a2 2 0 01-2 2V5a2 2 0 00-2-2H6z" />
                                  <path d="M3 7a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          
                          <SyntaxHighlighter
                            language={language || 'text'}
                            style={vscDarkPlus}
                            customStyle={{
                              margin: 0,
                              padding: '1rem',
                              fontSize: '0.85rem',
                              backgroundColor: '#1e1e1e',
                              borderRadius: '0 0 0.75rem 0.75rem',
                              maxWidth: '100%',
                              overflowX: 'auto',
                            }}
                            codeTagProps={{
                              className: 'break-all'
                            }}
                          >
                            {codeContent}
                          </SyntaxHighlighter>
                        </div>
                      );
                    },
                    // Custom link rendering
                    a({ href, children, ...props }) {
                      return (
                        <a
                          href={href}
                          className="text-blue-600 hover:underline break-all max-w-full inline-block"
                          target="_blank"
                          rel="noopener noreferrer"
                          {...props}
                        >
                          {children}
                        </a>
                      );
                    },
                    // Custom image rendering
                    img({ src, alt }) {
                      return <ChatImage src={src || ''} alt={alt || ''} />;
                    },
                  }}
                >
                  {DOMPurify.sanitize(message.content)}
                </ReactMarkdown>
              )}

              {/* Artifacts */}
              {message.artifacts && message.artifacts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.artifacts.map((artifact) => {
                    const { setArtifactId, setAgentPanelTab } = useUIStore.getState();
                    const handleClick = (e: React.MouseEvent) => {
                      e.preventDefault();
                      setArtifactId(artifact.id);
                      setAgentPanelTab('artifact-preview');
                    };

                    return (
                      <a
                        key={artifact.id}
                        href={`#artifact-${artifact.id}`}
                        onClick={handleClick}
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
                    );
                  })}
                </div>
              )}
            </div>

            {/* Loading indicator for latest message */}
            {isLatest && isStreaming && !isUser && message.content === '' && !message.reasoning && (
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
                  <span>{t('chat.input')}: {message.token_usage.input_tokens.toLocaleString()}</span>
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  <span>{t('chat.output')}: {message.token_usage.output_tokens.toLocaleString()}</span>
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                  <span>{t('chat.total')}: {(message.token_usage.input_tokens + message.token_usage.output_tokens).toLocaleString()}</span>
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
        <pre className="p-3 text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed break-words max-w-full overflow-x-hidden">
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

/**
 * MessageContent - Handles specialized rendering of user messages
 * (e.g. tool results, cleared results, or normal text)
 */
function MessageContent({ content }: { content: string }) {
  // Check for tool result
  if (content.startsWith('__TOOL_RESULT__:')) {
    const isCleared = content.includes('[旧工具结果已清除]');
    const match = content.match(/^__TOOL_RESULT__:([^:]+):([\s\S]*)$/);
    const toolCallId = match ? match[1] : 'unknown';
    const result = match ? match[2] : content;

    return (
      <div className={`rounded-lg border p-3 my-2 ${isCleared ? 'bg-gray-100 border-gray-200' : 'bg-blue-50/30 border-blue-100'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isCleared ? 'bg-gray-400' : 'bg-blue-500'}`} />
            <span className={`text-[10px] font-bold uppercase tracking-wider ${isCleared ? 'text-gray-500' : 'text-blue-700'}`}>
               Tool Execution {isCleared ? '(Compressed)' : ''}
            </span>
          </div>
          <span className="text-[9px] font-mono text-gray-400">ID: {toolCallId}</span>
        </div>
        <p className={`text-[11px] whitespace-pre-wrap break-words ${isCleared ? 'text-gray-400 italic' : 'text-gray-700'}`}>
          {isCleared ? 'Old tool result content cleared to save context tokens.' : result}
        </p>
      </div>
    );
  }

  // Normal user text
  return <p className="text-gray-700 whitespace-pre-wrap break-words">{content}</p>;
}

export default ChatMessage;
