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

import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore, useUIStore, useSettingsStore } from '@/store';
import { useBrowserAgentStore } from '@/store';
import { MainLayout } from '@/layout';
import { ChatMessage, ChatInput, PermissionModal, QuestionnaireCard } from '@/components';
import { BrowserWorkspacePane } from './BrowserWorkspacePane';
import { SwarmPanel } from './SwarmPanel';
import { TerminalPanel } from './TerminalPanel';
import { t } from '@/i18n';
import { calculateRequestCost, formatCostCompact } from '@/utils/pricing';
import { getSessionTokenUsage, formatTokenCount, mergeReasoningParts, isRenderableMessage } from '@/utils/chat';

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
    try {
      const saved = localStorage.getItem(SWARM_PANEL_POS_KEY);
      if (saved) {
        const { x, y } = JSON.parse(saved);
        const maxX = window.innerWidth - panel.offsetWidth;
        const maxY = window.innerHeight - panel.offsetHeight;
        panel.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
        panel.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
    } catch { /* ignore */ }
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
      // Persist final position
      if (panel) {
        const rect = panel.getBoundingClientRect();
        try {
          localStorage.setItem(SWARM_PANEL_POS_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
        } catch { /* ignore */ }
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
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
  const { browserDockMode } = useUIStore();

  // Permission modal state (Ask mode)
  const permissionQueue = useUIStore((s) => s.permissionQueue);
  const pendingPermission = permissionQueue[0];
  const clearPermissionRequest = useUIStore((s) => s.clearPermissionRequest);
  const addNotification = useUIStore((s) => s.addNotification);

  // Questionnaire state
  const activeQuestionnaire = useUIStore((s) => s.activeQuestionnaire);
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
  useEffect(() => {
    if (terminalPanelVisible && !terminalEverOpened) {
      setTerminalEverOpened(true);
    }
  }, [terminalPanelVisible, terminalEverOpened]);

  const handleApprovePermission = async () => {
    if (!pendingPermission) return;
    pendingPermission._resolve?.(true);
    clearPermissionRequest();
  };

  const handleDenyPermission = () => {
    if (!pendingPermission) return;
    addNotification('info', 'Permission denied');
    pendingPermission._resolve?.(false);
    clearPermissionRequest();
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
    startSession,
    sendMessage,
    projects,
  } = useChatStore();

  // ── New-chat modal (triggered when user types in the empty-state input) ──
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [selectedProjectForNewChat, setSelectedProjectForNewChat] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string>('');

  const handleNewSessionRequired = useCallback((message: string) => {
    setPendingMessage(message);
    setSelectedProjectForNewChat(null);
    setShowNewChatModal(true);
  }, []);

  const handleCreateNewChat = useCallback(async () => {
    setShowNewChatModal(false);
    const newSessionId = await startSession(selectedProjectForNewChat || undefined);
    setSelectedProjectForNewChat(null);
    if (pendingMessage.trim()) {
      await sendMessage(pendingMessage.trim(), newSessionId);
      setPendingMessage('');
    }
  }, [startSession, sendMessage, selectedProjectForNewChat, pendingMessage]);

  // Memoized token usage
  const currentSessionData = currentSession();
  const terminalCwd = currentSessionData?.workDir;
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
  const hasMessages = displayMessages.length > 0;

  // Determine if we're in split mode
  const isSplitMode = browserDockMode === 'split';

  // Render the chat panel content
  const renderChatPanel = () => (
    <div className="flex flex-col min-h-0 w-full min-w-0 flex-1">
      {/* Messages List — min-h-0 allows this to shrink when terminal panel is open */}
      <div className="flex-1 overflow-y-auto min-h-0">
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
                Retry
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

      {/* Chat Input — pass onNewSessionRequired so empty-state sends open the new-chat modal */}
      <ChatInput onNewSessionRequired={!currentSessionId ? handleNewSessionRequired : undefined} />

      {/* Terminal Panel — keep mounted after first open so PTY session survives
           hide/show toggles. Visibility controlled by CSS, not unmounting. */}
      {terminalEverOpened && (
        <>
          {/* Drag handle */}
          <div
            className="h-1 bg-[#3c3c3c] cursor-row-resize hover:bg-blue-500 transition-colors flex-shrink-0"
            onMouseDown={handleTerminalDragStart}
            style={{ display: terminalPanelVisible ? undefined : 'none' }}
          />
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
    <MainLayout>
      {/* Split Mode: Browser takes full center area, right AgentPanel shows controls+logs */}
      {isSplitMode ? (
        <div className="flex-1 flex min-h-0 min-w-0">
          <div className="flex-1 min-w-0 bg-white">
            <BrowserWorkspacePane />
          </div>
        </div>
      ) : (
        /* Normal Mode: Chat takes full width */
        <div className="flex-1 flex min-h-0 min-w-0">
          {renderChatPanel()}
        </div>
      )}

      {/* Swarm Runtime Panel — floating overlay for swarm observability, draggable */}
      <SwarmPanelDraggable />

      {/* Permission Modal — Ask mode tool confirmation (fixed overlay, always on top) */}
      {pendingPermission && (
        <PermissionModal
          permission={pendingPermission}
          onApprove={handleApprovePermission}
          onDeny={handleDenyPermission}
        />
      )}

      {/* Questionnaire Modal — AskUserQuestion tool interactive form */}
      {activeQuestionnaire && (
        <QuestionnaireCard
          data={activeQuestionnaire}
          onSubmit={submitQuestionnaire}
          onCancel={clearQuestionnaire}
        />
      )}

      {/* New Chat Modal — shown when user submits a message with no active session */}
      {showNewChatModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowNewChatModal(false)}
        >
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New Chat</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Project</label>
              <select
                value={selectedProjectForNewChat || ''}
                onChange={(e) => setSelectedProjectForNewChat(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">No project (root)</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowNewChatModal(false); setSelectedProjectForNewChat(null); setPendingMessage(''); }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateNewChat}
                className="flex-1 px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}

export default ChatBrowserWorkspaceShell;
