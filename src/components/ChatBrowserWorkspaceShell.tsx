/**
 * ChatBrowserWorkspaceShell - Chat workspace with optional browser split layout
 *
 * This component wraps the chat experience and manages the browser dock layout.
 * Terminal dock, browser split, swarm float, chat panel, and preview shell live
 * in sibling modules (AG-15). See browser-docked-layout-design.md for design details.
 *
 * Layout modes:
 * - hidden/panel: Chat takes full width
 * - split: Browser pane + Chat pane side by side
 * - external: Browser in separate window, Chat takes full width
 */

import { useEffect, useState, lazy, Suspense } from 'react';
import { useChatStore, useUIStore } from '@/store';
import { useBrowserAgentStore } from '@/store';
import { MainLayout } from '@/layout';
import {
  SessionWorkspaceFileManagerPane,
  useSessionWorkspacePreview,
} from './SessionWorkspacePreview';
import { SwarmPanelDraggable } from './SwarmPanelDraggable';
import { BrowserChatSplitLayout } from './BrowserChatSplitLayout';
import { BrowserWorkspacePane } from './BrowserWorkspacePane';
import { ChatWorkspacePanel } from './ChatWorkspacePanel';
import { PreviewWorkspaceShell } from './PreviewWorkspaceShell';

// Lazy-loaded modal/overlay components (rarely visible on first render)
const PermissionModal = lazy(() => import('./PermissionModal'));
const QuestionnaireCard = lazy(() => import('./QuestionnaireCard'));
import { t } from '@/i18n';
import { resolveFallbackTerminalCwd } from '@/utils/terminalCwd';

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

  // Permission modal state (Ask mode) — session-scoped: only show the selected
  // session's pending approval. Other sessions' promises stay unresolved in queue.
  const permissionQueue = useUIStore((s) => s.permissionQueue);
  const permissionSessionId = useChatStore((s) => s.currentSessionId);
  const pendingPermission = permissionQueue.find(
    (permission) => permission.sessionId === permissionSessionId,
  );
  const resolvePermissionRequest = useUIStore((s) => s.resolvePermissionRequest);
  const addNotification = useUIStore((s) => s.addNotification);

  // Questionnaire state
  const activeQuestionnaire = useUIStore((s) => s.activeQuestionnaire);
  const activeQuestionnaireSessionId = useUIStore((s) => s.activeQuestionnaireSessionId);
  const submitQuestionnaire = useUIStore((s) => s.submitQuestionnaire);
  const clearQuestionnaire = useUIStore((s) => s.clearQuestionnaire);

  // Needed for fallback cwd resolve when the terminal dock opens without a session dir.
  const terminalPanelVisible = useUIStore((s) => s.terminalPanelVisible);
  const [fallbackTerminalCwd, setFallbackTerminalCwd] = useState<string | undefined>();

  const handleApprovePermission = async () => {
    if (!pendingPermission) return;
    resolvePermissionRequest(true, pendingPermission.id);
  };

  const handleDenyPermission = () => {
    if (!pendingPermission) return;
    addNotification('info', t('permission.deniedMessage'));
    resolvePermissionRequest(false, pendingPermission.id);
  };

  const {
    currentSession,
    currentSessionId,
    ensureSessionWorkDir,
  } = useChatStore();

  const currentSessionData = currentSession();
  const terminalCwd =
    currentSessionData?.projectDir || currentSessionData?.workDir || fallbackTerminalCwd;
  const canPreviewWorkspace = Boolean(
    currentSessionData?.projectDir || currentSessionData?.workDir,
  );
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
  } = useSessionWorkspacePreview(
    currentSessionData?.projectDir ?? currentSessionData?.workDir ?? null,
    previewWorkspaceActive,
  );

  useEffect(() => {
    if (
      !terminalPanelVisible ||
      currentSessionData?.projectDir ||
      currentSessionData?.workDir ||
      fallbackTerminalCwd
    ) {
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
  }, [
    currentSessionData?.projectDir,
    currentSessionData?.workDir,
    currentSessionId,
    ensureSessionWorkDir,
    fallbackTerminalCwd,
    terminalPanelVisible,
  ]);

  useEffect(() => {
    setWorkspaceMode('chat');
  }, [currentSessionId]);

  useEffect(() => {
    if (!canPreviewWorkspace && workspaceMode === 'preview') {
      setWorkspaceMode('chat');
    }
  }, [canPreviewWorkspace, workspaceMode]);

  const showChatPageModeToggle = !isSplitMode && !previewWorkspaceActive;

  const chatPanel = (
    <ChatWorkspacePanel
      showModeToggle={showChatPageModeToggle}
      workspaceMode={workspaceMode}
      canPreviewWorkspace={canPreviewWorkspace}
      onWorkspaceModeChange={setWorkspaceMode}
      terminalCwd={terminalCwd}
    />
  );

  return (
    <MainLayout
      showRightPanel={previewWorkspaceActive ? true : undefined}
      rightPanelContent={
        previewWorkspaceActive ? (
          <SessionWorkspaceFileManagerPane
            workDir={currentSessionData?.projectDir ?? currentSessionData?.workDir ?? null}
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
        <BrowserChatSplitLayout
          browserSplitFocus={browserSplitFocus}
          browser={<BrowserWorkspacePane />}
          chat={chatPanel}
        />
      ) : previewWorkspaceActive ? (
        <PreviewWorkspaceShell
          workspaceMode={workspaceMode}
          canPreview={canPreviewWorkspace}
          onWorkspaceModeChange={setWorkspaceMode}
          workDir={currentSessionData?.projectDir ?? currentSessionData?.workDir ?? null}
          selectedFilePath={selectedFilePath}
          selectedContent={selectedContent}
          fileLoading={fileLoading}
          fileError={fileError}
          onRevealPath={revealWorkspacePath}
          chat={chatPanel}
        />
      ) : (
        chatPanel
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
