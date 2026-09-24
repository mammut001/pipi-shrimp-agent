import { useCallback, useState } from 'react';
import type { MouseEvent } from 'react';
import { t } from '@/i18n';
import { useChatStore } from '@/store';

export type SidebarContextMenu = { type: 'session' | 'project'; id: string; x: number; y: number } | null;

export function useSidebarProjectController() {
  const { createProject, deleteProject, updateSessionProject } = useChatStore();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('sidebar_expanded_projects');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu>(null);
  const [showMoveChatModal, setShowMoveChatModal] = useState(false);
  const [sessionToMove, setSessionToMove] = useState<string | null>(null);
  const [targetProjectForMove, setTargetProjectForMove] = useState<string | null>(null);

  const handleCreateProject = useCallback(async () => {
    if (newProjectName.trim()) {
      await createProject(newProjectName.trim());
      setNewProjectName('');
      setShowNewProjectModal(false);
    }
  }, [newProjectName, createProject]);

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects((previous) => {
      const next = new Set(previous);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      try {
        localStorage.setItem('sidebar_expanded_projects', JSON.stringify([...next]));
      } catch (error) {
        console.warn('Failed to persist sidebar expanded projects:', error);
      }
      return next;
    });
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    if (confirm(t('sidebar.deleteProjectConfirm'))) {
      await deleteProject(projectId);
    }
    setContextMenu(null);
  }, [deleteProject]);

  const handleOpenMoveChatModal = useCallback((sessionId: string) => {
    setSessionToMove(sessionId);
    setTargetProjectForMove(null);
    setShowMoveChatModal(true);
  }, []);

  const handleMoveSession = useCallback(async () => {
    if (sessionToMove) {
      await updateSessionProject(sessionToMove, targetProjectForMove || null);
      setShowMoveChatModal(false);
      setSessionToMove(null);
      setTargetProjectForMove(null);
    }
  }, [sessionToMove, targetProjectForMove, updateSessionProject]);

  const handleContextMenu = useCallback((event: MouseEvent, type: 'session' | 'project', id: string) => {
    event.preventDefault();
    setContextMenu({ type, id, x: event.clientX, y: event.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    expandedProjects,
    toggleProject,
    showNewProjectModal,
    setShowNewProjectModal,
    newProjectName,
    setNewProjectName,
    handleCreateProject,
    contextMenu,
    setContextMenu,
    showMoveChatModal,
    setShowMoveChatModal,
    sessionToMove,
    setSessionToMove,
    targetProjectForMove,
    setTargetProjectForMove,
    handleOpenMoveChatModal,
    handleMoveSession,
    handleContextMenu,
    closeContextMenu,
    handleDeleteProject,
  };
}
