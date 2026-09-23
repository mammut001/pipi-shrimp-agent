import { useState, useCallback } from 'react';
import { safeInvoke, safeInvokeOrNull } from '@/utils/safeInvoke';
import { useChatStore } from '@/store';
import type { Session } from '@/types/chat';

export interface UseSessionFolderBindingsParams {
  currentSession?: Session | null;
  projectDir?: string | null;
  setSessionProjectDir?: (sessionId: string) => Promise<string | null>;
  clearSessionProjectDir?: (sessionId: string) => Promise<void>;
  setSessionPipiOutputDir?: (sessionId: string) => Promise<string | null>;
  clearSessionPipiOutputDir?: (sessionId: string) => Promise<void>;
}

export function useSessionFolderBindings({
  currentSession,
  projectDir,
  setSessionProjectDir: setProjectDirOverride,
  clearSessionProjectDir: clearProjectDirOverride,
  setSessionPipiOutputDir: setOutputDirOverride,
  clearSessionPipiOutputDir: clearOutputDirOverride,
}: UseSessionFolderBindingsParams = {}) {
  const [isBindingFolder, setIsBindingFolder] = useState<'project' | 'output' | null>(null);

  const chatStore = useChatStore();
  const setSessionProjectDir = setProjectDirOverride ?? chatStore.setSessionProjectDir;
  const clearSessionProjectDir = clearProjectDirOverride ?? chatStore.clearSessionProjectDir;
  const setSessionPipiOutputDir = setOutputDirOverride ?? chatStore.setSessionPipiOutputDir;
  const clearSessionPipiOutputDir = clearOutputDirOverride ?? chatStore.clearSessionPipiOutputDir;

  const handleBindProject = useCallback(async () => {
    if (!currentSession) return null;
    setIsBindingFolder('project');
    try {
      return await setSessionProjectDir(currentSession.id);
    } finally {
      setIsBindingFolder(null);
    }
  }, [currentSession, setSessionProjectDir]);

  const handleClearProject = useCallback(async () => {
    if (!currentSession) return;
    setIsBindingFolder('project');
    try {
      await clearSessionProjectDir(currentSession.id);
    } finally {
      setIsBindingFolder(null);
    }
  }, [currentSession, clearSessionProjectDir]);

  const handleBindOutput = useCallback(async () => {
    if (!currentSession) return null;
    setIsBindingFolder('output');
    try {
      return await setSessionPipiOutputDir(currentSession.id);
    } finally {
      setIsBindingFolder(null);
    }
  }, [currentSession, setSessionPipiOutputDir]);

  const handleClearOutput = useCallback(async () => {
    if (!currentSession) return;
    setIsBindingFolder('output');
    try {
      await clearSessionPipiOutputDir(currentSession.id);
    } finally {
      setIsBindingFolder(null);
    }
  }, [currentSession, clearSessionPipiOutputDir]);

  /**
   * Handle opening the current Project Folder in Finder
   */
  const handleOpenFolder = useCallback(async () => {
    try {
      // Two-folder model: the "Open folder" button targets the
      // Project Folder (the user's repo), not the PiPi Output
      // Folder. Falling back to the app-managed PiPi Output Folder
      // is still useful so the user has *some* folder to land in
      // when no Project Folder is bound.
      let targetPath: string | undefined = projectDir ?? currentSession?.projectDir ?? currentSession?.workDir;
      if (!targetPath && currentSession?.id) {
        targetPath = await safeInvokeOrNull<string>('get_app_default_dir', { sessionId: currentSession.id }, { source: 'ChatInput.getDefaultDir' }) ?? undefined;
      }
      if (targetPath) {
        await safeInvoke('reveal_in_finder', { path: targetPath }, { source: 'ChatInput.openFolder' });
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, [projectDir, currentSession]);

  return {
    isBindingFolder,
    handleBindProject,
    handleClearProject,
    handleBindOutput,
    handleClearOutput,
    handleOpenFolder,
  };
}
