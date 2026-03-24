/**
 * ChatBrowserWorkspaceShell - Chat workspace with optional browser split layout
 *
 * This component wraps the chat experience and manages the browser dock layout.
 * See browser-docked-layout-design.md for design details.
 *
 * Layout modes:
 * - hidden/panel: Chat takes full width
 * - split: Browser pane + Chat pane side by side
 * - external: Browser in separate window, Chat takes full width
 */

import { useMemo, useCallback, useRef } from 'react';
import { useChatStore, useUIStore } from '@/store';
import { MainLayout } from '@/layout';
import { ChatMessage, ChatInput } from '@/components';
import { BrowserWorkspacePane } from './BrowserWorkspacePane';
import type { Message, Session } from '@/types/chat';
import { t } from '@/i18n';

/**
 * Calculate total token usage for a session
 */
const getSessionTokenUsage = (session: Session | null): { input: number; output: number; total: number } => {
  if (!session) return { input: 0, output: 0, total: 0 };

  let input = 0;
  let output = 0;

  for (const message of session.messages) {
    if (message.token_usage) {
      input += message.token_usage.input_tokens;
      output += message.token_usage.output_tokens;
    }
  }

  return { input, output, total: input + output };
};

/**
 * Format token count for display
 */
const formatTokenCount = (count: number): string => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(2)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toLocaleString();
};

const mergeReasoningParts = (...parts: Array<string | undefined | null>): string | undefined => {
  const merged: string[] = [];

  for (const part of parts) {
    const normalized = part?.trim();
    if (!normalized) continue;
    if (!merged.includes(normalized)) {
      merged.push(normalized);
    }
  }

  return merged.length > 0 ? merged.join('\n\n') : undefined;
};

const isRenderableMessage = (message: Message, index: number, allMessages: Message[]) => {
  const isLastMessage = index === allMessages.length - 1;
  if (isLastMessage) return true;

  return !(
    message.role === 'assistant' &&
    message.content === '' &&
    message.tool_calls &&
    message.tool_calls.length > 0
  );
};

/**
 * ChatBrowserWorkspaceShell component
 */
export function ChatBrowserWorkspaceShell() {
  // Browser dock state
  const { browserDockMode, browserPaneWidth, browserSplitFocus, setBrowserPaneWidth } = useUIStore();

  // Resize state
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Handle resize drag start
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = {
      startX: e.clientX,
      startWidth: browserPaneWidth,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = moveEvent.clientX - resizeRef.current.startX;
      const newWidth = resizeRef.current.startWidth + delta;
      // Clamp to reasonable min/max
      setBrowserPaneWidth(newWidth);
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [browserPaneWidth, setBrowserPaneWidth]);

  // Chat store
  const {
    currentMessages,
    currentSession,
    isStreaming,
    error,
    clearError,
    retryLastMessage,
  } = useChatStore();

  // Memoized token usage
  const currentSessionData = currentSession();
  const sessionTokenUsage = useMemo(() => getSessionTokenUsage(currentSessionData), [currentSessionData?.messages]);

  // Memoized: filter out internal tool-result messages
  const rawMessages = currentMessages();
  const messages = useMemo(() =>
    rawMessages.filter(
      (m) => !(m.role === 'user' && m.content.startsWith('__TOOL_RESULT__:'))
    ),
    [rawMessages]
  );
  const displayMessages = useMemo(() => {
    const reasoningByIndex = new Map<number, string>();
    let assistantGroupIndices: number[] = [];
    let assistantReasoningParts: Array<string | undefined> = [];

    const finalizeAssistantGroup = () => {
      if (assistantGroupIndices.length === 0) return;

      const combinedReasoning = mergeReasoningParts(...assistantReasoningParts);
      if (combinedReasoning) {
        const visibleIndex =
          [...assistantGroupIndices]
            .reverse()
            .find((idx) => isRenderableMessage(messages[idx], idx, messages)) ??
          assistantGroupIndices[assistantGroupIndices.length - 1];

        reasoningByIndex.set(visibleIndex, combinedReasoning);
      }

      assistantGroupIndices = [];
      assistantReasoningParts = [];
    };

    messages.forEach((message, index) => {
      if (message.role === 'assistant') {
        assistantGroupIndices.push(index);
        if (message.reasoning) {
          assistantReasoningParts.push(message.reasoning);
        }
        return;
      }

      finalizeAssistantGroup();
    });

    finalizeAssistantGroup();

    return messages
      .map((message, index) => ({ message, index }))
      .filter(({ message, index }) => isRenderableMessage(message, index, messages))
      .map(({ message, index }) =>
        message.role === 'assistant'
          ? { ...message, reasoning: reasoningByIndex.get(index) }
          : message
      );
  }, [messages]);
  const hasMessages = displayMessages.length > 0;

  // Determine if we're in split mode
  const isSplitMode = browserDockMode === 'split';

  // Render the chat panel content
  const renderChatPanel = () => (
    <div className="flex flex-col min-h-0 w-full">
      {/* Messages List */}
      <div className="flex-1 overflow-y-auto">
        {hasMessages ? (
          <div className="divide-y divide-gray-100">
            {displayMessages.map((message, index, filtered) => (
              <ChatMessage
                key={message.id}
                message={message}
                isLatest={index === filtered.length - 1}
                isStreaming={isStreaming && index === filtered.length - 1}
              />
            ))}
          </div>
        ) : (
          /* Empty State */
          <div className="flex-1 flex items-center justify-center pb-32 select-none pointer-events-none">
            <div className="text-center">
              <div className="mb-6">
                <img
                  src="/shrimp-avatar.png"
                  alt="PiPi Shrimp"
                  className="h-32 w-32 mx-auto rounded-full shadow-lg object-cover"
                />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                PiPi Shrimp Agent
              </h2>
              <p className="text-gray-500 text-sm">
                What can I help you with today?
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-3 py-2 bg-red-50 border-t border-red-200">
          <div className="mx-auto max-w-3xl flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex items-start gap-2 text-red-700 min-w-0 flex-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 flex-shrink-0 mt-0.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm font-medium break-words overflow-hidden" style={{ wordBreak: 'break-word' }}>{error}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
              <button
                onClick={() => retryLastMessage()}
                className="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors whitespace-nowrap"
              >
                Retry
              </button>
              <button
                onClick={() => clearError()}
                className="p-1 hover:bg-red-100 rounded text-red-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Indicator */}
      {isStreaming && (
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-200">
          <div className="mx-auto flex items-center gap-2 text-blue-700 max-w-3xl">
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm">{t('chat.aiThinking')}</span>
          </div>
        </div>
      )}

      {/* Session Token Stats */}
      {hasMessages && sessionTokenUsage.total > 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <div className="mx-auto flex items-center justify-center gap-4 text-xs text-gray-500 max-w-3xl">
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span>{t('chat.sessionTokenUsage')}: <strong className="text-gray-700">{formatTokenCount(sessionTokenUsage.total)}</strong> tokens</span>
            </span>
            <span className="text-gray-300">|</span>
            <span>{t('chat.input')}: {formatTokenCount(sessionTokenUsage.input)}</span>
            <span>{t('chat.output')}: {formatTokenCount(sessionTokenUsage.output)}</span>
          </div>
        </div>
      )}

      {/* Chat Input */}
      <ChatInput />
    </div>
  );

  return (
    <MainLayout>
      {/* Split Mode: Browser + Chat side by side */}
      {isSplitMode ? (
        <div className="flex-1 flex min-h-0">
          {/* Browser Pane */}
          <div
            className="flex-shrink-0 border-r border-gray-200 bg-white"
            style={{ width: browserPaneWidth }}
          >
            <BrowserWorkspacePane />
          </div>

          {/* Resize Handle */}
          <div
            className="w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 transition-colors"
            onMouseDown={handleResizeStart}
          />

          {/* Chat Pane */}
          <div
            className={`flex-1 min-w-0 ${browserSplitFocus === 'chat' ? '' : 'opacity-70'}`}
          >
            {renderChatPanel()}
          </div>
        </div>
      ) : (
        /* Normal Mode: Chat takes full width */
        <div className="flex-1 flex min-h-0">
          {renderChatPanel()}
        </div>
      )}
    </MainLayout>
  );
}

export default ChatBrowserWorkspaceShell;
