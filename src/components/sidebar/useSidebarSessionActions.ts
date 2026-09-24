import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Session } from '@/types/chat';
import { t } from '@/i18n';
import { useChatStore } from '@/store';
import type { SidebarContextMenu } from './useSidebarProjectController';
import type { SidebarSessionState } from './useSidebarSessionState';

type ChatStore = ReturnType<typeof useChatStore.getState>;

interface SidebarSessionActionsOptions {
  sessions: ChatStore['sessions'];
  state: SidebarSessionState;
  setContextMenu: Dispatch<SetStateAction<SidebarContextMenu>>;
}

export function useSidebarSessionActions({ sessions, state, setContextMenu }: SidebarSessionActionsOptions) {
  const { selectSession, deleteSession, deleteSessions, renameSession } = useChatStore();
  const {
    selectedSessions,
    sessionToDelete,
    setSelectedSessions,
    setIsMultiSelectMode,
    ungroupedSessions,
    renamingSessionId,
    setRenamingSessionId,
    renameInput,
    setRenameInput,
    setShowDeleteConfirm,
    setSessionToDelete,
    setShowBatchDeleteConfirm,
  } = state;

  const handleOpenDeleteConfirm = useCallback((sessionId: string) => {
    setSessionToDelete(sessionId);
    setShowDeleteConfirm(true);
  }, [setSessionToDelete, setShowDeleteConfirm]);

  const handleConfirmDelete = useCallback(async () => {
    if (sessionToDelete) {
      try {
        await deleteSession(sessionToDelete);
        setShowDeleteConfirm(false);
        setSessionToDelete(null);
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
  }, [sessionToDelete, deleteSession, setShowDeleteConfirm, setSessionToDelete]);

  const handleSelectSession = useCallback((sessionId: string) => {
    selectSession(sessionId);
  }, [selectSession]);

  const getSessionPreview = useCallback((session: Session): string => {
    if (session.messages.length === 0) {
      return t('sidebar.chatFallback');
    }
    const lastMessage = session.messages[session.messages.length - 1];
    const preview = lastMessage.content.substring(0, 50);
    return preview + (lastMessage.content.length > 50 ? '...' : '');
  }, []);

  const handleToggleSessionSelection = useCallback((sessionId: string) => {
    setSelectedSessions((previous) => {
      const next = new Set(previous);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, [setSelectedSessions]);

  const handleSelectAll = useCallback(() => {
    const ungroupedIds = ungroupedSessions.map((session) => session.id);
    const allUngroupedSelected = ungroupedIds.every((id) => selectedSessions.has(id));
    setSelectedSessions(
      allUngroupedSelected && selectedSessions.size > 0
        ? new Set()
        : new Set(ungroupedIds),
    );
  }, [ungroupedSessions, selectedSessions, setSelectedSessions]);

  const handleBatchDelete = useCallback(() => {
    if (selectedSessions.size > 0) {
      setShowBatchDeleteConfirm(true);
    }
  }, [selectedSessions, setShowBatchDeleteConfirm]);

  const handleConfirmBatchDelete = useCallback(async () => {
    try {
      await deleteSessions(Array.from(selectedSessions));
      setSelectedSessions(new Set());
      setIsMultiSelectMode(false);
      setShowBatchDeleteConfirm(false);
    } catch (error) {
      console.error('Failed to batch delete sessions:', error);
    }
  }, [selectedSessions, deleteSessions, setSelectedSessions, setIsMultiSelectMode, setShowBatchDeleteConfirm]);

  const handleStartRename = useCallback((sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (session) {
      setRenamingSessionId(sessionId);
      setRenameInput(session.title);
      setContextMenu(null);
    }
  }, [sessions, setRenamingSessionId, setRenameInput, setContextMenu]);

  const handleConfirmRename = useCallback(async () => {
    if (renamingSessionId && renameInput.trim()) {
      await renameSession(renamingSessionId, renameInput.trim());
    }
    setRenamingSessionId(null);
    setRenameInput('');
  }, [renamingSessionId, renameInput, renameSession, setRenamingSessionId, setRenameInput]);

  const handleCancelRename = useCallback(() => {
    setRenamingSessionId(null);
    setRenameInput('');
  }, [setRenamingSessionId, setRenameInput]);

  return {
    handleOpenDeleteConfirm,
    handleConfirmDelete,
    handleSelectSession,
    getSessionPreview,
    handleToggleSessionSelection,
    handleSelectAll,
    handleBatchDelete,
    handleConfirmBatchDelete,
    handleStartRename,
    handleConfirmRename,
    handleCancelRename,
  };
}
