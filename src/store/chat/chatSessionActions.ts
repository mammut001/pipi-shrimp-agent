import type { StateCreator } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { ImportedFile } from '../../types/settings';
import type { ChatState, OutputFolder, Session } from '../../types/chat';
import { createProject, createSession } from '../../types/chat';
import { projectToDb, sessionToDb } from '../../utils/chatHelpers';
import { safeInvoke, safeInvokeOrNull } from '../../utils/safeInvoke';
import { useArtifactsStore } from '../artifactsStore';
import {
  bindSessionWorkDirPath,
  CURRENT_SESSION_ID_STORAGE_KEY,
  ensureSessionWorkDir,
  resetRightPanelStateAfterSessionRemoval,
} from './sessionLifecycle';
import { resetTransientSessionStateForNewChat } from './sessionIsolation';
import { getSessionHandle, releaseSessionRuntime } from '../../core/runtime';
import { safeSetItem } from '../../utils/safeStorage';
import {
  clearNonCurrentSessionToolRuntime,
  clearSessionToolRuntime,
  syncSessionToolRuntimeToCurrentSession,
} from './toolRuntimeState';
import {
  getSessionPipiOutputDir as resolveSessionPipiOutputDirHelper,
  getSessionProjectDir as resolveSessionProjectDirHelper,
} from '../../utils/sessionFolders';
import {
  FOLDER_DIALOG_BUSY_ERROR,
  folderDialogTitle,
  isFolderDialogBusyError,
} from '../../services/workspace/folderDialog';
import { useUIStore } from '../uiStore';
import {
  resolvePermissionMode,
  getExecutionMode,
  executionModeFromPermissionMode,
  hydrateSessionModes,
} from '../../services/executionMode';

type ChatStoreSet = Parameters<StateCreator<ChatState>>[0];
type ChatStoreGet = Parameters<StateCreator<ChatState>>[1];

type ChatSessionLifecycleActions = Pick<ChatState,
  | 'startSession'
  | 'addSessionWorkingFiles'
  | 'removeSessionWorkingFile'
  | 'clearSessionWorkingFiles'
  | 'updateSessionPermissionMode'
  | 'updateSessionExecutionMode'
  | 'renameSession'
>;
type ChatSessionManagementActions = Pick<ChatState,
  | 'loadSessions'
  | 'selectSession'
  | 'deleteSession'
  | 'deleteSessions'
  | 'updateSessionCwd'
  | 'updateSessionProject'
  | 'createProject'
  | 'deleteProject'
  | 'renameProject'
  | 'setSessionProjectDir'
  | 'setSessionProjectDirFromPath'
  | 'clearSessionProjectDir'
  | 'setSessionPipiOutputDir'
  | 'setSessionPipiOutputDirFromPath'
  | 'clearSessionPipiOutputDir'
  | 'setSessionWorkDir'
  | 'setSessionWorkDirFromPath'
  | 'ensureSessionWorkDir'
  | 'clearSessionWorkDir'
  | 'writeToWorkDir'
  | 'getWorkDirIndex'
>;

export const createChatSessionLifecycleActions: (
  set: ChatStoreSet,
  get: ChatStoreGet,
) => ChatSessionLifecycleActions = (set, get) => ({
    startSession: async (projectId?: string | null, model?: string) => {
      const title = `Chat ${get().sessions.length + 1}`;
      const newSession = createSession(title, projectId, model);
      const previousSessionId = get().currentSessionId;
      const uiStore = useUIStore.getState();
      const artifactsStore = useArtifactsStore.getState();

      try {
        await safeInvoke('db_save_session', { session: sessionToDb(newSession) });
      } catch (error) {
        console.error('Failed to save session to database:', error);
      }

      if (get().streamingTimeoutId) {
        clearTimeout(get().streamingTimeoutId!);
      }
      // Soak knife 3 / live soak 2026-09-16 — new chat only rebinds the
      // selected session's UI chrome. Do NOT cancel/stop/scrub/fail the previous
      // session's in-flight tools or generation; background turns keep running.
      // Stop remains explicit via stopGeneration (A ≠ B).
      // Permission queue is session-scoped: do NOT clearAllPermissions /
      // clearPermissionsForSession here — that would deny A's pending approval
      // promise when starting a new chat (GPT FIX FIRST #99 residual).
      resetTransientSessionStateForNewChat(previousSessionId, {
        clearQuestionnaire: (sessionId) => uiStore.clearQuestionnaire(sessionId),
        clearNotificationHistory: (sessionId) => uiStore.clearNotificationHistory(sessionId),
        clearArtifactId: () => uiStore.clearArtifactId(),
        clearTaskProgress: () => uiStore.clearTaskProgress(),
        setActiveSkill: (name) => uiStore.setActiveSkill(name),
        setAgentPanelTab: (tab) => uiStore.setAgentPanelTab(tab),
        closeArtifactsPanel: () => artifactsStore.closePanel(),
      });

      safeSetItem(CURRENT_SESSION_ID_STORAGE_KEY, newSession.id);
      set((state) => ({
        sessions: [...state.sessions, newSession],
        currentSessionId: newSession.id,
        isStreaming: false,
        error: null,
        streamingContent: '',
        streamingReasoning: '',
        streamingTimeoutId: null,
        pendingToolCalls: 0,
        pendingToolResults: [],
        streamingSessionId: null,
      }));
      clearSessionToolRuntime(newSession.id, set, get);
      return newSession.id;
    },

    addSessionWorkingFiles: async (sessionId: string, files: ImportedFile[]) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const updatedSession = { ...session, workingFiles: [...(session.workingFiles ?? []), ...files], updatedAt: Date.now() };
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)) }));
      await safeInvoke('db_save_session', { session: sessionToDb(updatedSession) });
    },

    removeSessionWorkingFile: async (sessionId: string, fileId: string) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const updatedSession = { ...session, workingFiles: (session.workingFiles ?? []).filter((file) => file.id !== fileId), updatedAt: Date.now() };
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)) }));
      await safeInvoke('db_save_session', { session: sessionToDb(updatedSession) });
    },

    clearSessionWorkingFiles: async (sessionId: string) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const updatedSession = { ...session, workingFiles: [], updatedAt: Date.now() };
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)) }));
      await safeInvoke('db_save_session', { session: sessionToDb(updatedSession) });
    },

    updateSessionPermissionMode: async (sessionId: string, permissionMode) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const executionMode = executionModeFromPermissionMode(permissionMode);
      const updatedSession = hydrateSessionModes({
        ...session,
        permissionMode,
        executionMode,
        updatedAt: Date.now(),
      });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)) }));
      await safeInvoke('db_save_session', { session: sessionToDb(updatedSession) });

      // Session-scoped: settle only this session's pending approvals once.
      // Do not snapshot the whole queue (other sessions) and do not
      // clearPermissionsForSession + re-resolve (double-settle).
      const approved = permissionMode === 'bypass' || permissionMode === 'auto-edits';
      const pendingForSession = useUIStore.getState().permissionQueue.filter(
        (request) => request.sessionId === sessionId,
      );
      for (const request of pendingForSession) {
        useUIStore.getState().resolvePermissionRequest(approved, request.id);
      }
    },

    /**
     * Update the 5-mode execution mode for a session and derive the
     * PermissionMode in lockstep so existing preToolUseHooks keep
     * working. Persisted via db_save_session so the choice survives reload.
     */
    updateSessionExecutionMode: async (sessionId: string, executionMode) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const profile = getExecutionMode(executionMode);
      const derivedPermissionMode = resolvePermissionMode(executionMode);
      const updatedSession = hydrateSessionModes({
        ...session,
        executionMode: profile.id,
        permissionMode: derivedPermissionMode,
        updatedAt: Date.now(),
      });
      set((state) => ({
        sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)),
      }));
      await safeInvoke('db_save_session', { session: sessionToDb(updatedSession) });

      // Mirror updateSessionPermissionMode: auto-approve modes settle only
      // this session's pending approvals once (sessionId-gated; no double-settle).
      if (profile.permissionMode === 'bypass' || profile.permissionMode === 'auto-edits') {
        const pendingForSession = useUIStore.getState().permissionQueue.filter(
          (request) => request.sessionId === sessionId,
        );
        for (const request of pendingForSession) {
          useUIStore.getState().resolvePermissionRequest(true, request.id);
        }
      }
    },

    renameSession: async (sessionId: string, newTitle: string) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const updatedSession = { ...session, title: newTitle, updatedAt: Date.now() };
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)) }));
      await safeInvoke('update_session_title', { sessionId, title: newTitle });
    },
});

export const createChatSessionManagementActions: (
  set: ChatStoreSet,
  get: ChatStoreGet,
) => ChatSessionManagementActions = (set, get) => ({
    loadSessions: (sessions: Session[]) => {
      set({ sessions });
    },

    selectSession: (sessionId: string) => {
      if (!get().sessions.some((session) => session.id === sessionId)) {
        return;
      }
      const previousSessionId = get().currentSessionId;
      if (previousSessionId === sessionId) {
        return;
      }
      if (get().streamingTimeoutId) {
        clearTimeout(get().streamingTimeoutId!);
      }
      // Soak knife 3 / live soak 2026-09-16 — session switch only rebinds the
      // selected session's busy UI. Do NOT cancel/stop/scrub the previous
      // session's in-flight tools or generation; background turns keep running.
      // Stop remains explicit via stopGeneration (A ≠ B).
      // Do NOT clearAllPermissions — pending approvals are session-scoped and
      // must stay unresolved until the owning session approves/denies/Stops.
      if (previousSessionId) {
        useUIStore.getState().clearQuestionnaire(previousSessionId);
      }
      safeSetItem(CURRENT_SESSION_ID_STORAGE_KEY, sessionId);
      set({
        currentSessionId: sessionId,
        error: null,
        // Clear selected-session stream chrome only. Background sessions keep
        // their SessionRuntime / toolRuntimeBySession entries intact.
        isStreaming: false,
        streamingContent: '',
        streamingReasoning: '',
        streamingTimeoutId: null,
        pendingToolCalls: 0,
        pendingToolResults: [],
        streamingSessionId: null,
      });
      syncSessionToolRuntimeToCurrentSession(set, get);
    },

    deleteSession: async (sessionId: string) => {
      const uiStore = useUIStore.getState();
      // Two-folder model: deleting a session cleans up BOTH folders,
      // but only the PiPi Output Folder is unconditionally app-managed.
      // The Project Folder deletion is gated on it being inside the
      // managed root (the Rust `delete_session_work_dir` enforces this).
      const sessionSnapshot = get().sessions.find((session) => session.id === sessionId);
      const sessionProjectDir = resolveSessionProjectDirHelper(sessionSnapshot);
      const sessionPipiOutputDir = resolveSessionPipiOutputDirHelper(sessionSnapshot);
      const previousCurrentSessionId = get().currentSessionId;
      await safeInvoke('db_delete_session', { sessionId });
      await safeInvokeOrNull('delete_app_chat_dir', { sessionId });
      if (sessionPipiOutputDir && sessionPipiOutputDir !== sessionProjectDir) {
        await safeInvokeOrNull('delete_session_work_dir', { path: sessionPipiOutputDir });
      }
      if (sessionProjectDir && sessionProjectDir !== sessionPipiOutputDir) {
        await safeInvokeOrNull('delete_session_work_dir', { path: sessionProjectDir });
      }
      releaseSessionRuntime(sessionId, getSessionHandle(sessionId));
      let nextSessionId: string | null = null;
      set((state) => {
        const newSessions = state.sessions.filter((session) => session.id !== sessionId);
        nextSessionId = state.currentSessionId === sessionId ? newSessions[0]?.id ?? null : state.currentSessionId;
        return { sessions: newSessions, currentSessionId: nextSessionId };
      });
      clearSessionToolRuntime(sessionId, set, get);
      // AUDIT-FIX [audit-1#2] — Drop any leftover runtime for sessions that
      // were orphaned by the deletion (e.g. when the active session was deleted
      // and we fell back to a different one).
      clearNonCurrentSessionToolRuntime(set, get);
      syncSessionToolRuntimeToCurrentSession(set, get);
      resetRightPanelStateAfterSessionRemoval([sessionId], nextSessionId, previousCurrentSessionId);
      uiStore.addNotification('success', 'Conversation deleted', sessionId);
    },

    deleteSessions: async (sessionIds: string[]) => {
      const previousCurrentSessionId = get().currentSessionId;
      const deletedSessionIds: string[] = [];
      for (const sessionId of sessionIds) {
        try {
          releaseSessionRuntime(sessionId, getSessionHandle(sessionId));
          await safeInvoke('db_delete_session', { sessionId });
          deletedSessionIds.push(sessionId);
          await safeInvokeOrNull('delete_app_chat_dir', { sessionId });
          const sessionSnapshot = get().sessions.find((session) => session.id === sessionId);
          const sessionProjectDir = resolveSessionProjectDirHelper(sessionSnapshot);
          const sessionPipiOutputDir = resolveSessionPipiOutputDirHelper(sessionSnapshot);
          if (sessionPipiOutputDir && sessionPipiOutputDir !== sessionProjectDir) {
            await safeInvokeOrNull('delete_session_work_dir', { path: sessionPipiOutputDir });
          }
          if (sessionProjectDir && sessionProjectDir !== sessionPipiOutputDir) {
            await safeInvokeOrNull('delete_session_work_dir', { path: sessionProjectDir });
          }
        } catch (error) {
          console.error(`Failed to delete session ${sessionId}:`, error);
        }
      }
      let nextSessionId: string | null = null;
      set((state) => {
        const deletedSet = new Set(deletedSessionIds);
        const newSessions = state.sessions.filter((session) => !deletedSet.has(session.id));
        nextSessionId = state.currentSessionId && deletedSet.has(state.currentSessionId)
          ? newSessions[0]?.id ?? null
          : state.currentSessionId;
        return { sessions: newSessions, currentSessionId: nextSessionId };
      });
      for (const deletedSessionId of deletedSessionIds) {
        clearSessionToolRuntime(deletedSessionId, set, get);
      }
      // AUDIT-FIX [audit-1#2] — Same cleanup as deleteSession: prune any other
      // session's leftover runtime after a bulk delete.
      clearNonCurrentSessionToolRuntime(set, get);
      syncSessionToolRuntimeToCurrentSession(set, get);
      resetRightPanelStateAfterSessionRemoval(deletedSessionIds, nextSessionId, previousCurrentSessionId);
    },

    updateSessionCwd: async (sessionId: string, cwd: string) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      // Two-folder model: `cwd` represents the Project Folder. Mirror
      // into both `projectDir` and `workDir`. `pipiOutputDir` stays
      // independent — chat/store callers manage it explicitly via
      // `setSessionPipiOutputDir` / `clearSessionPipiOutputDir`.
      const updatedSession = {
        ...session,
        cwd,
        projectDir: cwd,
        workDir: cwd,
        updatedAt: Date.now(),
      };
      await safeInvoke('db_save_session', { session: sessionToDb(updatedSession) });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)) }));
    },

    updateSessionProject: async (sessionId: string, projectId: string | null) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const updatedSession = { ...session, projectId: projectId || undefined, updatedAt: Date.now() };
      await invoke('db_save_session', { session: sessionToDb(updatedSession) });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)) }));
    },

    createProject: async (name: string) => {
      const newProject = createProject(name);
      await invoke('db_save_project', { project: projectToDb(newProject) });
      set((state) => ({ projects: [...state.projects, newProject] }));
    },

    deleteProject: async (projectId: string) => {
      await invoke('db_delete_project', { projectId });
      const sessionsInProject = get().sessions.filter((session) => session.projectId === projectId);
      for (const session of sessionsInProject) {
        await invoke('db_delete_session', { sessionId: session.id });
      }
      set((state) => ({
        projects: state.projects.filter((project) => project.id !== projectId),
        sessions: state.sessions.filter((session) => session.projectId !== projectId),
        currentSessionId: sessionsInProject.some((session) => session.id === state.currentSessionId)
          ? state.sessions.find((session) => session.projectId !== projectId)?.id || null
          : state.currentSessionId,
      }));
    },

    renameProject: async (projectId: string, name: string) => {
      const project = get().projects.find((candidate) => candidate.id === projectId);
      if (!project) {
        return;
      }
      const updatedProject = { ...project, name, updatedAt: Date.now() };
      await invoke('db_update_project', { project: projectToDb(updatedProject) });
      set((state) => ({ projects: state.projects.map((candidate) => (candidate.id === projectId ? updatedProject : candidate)) }));
    },

    setSessionProjectDir: async (sessionId: string) => {
      let selectedPath: string | null;
      try {
        selectedPath = await invoke<string | null>('open_folder_dialog', {
          title: folderDialogTitle('project'),
        });
      } catch (error) {
        const message = isFolderDialogBusyError(error)
          ? `Folder picker already open (${FOLDER_DIALOG_BUSY_ERROR}). Close it, then try again.`
          : `Could not open Project Folder picker: ${error instanceof Error ? error.message : String(error)}`;
        useUIStore.getState().addNotification('warning', message, sessionId);
        return null;
      }
      if (!selectedPath) {
        return null;
      }
      return bindSessionWorkDirPath(sessionId, selectedPath, set, get);
    },

    setSessionProjectDirFromPath: async (sessionId: string, path: string) => {
      // Defensive trim — empty / whitespace inputs collapse to null so the
      // caller can short-circuit. The folder-picker variant returns null
      // for the same reason (user cancellation).
      const trimmed = (path ?? '').trim();
      if (!trimmed) {
        return null;
      }
      return bindSessionWorkDirPath(sessionId, trimmed, set, get);
    },

    clearSessionProjectDir: async (sessionId: string) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      // Two-folder model: clearing the Project Folder must NOT clear
      // the PiPi Output Folder — they're independent bindings.
      const updated = {
        ...session,
        projectDir: undefined,
        workDir: undefined,
        updatedAt: Date.now(),
      };
      await invoke('db_save_session', { session: sessionToDb(updated) });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
    },

    setSessionPipiOutputDir: async (sessionId: string) => {
      let selectedPath: string | null;
      try {
        selectedPath = await invoke<string | null>('open_folder_dialog', {
          title: folderDialogTitle('output'),
        });
      } catch (error) {
        const message = isFolderDialogBusyError(error)
          ? `Folder picker already open (${FOLDER_DIALOG_BUSY_ERROR}). Close it, then try again.`
          : `Could not open PiPi Output Folder picker: ${error instanceof Error ? error.message : String(error)}`;
        useUIStore.getState().addNotification('warning', message, sessionId);
        return null;
      }
      if (!selectedPath) {
        return null;
      }
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return null;
      }
      // The PiPi Output Folder is independent — we don't run
      // `init_pipi_shrimp` here because that helper mutates the
      // selected folder's `.gitignore`. The user has already chosen
      // an output root; we just persist it.
      const updated = {
        ...session,
        pipiOutputDir: selectedPath,
        updatedAt: Date.now(),
      };
      await invoke('db_save_session', { session: sessionToDb(updated) });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
      return selectedPath;
    },

    setSessionPipiOutputDirFromPath: async (sessionId: string, path: string) => {
      const trimmed = (path ?? '').trim();
      if (!trimmed) {
        return null;
      }
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return null;
      }
      const updated = {
        ...session,
        pipiOutputDir: trimmed,
        updatedAt: Date.now(),
      };
      await invoke('db_save_session', { session: sessionToDb(updated) });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
      return trimmed;
    },

    clearSessionPipiOutputDir: async (sessionId: string) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      // Clearing the PiPi Output Folder means future reads fall back
      // to the app-managed default `{Documents|HOME}/PiPi-Shrimp/chats/{id}/`.
      const updated = { ...session, pipiOutputDir: undefined, updatedAt: Date.now() };
      await invoke('db_save_session', { session: sessionToDb(updated) });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
    },

    setSessionWorkDir: async (sessionId: string) => get().setSessionProjectDir(sessionId),

    setSessionWorkDirFromPath: async (sessionId: string, path: string) =>
      get().setSessionProjectDirFromPath(sessionId, path),

    ensureSessionWorkDir: async (sessionId: string) => ensureSessionWorkDir(sessionId, set, get),

    clearSessionWorkDir: async (sessionId: string) => get().clearSessionProjectDir(sessionId),

    writeToWorkDir: async (sessionId: string, filename: string, content: string) => {
      // Two-folder model: `writeToWorkDir` writes into the PiPi Output
      // Folder, NOT the Project Folder. Generated artifacts (docs,
      // scratch files, plan-mode output, …) must not pollute the user's
      // repo. The legacy `get_next_output_dir` Rust helper is still
      // used for backwards-compatible date-stamped subfolders; it's
      // pointed at the PiPi Output Folder root so the layout matches
      // the previous UX.
      let session = get().sessions.find((candidate) => candidate.id === sessionId);
      let pipiOutputDir = session?.pipiOutputDir;
      if (!pipiOutputDir) {
        // No explicit binding — auto-provision the app-managed default.
        const ensured = await get().ensureSessionWorkDir(sessionId);
        if (!ensured) {
          useUIStore.getState().addNotification(
            'info',
            '请选择一个输出文件夹来保存生成的文件。',
            sessionId,
          );
          return null;
        }
        session = get().sessions.find((candidate) => candidate.id === sessionId);
        pipiOutputDir = session?.pipiOutputDir;
      }
      if (!pipiOutputDir) {
        return null;
      }
      try {
        let outputDir = session?.outputDir;
        // Compute the date-stamped subfolder relative to the PiPi
        // Output Folder root. The Rust helper's signature is unchanged
        // — it takes any folder and creates `{root}/.pipi-shrimp/{date}-{i}/`.
        const rootForDateFolder = pipiOutputDir;
        if (!outputDir || !outputDir.startsWith(rootForDateFolder)) {
          outputDir = await invoke<string>('get_next_output_dir', { workDir: rootForDateFolder });
          await invoke('create_directory', { path: outputDir });
          if (session) {
            const updated = { ...session, outputDir, updatedAt: Date.now() };
            set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
          }
        }
        const filePath = `${outputDir}/${filename}`;
        await invoke('write_file', { path: filePath, content });
        return filePath;
      } catch (error) {
        console.error('Failed to write to work dir:', error);
        return null;
      }
    },

    getWorkDirIndex: async (sessionId: string) => {
      // Two-folder model: the "work dir index" lists the dated
      // subfolders inside the PiPi Output Folder (where generated
      // outputs actually land). Project Folder is excluded by design.
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      const pipiOutputDir = session?.pipiOutputDir;
      if (!pipiOutputDir) {
        return [];
      }
      try {
        return await invoke<OutputFolder[]>('list_pipi_shrimp_index', { workDir: pipiOutputDir });
      } catch (error) {
        console.error('Failed to get work dir index:', error);
        return [];
      }
    },
});
