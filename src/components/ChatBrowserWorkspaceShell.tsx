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

import { useMemo, useEffect, useRef, useCallback, useState, lazy, Suspense } from 'react';
import { useChatStore, useUIStore, useSettingsStore } from '@/store';
import { useBrowserAgentStore } from '@/store';
import { MainLayout } from '@/layout';
import { ChatMessage, ChatInput } from '@/components';
import { SessionGoalTraceBar } from './SessionGoalTraceBar';
import { BrowserWorkspacePane } from './BrowserWorkspacePane';
import {
  SessionWorkspaceFileManagerPane,
  SessionWorkspacePreviewPane,
  useSessionWorkspacePreview,
  workspacePreviewChrome,
} from './SessionWorkspacePreview';
import { SwarmPanel } from './SwarmPanel';
import { TerminalPanel } from './TerminalPanel';

// Lazy-loaded modal/overlay components (rarely visible on first render)
const PermissionModal = lazy(() => import('./PermissionModal'));
const QuestionnaireCard = lazy(() => import('./QuestionnaireCard'));
import { t } from '@/i18n';
import { calculateRequestCost, formatCostCompact } from '@/utils/pricing';
import { getSessionTokenUsage, formatTokenCount, mergeReasoningParts, isRenderableMessage } from '@/utils/chat';
import { getHiddenMessageCount, getVisibleMessageWindow } from './chat/messageWindowing';
import { ScrollToBottomButton } from './chat/ScrollToBottomButton';
import { useChatMessageScroll } from '@/hooks/useChatMessageScroll';
import { resolveFallbackTerminalCwd } from '@/utils/terminalCwd';
import { safeGetJSON, safeSetJSON } from '@/utils/safeStorage';

/**
 * Draggable wrapper for SwarmPanel — allows free positioning anywhere on screen.
 */
const SWARM_PANEL_POS_KEY = 'swarm-panel-position';

function SwarmPanelDraggable() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ offsetX: number; offsetY: number } | null>(null);

  // Restore saved position on mount
  useEffect(() => {
    const panel = containerRef.current;
    if (!panel) return;
    // AUDIT-FIX [fix-22#1] — Use the safe-storage helper for the read
    // path; quota / SecurityError fall through to the default bottom-right
    // position which the panel already starts with.
    const saved = safeGetJSON<{ x: number; y: number }>(SWARM_PANEL_POS_KEY);
    if (saved.value) {
      const { x, y } = saved.value;
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      panel.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      panel.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only drag from the header drag-handle area (data-drag-handle attribute)
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;
    e.preventDefault();

    const panel = containerRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    dragState.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current || !panel) return;
      let x = ev.clientX - dragState.current.offsetX;
      let y = ev.clientY - dragState.current.offsetY;
      // Clamp within viewport
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    const onMouseUp = () => {
      dragState.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Persist final position via the safe-storage helper so quota
      // errors don't crash the listener teardown path.
      if (panel) {
        const rect = panel.getBoundingClientRect();
        safeSetJSON(SWARM_PANEL_POS_KEY, { x: rect.left, y: rect.top });
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // AUDIT-FIX [fix-19#1] — Last-line-of-defence cleanup. If the component
  // unmounts mid-drag (e.g. the user navigates away or the panel
  // disappears) the document listeners above would leak. We mirror the
  // `mouseup` cleanup here as a safety net.
  useEffect(() => {
    return () => {
      // We can't reference the inner onMouseUp / onMouseMove (they live in
      // the closure above), but the drag state itself can be reset so any
      // subsequent callback is a no-op until the user starts a new drag.
      dragState.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed bottom-4 right-4 z-40 w-[460px]"
      onMouseDown={handleMouseDown}
    >
      <SwarmPanel />
    </div>
  );
}

/**
 * ChatBrowserWorkspaceShell component
 */
export function ChatBrowserWorkspaceShell() {
  // Initialize browser event listeners for the new UI entry point
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        cleanup = await useBrowserAgentStore.getState().setupEventListeners();
      } catch (err) {
        console.warn('Failed to setup browser event listeners:', err);
      }
    })();
    return () => {
      cleanup?.();
    };
  }, []);
  // Browser dock state
  const { browserDockMode, browserSplitFocus } = useUIStore();
  const [workspaceMode, setWorkspaceMode] = useState<'chat' | 'preview'>('chat');

  // Permission modal state (Ask mode)
  const permissionQueue = useUIStore((s) => s.permissionQueue);
  const pendingPermission = permissionQueue[0];
  const resolvePermissionRequest = useUIStore((s) => s.resolvePermissionRequest);
  const addNotification = useUIStore((s) => s.addNotification);

  // Questionnaire state
  const activeQuestionnaire = useUIStore((s) => s.activeQuestionnaire);
  const activeQuestionnaireSessionId = useUIStore((s) => s.activeQuestionnaireSessionId);
  const submitQuestionnaire = useUIStore((s) => s.submitQuestionnaire);
  const clearQuestionnaire = useUIStore((s) => s.clearQuestionnaire);

  // Terminal panel state
  const terminalPanelVisible = useUIStore((s) => s.terminalPanelVisible);
  const terminalPanelHeight = useUIStore((s) => s.terminalPanelHeight);
  const setTerminalPanelHeight = useUIStore((s) => s.setTerminalPanelHeight);
  const toggleTerminalPanel = useUIStore((s) => s.toggleTerminalPanel);

  // Once the terminal has been opened at least once, keep it mounted so the
  // PTY session survives hide/show toggles (avoids clearing the session).
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);
  const [fallbackTerminalCwd, setFallbackTerminalCwd] = useState<string | undefined>();
  const setAgentPanelTab = useUIStore((s) => s.setAgentPanelTab);
  useEffect(() => {
    if (terminalPanelVisible && !terminalEverOpened) {
      setTerminalEverOpened(true);
    }
  }, [terminalPanelVisible, terminalEverOpened]);

  const handleApprovePermission = async () => {
    if (!pendingPermission) return;
    resolvePermissionRequest(true);
  };

  const handleDenyPermission = () => {
    if (!pendingPermission) return;
    addNotification('info', t('permission.deniedMessage'));
    resolvePermissionRequest(false);
  };

  // Terminal drag-resize handler
  const handleTerminalDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = terminalPanelHeight;
      const onMouseMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        setTerminalPanelHeight(Math.max(100, Math.min(600, startHeight + delta)));
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [terminalPanelHeight, setTerminalPanelHeight]
  );

  // Chat store
  const {
    currentMessages,
    currentSession,
    currentSessionId,
    isStreaming,
    error,
    clearError,
    retryLastMessage,
    ensureSessionWorkDir,
  } = useChatStore();

  // Memoized token usage
  const currentSessionData = currentSession();
  const terminalCwd = currentSessionData?.workDir || fallbackTerminalCwd;
  const canPreviewWorkspace = Boolean(currentSessionData?.workDir);
  const sessionTokenUsage = useMemo(() => getSessionTokenUsage(currentSessionData), [currentSessionData?.messages]);
  const isSplitMode = browserDockMode === 'split';
  const previewWorkspaceActive = !isSplitMode && workspaceMode === 'preview';
  const {
    entries: workspaceEntries,
    selectedFilePath,
    setSelectedFilePath,
    selectedContent,
    fileLoading,
    fileError,
    isRefreshing: workspaceRefreshing,
    isTruncated: workspaceTruncated,
    refreshEntries: refreshWorkspaceEntries,
    revealInFinder: revealWorkspacePath,
  } = useSessionWorkspacePreview(currentSessionData?.workDir ?? null, previewWorkspaceActive);

  useEffect(() => {
    if (!terminalPanelVisible || currentSessionData?.workDir || fallbackTerminalCwd) {
      return;
    }

    let cancelled = false;
    const cwdPromise = currentSessionId
      ? ensureSessionWorkDir(currentSessionId).then((cwd) => cwd ?? undefined)
      : resolveFallbackTerminalCwd();

    void cwdPromise.then((cwd) => {
      if (!cancelled) {
        setFallbackTerminalCwd(cwd);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentSessionData?.workDir, currentSessionId, ensureSessionWorkDir, fallbackTerminalCwd, terminalPanelVisible]);

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

  // Memoized: filter out internal tool-result messages and hidden context messages
  const rawMessages = currentMessages();
  const messages = useMemo(() =>
    rawMessages.filter(
      (m) => !(m.role === 'user' && m.content.startsWith('__TOOL_RESULT__:'))
            && !(m.metadata?.hidden === true)
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
  const [showFullHistory, setShowFullHistory] = useState(false);
  const visibleMessages = useMemo(
    () => showFullHistory ? displayMessages : getVisibleMessageWindow(displayMessages),
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
    setWorkspaceMode('chat');
    setShowFullHistory(false);
  }, [currentSessionId]);

  useEffect(() => {
    if (!canPreviewWorkspace && workspaceMode === 'preview') {
      setWorkspaceMode('chat');
    }
  }, [canPreviewWorkspace, workspaceMode]);

  const renderWorkspaceModeToolbar = () => (
    <div className={`${workspacePreviewChrome.toolbar} px-4 py-3`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={workspacePreviewChrome.eyebrow}>{t('chat.workspaceView')}</p>
          <p className={workspacePreviewChrome.secondaryText}>
            {t('chat.workspaceViewDescription')}
          </p>
        </div>

        <div className={workspacePreviewChrome.segmented}>
          <button
            type="button"
            onClick={() => setWorkspaceMode('chat')}
            className={`${workspacePreviewChrome.segmentedButton} ${
              workspaceMode === 'chat'
                ? workspacePreviewChrome.segmentedButtonActive
                : workspacePreviewChrome.segmentedButtonInactive
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
            </svg>
            {t('nav.chat')}
          </button>
          <button
            type="button"
            onClick={() => canPreviewWorkspace && setWorkspaceMode('preview')}
            disabled={!canPreviewWorkspace}
            className={`${workspacePreviewChrome.segmentedButton} ${
              workspaceMode === 'preview'
                ? workspacePreviewChrome.segmentedButtonActive
                : workspacePreviewChrome.segmentedButtonInactiveDisabled
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6h13M9 5h13M3 5h.01M3 11h.01M3 17h.01" />
            </svg>
            {t('common.preview')}
          </button>
        </div>
      </div>
    </div>
  );

  const renderPreviewWorkspaceShell = () => (
    <div className={`flex h-full min-h-0 min-w-0 flex-col ${workspacePreviewChrome.shellBg}`}>
      {renderWorkspaceModeToolbar()}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="flex w-[420px] min-w-[360px] max-w-[460px] flex-col border-r border-[#e9e9e7] bg-[#fbfbfa] shadow-[inset_-1px_0_0_rgba(255,255,255,0.6)]">
          <div className="border-b border-[#e9e9e7] bg-[#fbfbfa]/92 px-4 py-3 shadow-[0_1px_0_rgba(255,255,255,0.72)]">
            <p className={workspacePreviewChrome.eyebrow}>{t('chat.conversationPanel')}</p>
            <p className={workspacePreviewChrome.secondaryText}>
              {t('chat.conversationPanelDescription')}
            </p>
          </div>
          <div className="flex-1 min-h-0 min-w-0">
            {renderChatPanel()}
          </div>
        </div>

        <div className={`flex-1 min-w-0 ${workspacePreviewChrome.shellBg}`}>
          <SessionWorkspacePreviewPane
            workDir={currentSessionData?.workDir ?? null}
            selectedFilePath={selectedFilePath}
            selectedContent={selectedContent}
            fileLoading={fileLoading}
            fileError={fileError}
            onRevealPath={revealWorkspacePath}
          />
        </div>
      </div>
    </div>
  );

  // Render the chat panel content
  const renderChatPanel = () => (
    <div className="flex flex-col min-h-0 w-full min-w-0 flex-1">
      <SessionGoalTraceBar
        onEdit={() => {
          const goalButton = document.querySelector<HTMLButtonElement>('[data-goal-trigger="true"]');
          goalButton?.click();
        }}
        onExpandPanel={() => useUIStore.getState().openRightPanelTab('goal')}
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
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                PiPi Shrimp Agent
              </h2>
              <p className="text-gray-500 text-sm">
                {t('chat.emptyStatePrompt')}
              </p>
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
              <span className="text-sm font-medium break-words overflow-hidden" style={{ wordBreak: 'break-word' }}>{error}</span>
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
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
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
                <svg className="h-3 w-3 text-[#8a867f]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{t('token.cost')}</span>
                <span className={workspacePreviewChrome.statusValue}>{formatCostCompact(sessionCost)}</span>
                </span>
            )}
            <span className={workspacePreviewChrome.statusBadge}>
              <svg className="h-3 w-3 text-[#8a867f]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span>{t('chat.sessionTokenUsage')}</span>
              <span className={workspacePreviewChrome.statusValue}>{formatTokenCount(sessionTokenUsage.total)}</span>
              <span>{t('token.tokens')}</span>
            </span>

            <span className={workspacePreviewChrome.statusBadge}>
              <span>{t('chat.input')}</span>
              <span className={workspacePreviewChrome.statusValue}>{formatTokenCount(sessionTokenUsage.input)}</span>
            </span>

            <span className={workspacePreviewChrome.statusBadge}>
              <span>{t('chat.output')}</span>
              <span className={workspacePreviewChrome.statusValue}>{formatTokenCount(sessionTokenUsage.output)}</span>
            </span>
          </div>
        </div>
      )}

      <ChatInput />

      {/* Terminal Panel — keep mounted after first open so PTY session survives
           hide/show toggles. Visibility controlled by CSS, not unmounting. */}
      {terminalEverOpened && (
        <>
          {/* Drag handle */}
          <div
            className={workspacePreviewChrome.terminalDivider}
            onMouseDown={handleTerminalDragStart}
            style={{ display: terminalPanelVisible ? undefined : 'none' }}
          >
            <span className={workspacePreviewChrome.terminalDividerThumb} />
          </div>
          <div
            className="flex-shrink-0 overflow-hidden"
            style={{
              height: terminalPanelVisible ? terminalPanelHeight : 0,
              display: terminalPanelVisible ? undefined : 'none',
            }}
          >
            {/* key=cwd resets the terminal when the work folder changes */}
            <TerminalPanel
              key={terminalCwd ?? '__no_cwd__'}
              cwd={terminalCwd}
              onClose={toggleTerminalPanel}
            />
          </div>
        </>
      )}
    </div>
  );

  return (
    <MainLayout
      showRightPanel={previewWorkspaceActive ? true : undefined}
      rightPanelContent={
        previewWorkspaceActive ? (
          <SessionWorkspaceFileManagerPane
            workDir={currentSessionData?.workDir ?? null}
            entries={workspaceEntries}
            selectedFilePath={selectedFilePath}
            onSelectFile={setSelectedFilePath}
            onRevealPath={revealWorkspacePath}
            onRefresh={() => void refreshWorkspaceEntries()}
            isRefreshing={workspaceRefreshing}
            isTruncated={workspaceTruncated}
          />
        ) : undefined
      }
      rightPanelWidthClassName={previewWorkspaceActive ? 'w-[360px]' : undefined}
    >
      {/* Split Mode: browser + chat side by side; focusChatPane enlarges chat pane */}
      {isSplitMode ? (
        <div className="flex-1 flex min-h-0 min-w-0">
          <div
            className={`min-w-0 bg-white ${
              browserSplitFocus === 'browser' ? 'flex-[3]' : 'flex-[2]'
            }`}
          >
            <BrowserWorkspacePane />
          </div>
          <div
            className={`flex min-h-0 min-w-0 flex-col border-l border-gray-200 ${
              browserSplitFocus === 'chat' ? 'flex-[3]' : 'flex-[2]'
            }`}
          >
            {renderChatPanel()}
          </div>
        </div>
      ) : (
        /* Normal Mode: Chat takes full width */
        previewWorkspaceActive ? renderPreviewWorkspaceShell() : renderChatPanel()
      )}

      {/* Swarm Runtime Panel — floating overlay for swarm observability, draggable */}
      <SwarmPanelDraggable />

      {/* Permission Modal — Ask mode tool confirmation (fixed overlay, always on top) */}
      {pendingPermission && (
        <Suspense fallback={null}>
          <PermissionModal
            permission={pendingPermission}
            onApprove={handleApprovePermission}
            onDeny={handleDenyPermission}
          />
        </Suspense>
      )}

      {/* Questionnaire Modal — AskUserQuestion tool interactive form */}
      {activeQuestionnaire && activeQuestionnaireSessionId === currentSessionId && (
        <Suspense fallback={null}>
          <QuestionnaireCard
            data={activeQuestionnaire}
            onSubmit={(response) => submitQuestionnaire(response, currentSessionId || undefined)}
            onCancel={() => clearQuestionnaire(currentSessionId || undefined)}
          />
        </Suspense>
      )}
    </MainLayout>
  );
}

export default ChatBrowserWorkspaceShell;
