/**
 * Chat workspace panel — messages list, error banner, token strip, ChatInput,
 * and terminal dock.
 *
 * Extracted from ChatBrowserWorkspaceShell (AG-15 PR2). Owns message
 * windowing / scroll / cost display; shell still owns dock layout + preview mode.
 */

import { useEffect, useMemo, useState } from 'react';
import { useChatStore, useSettingsStore, useUIStore } from '@/store';
import { MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS } from '@/layout/edgeToggleGutter';
import { ChatMessage, ChatInput } from '@/components';
import { SessionGoalTraceBar } from './SessionGoalTraceBar';
import { ChatWorkspaceModeToggle } from './ChatWorkspaceModeToggle';
import { ChatTerminalDock } from './ChatTerminalDock';
import { workspacePreviewChrome } from './SessionWorkspacePreview';
import { t } from '@/i18n';
import { calculateRequestCost, formatCostCompact } from '@/utils/pricing';
import {
  getSessionTokenUsage,
  formatTokenCount,
  processMessagesForDisplay,
} from '@/utils/chat';
import { getHiddenMessageCount, getVisibleMessageWindow } from './chat/messageWindowing';
import { ScrollToBottomButton } from './chat/ScrollToBottomButton';
import { useChatMessageScroll } from '@/hooks/useChatMessageScroll';

export interface ChatWorkspacePanelProps {
  /** Show the in-page chat/preview mode toggle (hidden in split + preview modes). */
  showModeToggle: boolean;
  workspaceMode: 'chat' | 'preview';
  canPreviewWorkspace: boolean;
  onWorkspaceModeChange: (mode: 'chat' | 'preview') => void;
  /** Session project/work dir (or fallback) for the terminal dock. */
  terminalCwd?: string;
}

export function ChatWorkspacePanel({
  showModeToggle,
  workspaceMode,
  canPreviewWorkspace,
  onWorkspaceModeChange,
  terminalCwd,
}: ChatWorkspacePanelProps) {
  const {
    currentMessages,
    currentSession,
    currentSessionId,
    isStreaming,
    error,
    clearError,
    retryLastMessage,
  } = useChatStore();
  const setAgentPanelTab = useUIStore((s) => s.setAgentPanelTab);

  const currentSessionData = currentSession();
  const sessionTokenUsage = useMemo(
    () => getSessionTokenUsage(currentSessionData),
    [currentSessionData?.messages],
  );

  const getModelPricing = useSettingsStore((s) => s.getModelPricing);
  const activeConfigId = useSettingsStore((s) => s.activeConfigId);
  const apiConfigs = useSettingsStore((s) => s.apiConfigs);

  const sessionCost = useMemo(() => {
    const activeConfig = apiConfigs.find((c) => c.id === activeConfigId);
    if (!activeConfig || sessionTokenUsage.total === 0) return 0;

    const pricing = getModelPricing(activeConfig.model, activeConfig.provider);
    if (!pricing) return 0;

    return calculateRequestCost(
      sessionTokenUsage.input,
      sessionTokenUsage.output,
      pricing,
    );
  }, [currentSessionData?.messages, activeConfigId, apiConfigs, getModelPricing, sessionTokenUsage]);

  const rawMessages = currentMessages();
  const displayMessages = useMemo(() => {
    const withoutHidden = rawMessages.filter((m) => !(m.metadata?.hidden === true));
    return processMessagesForDisplay(withoutHidden);
  }, [rawMessages]);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const visibleMessages = useMemo(
    () => (showFullHistory ? displayMessages : getVisibleMessageWindow(displayMessages)),
    [displayMessages, showFullHistory],
  );
  const hiddenMessageCount = getHiddenMessageCount(displayMessages, visibleMessages);
  const hasMessages = displayMessages.length > 0;
  const {
    scrollContainerRef,
    messagesEndRef,
    userScrolledUp,
    handleScroll,
    scrollToBottom,
  } = useChatMessageScroll(displayMessages);

  useEffect(() => {
    setShowFullHistory(false);
  }, [currentSessionId]);

  return (
    <div
      className="flex flex-col min-h-0 w-full min-w-0 flex-1"
      data-testid="chat-workspace-panel"
    >
      {showModeToggle && (
        <div
          data-testid="chat-page-workspace-mode-bar"
          className={`${workspacePreviewChrome.toolbar} flex shrink-0 items-center pl-4 ${MAIN_LAYOUT_EDGE_TOGGLE_GUTTER_CLASS} py-2`}
        >
          <ChatWorkspaceModeToggle
            mode={workspaceMode}
            canPreview={canPreviewWorkspace}
            onChange={onWorkspaceModeChange}
          />
        </div>
      )}
      <SessionGoalTraceBar
        onEdit={() => {
          const goalButton = document.querySelector<HTMLButtonElement>('[data-goal-trigger="true"]');
          goalButton?.click();
        }}
        onExpandPanel={() => setAgentPanelTab('goal')}
      />
      {/* Messages List — min-h-0 allows this to shrink when terminal panel is open */}
      <div className="relative flex-1 min-h-0 w-full">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto w-full"
        >
          {hasMessages ? (
            <div className="divide-y divide-gray-100 w-full">
              {hiddenMessageCount > 0 && (
                <div className="flex justify-center bg-gray-50 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setShowFullHistory(true)}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50"
                  >
                    {t('chat.showEarlierMessages').replace('{count}', String(hiddenMessageCount))}
                  </button>
                </div>
              )}
              {visibleMessages.map((message, index, filtered) => (
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
                <h2 className="text-2xl font-bold text-gray-800 mb-2">PiPi Shrimp Agent</h2>
                <p className="text-gray-500 text-sm">{t('chat.emptyStatePrompt')}</p>
              </div>
            </div>
          )}
        </div>
        <ScrollToBottomButton
          visible={userScrolledUp && hasMessages}
          onClick={scrollToBottom}
        />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-3 py-2 error-banner border-t">
          <div className="mx-auto max-w-3xl flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex items-start gap-2 error-banner-text min-w-0 flex-1">
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
              <span
                className="text-sm font-medium break-words overflow-hidden"
                style={{ wordBreak: 'break-word' }}
              >
                {error}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
              <button
                onClick={() => retryLastMessage()}
                className="px-3 py-1 text-sm error-button-primary rounded transition-colors whitespace-nowrap"
              >
                {t('common.retry')}
              </button>
              <button
                onClick={() => clearError()}
                className="p-1 error-button-secondary rounded"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session Token Stats */}
      {hasMessages && sessionTokenUsage.total > 0 && (
        <div className={`${workspacePreviewChrome.statusStrip} px-4 py-2.5`}>
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
            {sessionCost > 0 && (
              <span className={workspacePreviewChrome.statusBadge}>
                <svg
                  className="h-3 w-3 text-[#8a867f]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{t('token.cost')}</span>
                <span className={workspacePreviewChrome.statusValue}>
                  {formatCostCompact(sessionCost)}
                </span>
              </span>
            )}
            <span className={workspacePreviewChrome.statusBadge}>
              <svg
                className="h-3 w-3 text-[#8a867f]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span>{t('chat.sessionTokenUsage')}</span>
              <span className={workspacePreviewChrome.statusValue}>
                {formatTokenCount(sessionTokenUsage.total)}
              </span>
              <span>{t('token.tokens')}</span>
            </span>

            <span className={workspacePreviewChrome.statusBadge}>
              <span>{t('chat.input')}</span>
              <span className={workspacePreviewChrome.statusValue}>
                {formatTokenCount(sessionTokenUsage.input)}
              </span>
            </span>

            <span className={workspacePreviewChrome.statusBadge}>
              <span>{t('chat.output')}</span>
              <span className={workspacePreviewChrome.statusValue}>
                {formatTokenCount(sessionTokenUsage.output)}
              </span>
            </span>
          </div>
        </div>
      )}

      <ChatInput />

      <ChatTerminalDock cwd={terminalCwd} />
    </div>
  );
}

export default ChatWorkspacePanel;
