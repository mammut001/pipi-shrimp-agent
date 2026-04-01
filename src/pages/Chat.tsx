/**
 * Chat - Main chat page component
 *
 * Features:
 * - Display current session messages
 * - User/assistant message styles
 * - Auto-scroll to latest message (only when user is at bottom)
 * - Loading state (isStreaming)
 * - Error display
 * - Permission dialog integration
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useChatStore, useUIStore, useSettingsStore } from '@/store';
import { MainLayout } from '@/layout';
import { ChatMessage, ChatInput, PermissionModal } from '@/components';
import type { Message, Session } from '@/types/chat';
import { t } from '@/i18n';
import { calculateRequestCost, formatCostCompact } from '@/utils/pricing';

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
 * Chat page component
 */
export function Chat() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [selectedProjectForNewChat, setSelectedProjectForNewChat] = useState<string | null>(null);
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(null);

  const {
    currentMessages,
    currentSession,
    isStreaming,
    error,
    clearError,
    retryLastMessage,
    startSession,
    sendMessage,
    projects,
  } = useChatStore();

  // Memoized token usage (recalculates only when messages change)
  const currentSessionData = currentSession();
  const sessionTokenUsage = useMemo(() => getSessionTokenUsage(currentSessionData), [currentSessionData?.messages]);

  // Get pricing from settings store
  const getModelPricing = useSettingsStore((s) => s.getModelPricing);
  const activeConfigId = useSettingsStore((s) => s.activeConfigId);
  const apiConfigs = useSettingsStore((s) => s.apiConfigs);

  // Calculate session cost
  const sessionCost = useMemo(() => {
    const activeConfig = apiConfigs.find(c => c.id === activeConfigId);
    if (!activeConfig || sessionTokenUsage.total === 0) return 0;

    const pricing = getModelPricing(activeConfig.model, activeConfig.provider);
    if (!pricing) return 0;

    return calculateRequestCost(
      sessionTokenUsage.input,
      sessionTokenUsage.output,
      pricing
    );
  }, [currentSessionData?.messages, activeConfigId, apiConfigs, getModelPricing, sessionTokenUsage]);

  // Use precise selectors so each field has its own subscription, guaranteeing
  // the modal renders as soon as the queue changes (avoids stale-ref issues).
  // permissionQueue is FIFO — we always show the front item.
  const permissionQueue = useUIStore((s) => s.permissionQueue);
  const pendingPermission = permissionQueue[0];   // undefined when queue is empty
  const clearPermissionRequest = useUIStore((s) => s.clearPermissionRequest);
  const addNotification = useUIStore((s) => s.addNotification);

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

  // Detect if user has scrolled up (away from bottom)
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setUserScrolledUp(distanceFromBottom > 100); // Consider user scrolled up if >100px from bottom
  }, []);

  // Auto-scroll to bottom only when user is at bottom
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayMessages, userScrolledUp]);

  /**
   * Handle permission approval
   */
  const handleApprovePermission = async () => {
    if (!pendingPermission) return;

    const { id, toolName, toolInput } = pendingPermission;

    // Clear request first to close modal
    clearPermissionRequest();

    // Call central execution logic in chatStore
    const { executeTool } = useChatStore.getState();
    await executeTool(toolName, toolInput, id);
  };

  /**
   * Handle permission denial
   * Must also decrement pendingToolCalls so sendAllToolResults can still fire
   * when all other tool calls complete.
   */
   const handleDenyPermission = () => {
    if (!pendingPermission) return;
    addNotification('info', 'Permission denied');
    clearPermissionRequest();

    // Decrement the counter atomically, then READ the new value to decide whether to flush.
    // (Reading pendingToolCalls BEFORE setState would give the old value and cause off-by-one.)
    const { sendAllToolResults } = useChatStore.getState();
    useChatStore.setState((state) => ({
      pendingToolCalls: Math.max(0, state.pendingToolCalls - 1),  // Prevent negative
      // Inject a "denied" placeholder so the AI gets a tool result for this call
      pendingToolResults: [
        ...state.pendingToolResults,
        { toolCallId: pendingPermission.id, result: 'Permission denied by user.' },
      ],
    }));
    // Read the updated value AFTER the setState has been applied
    if (useChatStore.getState().pendingToolCalls === 0) {
      sendAllToolResults();
    }
  };

  /**
   * Handle new session required - show project selection modal
   */
  const handleNewSessionRequired = (message: string) => {
    setSelectedProjectForNewChat(null);
    setPendingFirstMessage(message);
    setShowNewSessionModal(true);
  };

  /**
   * Handle creating new session with selected project
   */
  const handleCreateNewSession = async () => {
    const sessionId = await startSession(selectedProjectForNewChat || undefined);
    setShowNewSessionModal(false);
    setSelectedProjectForNewChat(null);

    const message = pendingFirstMessage;
    setPendingFirstMessage(null);
    if (message) {
      await sendMessage(message, sessionId);
    }
  };

  /**
   * Handle error dismissal
   */
  const handleDismissError = () => {
    clearError();
  };

  return (
    <MainLayout>
      <div className="flex-1 flex min-h-0">
        {/* Chat Panel - full width */}
        <div className="flex flex-col min-h-0 w-full">
          {/* Messages List */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto max-w-full"
          >
            {hasMessages ? (
              <div className="divide-y divide-gray-100 max-w-full overflow-hidden">
                {/* Filter out intermediate tool-dispatch assistant messages:
                    these are rounds where the AI called tools but wrote no visible text.
                    They show up as "(N chars) thinking" bubbles with no final content.
                    Only the final answer (or the actively-streaming last message) is shown. */}
                {displayMessages.map((message, index, filtered) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isLatest={index === filtered.length - 1}
                    isStreaming={isStreaming && index === filtered.length - 1}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              /* Empty State - PiPi Shrimp Welcome Screen */
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

          {/* Error Banner — responsive: wraps on small windows */}
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
                    onClick={handleDismissError}
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
                {sessionCost > 0 && (
                  <>
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {formatCostCompact(sessionCost)}
                    </span>
                    <span className="text-gray-300">|</span>
                  </>
                )}
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
          <ChatInput onNewSessionRequired={handleNewSessionRequired} />
        </div>

        {/* New Session Modal - Select Project */}
        {showNewSessionModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewSessionModal(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('chat.newSession')}</h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Project</label>
                <select
                  value={selectedProjectForNewChat || ''}
                  onChange={(e) => setSelectedProjectForNewChat(e.target.value || null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                >
                  <option value="">None (No Project)</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowNewSessionModal(false);
                    setSelectedProjectForNewChat(null);
                  }}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleCreateNewSession}
                  className="px-4 py-2 text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  {t('common.confirm')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Permission Modal */}
        {pendingPermission && (
          <PermissionModal
            permission={pendingPermission}
            onApprove={handleApprovePermission}
            onDeny={handleDenyPermission}
          />
        )}
      </div>
    </MainLayout>
  );
}

export default Chat;
