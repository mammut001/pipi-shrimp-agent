import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

import { triggerLegacyCompact } from '../services/compact/compact';
import { resolvePermissionMode, getExecutionMode } from '../services/executionMode';
import { getCompactConfig, getContextTokenStats } from '../services/compact/config';
import { runMicrocompactCheck } from '../services/compact/microCompact';
import { trySessionMemoryCompact } from '../services/compact/sessionMemoryCompact';
import type { ImportedFile } from '../types/settings';
import type { ChatState, Message, OutputFolder, Session } from '../types/chat';
import { createMessage, createProject, createSession } from '../types/chat';
import {
  dbToProject,
  dbToSession,
  messageToDb,
  projectToDb,
  sessionToDb,
  type DbMessage,
  type DbProject,
  type DbSession,
} from '../utils/chatHelpers';
import { safeInvoke, safeInvokeOrNull } from '../utils/safeInvoke';
import { useArtifactsStore } from './artifactsStore';
import { createChatActionMethods } from './chat/chatActions';
import { resetTransientSessionStateForNewChat } from './chat/sessionIsolation';
import { filterSessionsByProject, selectCurrentMessages, selectCurrentSession } from './chat/chatSelectors';
import { resolveStreamingOwnerSessionId } from './chat/chatStreaming';
import { safeSetItem, safeRemoveItem, safeGetItem, safeMigrateKey } from '@/utils/safeStorage';
import {
  clearNonCurrentSessionToolRuntime,
  clearSessionToolRuntime,
  failUnresolvedSessionTools,
  markSessionToolRunning,
  resetAllSessionToolRuntime,
  resolveSessionTool,
  syncSessionToolRuntimeToCurrentSession,
} from './chat/toolRuntimeState';
import { useUIStore } from './uiStore';

// AUDIT-FIX [fix-20#1] — Renamed from the legacy `ai-agent-*` namespace
// to `pipi-shrimp-*` to match the current product name. We also read the
// old key once on first load to migrate existing users.
const CURRENT_SESSION_ID_STORAGE_KEY = 'pipi-shrimp-current-session-id';
const LEGACY_CURRENT_SESSION_ID_STORAGE_KEY = 'ai-agent-current-session-id';

type RuntimeListenerCleanup = () => void;
type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

let runtimeListenerCleanups: RuntimeListenerCleanup[] = [];

function clearRuntimeListeners() {
  for (const cleanup of runtimeListenerCleanups) {
    try {
      cleanup();
    } catch (error) {
      console.warn('Failed to cleanup runtime listener:', error);
    }
  }
  runtimeListenerCleanups = [];
}

async function runSMCompactAfterStreaming(sessionId: string, set: ChatSetState, get: () => ChatState): Promise<void> {
  try {
    const config = getCompactConfig();
    const session = get().sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      return;
    }

    const stats = await getContextTokenStats(sessionId);
    const workDir = session.workDir ?? undefined;
    if (stats.current >= config.sm_auto_threshold_tokens) {
      const result = await trySessionMemoryCompact(sessionId, session.messages, workDir);
      if (result.did_compact && result.boundary_message && result.summary_message) {
        set((state) => ({
          sessions: state.sessions.map((candidate) => {
            if (candidate.id !== sessionId) {
              return candidate;
            }
            return {
              ...candidate,
              messages: [
                {
                  id: result.boundary_message!.id,
                  role: 'system',
                  content: result.boundary_message!.content,
                  timestamp: result.boundary_message!.created_at * 1000,
                  metadata: {
                    subtype: 'compact_boundary',
                    compact_type: result.boundary_message!.compact_type,
                  },
                },
                result.summary_message!,
                ...candidate.messages.slice(result.deleted_count!),
              ],
            };
          }),
        }));
        return;
      }
    }

    if (stats.current >= config.legacy_auto_threshold_tokens) {
      const result = await triggerLegacyCompact(sessionId, session.messages, workDir);
      if (result.success && result.boundary_message && result.summary_message) {
        set((state) => ({
          sessions: state.sessions.map((candidate) => {
            if (candidate.id !== sessionId) {
              return candidate;
            }
            return {
              ...candidate,
              messages: [
                {
                  id: result.boundary_message!.id,
                  role: 'system',
                  content: result.boundary_message!.content,
                  timestamp: result.boundary_message!.created_at * 1000,
                  metadata: {
                    subtype: 'compact_boundary',
                    compact_type: result.boundary_message!.compact_type,
                  },
                },
                result.summary_message!,
                ...(result.messages_to_keep ?? []),
              ],
            };
          }),
        }));
      } else if (result.error) {
        useUIStore.getState().addNotification(
          'warning',
          `Context compression failed: ${result.error}. Context window may fill up.`,
          sessionId,
        );
      }
    }
  } catch (error) {
    console.warn('[Compact] Check failed:', error);
    useUIStore.getState().addNotification('warning', 'Context compression check failed. Consider freeing up space.', sessionId);
  }
}

async function runMicrocompactAfterStreaming(sessionId: string, set: ChatSetState): Promise<void> {
  try {
    const result = await runMicrocompactCheck(sessionId);
    if (result.did_compact && result.updates?.length) {
      for (const update of result.updates) {
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) {
              return session;
            }
            return {
              ...session,
              messages: session.messages.map((message) => (
                message.id === update.message_id
                  ? {
                      ...message,
                      content: update.new_content,
                      metadata: {
                        ...message.metadata,
                        compact_metadata: {
                          tool_result_cleared: true,
                          tool_result_cleared_at: update.cleared_at,
                          estimated_tokens: 5,
                        },
                      },
                    }
                  : message
              )),
            };
          }),
        }));
      }
    }
  } catch (error) {
    console.warn('[Microcompact] Check failed:', error);
  }
}

async function ensureSessionWorkDir(sessionId: string, set: ChatSetState, get: () => ChatState): Promise<string | null> {
  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    return null;
  }
  if (session.workDir) {
    return session.workDir;
  }

  const maxRetries = 3;
  const baseDelayMs = 1000;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const defaultDir = await safeInvoke<string>('get_app_default_dir', { sessionId });
      await safeInvoke('create_directory', { path: defaultDir });
      const latestSession = get().sessions.find((candidate) => candidate.id === sessionId) ?? session;
      const updated = { ...latestSession, workDir: defaultDir, updatedAt: Date.now() };
      await safeInvoke('db_save_session', { session: sessionToDb(updated) });
      set((state) => ({
        sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)),
      }));
      return defaultDir;
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
        console.error('[workDir] Failed to auto-assign default directory after retries:', error);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }

  // AUDIT-FIX [fix-6#1] — Surface the failure to the user via a toast
  // notification. The previous behaviour silently returned `null`, leaving
  // the user staring at a chat session that has no working directory and
  // every tool call will subsequently fail.
  try {
    useUIStore.getState().addNotification(
      'error',
      `Failed to create session work directory: ${String(
        lastError instanceof Error ? lastError.message : lastError ?? 'unknown error',
      )}`,
      sessionId,
    );
  } catch {
    // UI store may not be ready; the console.error above is the fallback.
  }
  return null;
}

async function scrubDanglingToolCalls(sessionId: string, set: ChatSetState, get: () => ChatState): Promise<void> {
  const session = get().sessions.find((candidate) => candidate.id === sessionId);
  if (!session || session.messages.length === 0) {
    return;
  }

  const lastMessage = session.messages[session.messages.length - 1];
  if (lastMessage.role !== 'assistant' || !lastMessage.tool_calls?.length) {
    return;
  }

  const cleanedMessage: Message = {
    ...lastMessage,
    content: lastMessage.content.trim() || '[Tool execution cancelled before completion.]',
    tool_calls: undefined,
  };

  set((state) => ({
    sessions: state.sessions.map((candidate) => (
      candidate.id === sessionId
        ? {
            ...candidate,
            updatedAt: Date.now(),
            messages: candidate.messages.map((message, index) => (
              index === candidate.messages.length - 1 ? cleanedMessage : message
            )),
          }
        : candidate
    )),
  }));

  try {
    await safeInvoke('db_save_message', { message: messageToDb(cleanedMessage, sessionId) });
  } catch (error) {
    console.error('Failed to scrub dangling tool_calls from database:', error);
  }
}

function resetRightPanelStateAfterSessionRemoval(
  deletedSessionIds: string[],
  nextSessionId: string | null,
  previousCurrentSessionId: string | null,
) {
  const uiStore = useUIStore.getState();
  const artifactsStore = useArtifactsStore.getState();
  const currentSessionWasDeleted = previousCurrentSessionId
    ? deletedSessionIds.includes(previousCurrentSessionId)
    : false;

  for (const sessionId of deletedSessionIds) {
    uiStore.clearQuestionnaire(sessionId);
  }

  if (currentSessionWasDeleted || nextSessionId === null) {
    uiStore.clearAllPermissions();
    uiStore.clearArtifactId();
    uiStore.clearTaskProgress();
    uiStore.setActiveSkill(null);
    uiStore.setAgentPanelTab('main');
    artifactsStore.closePanel();
  }

  if (nextSessionId) {
    // AUDIT-FIX [fix-22#1] — Use the safe localStorage helper so a quota
    // or private-mode error doesn't crash the persistence path.
    safeSetItem(CURRENT_SESSION_ID_STORAGE_KEY, nextSessionId);
  } else {
    safeRemoveItem(CURRENT_SESSION_ID_STORAGE_KEY);
  }
}

export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => ({
    sessions: [],
    projects: [],
    currentSessionId: null,
    isStreaming: false,
    isInitialized: false,
    streamingContent: '',
    streamingReasoning: '',
    error: null,
    streamingTimeoutId: null,
    lastUiUpdateTime: 0,
    pendingToolCalls: 0,
    pendingToolResults: [],
    streamingSessionId: null,

    currentSession: () => selectCurrentSession(get().sessions, get().currentSessionId),
    currentMessages: () => selectCurrentMessages(get().sessions, get().currentSessionId),
    getSessionsByProject: (projectId: string | null) => filterSessionsByProject(get().sessions, projectId),

    init: async () => {
      if (get().isInitialized) {
        return;
      }
      set({ isInitialized: true });

      try {
        try {
          const dbProjects = await invoke<DbProject[]>('db_get_all_projects');
          set({ projects: dbProjects.map(dbToProject) });
        } catch (error) {
          console.warn('Failed to load projects from database, keeping existing state:', error);
        }

        const dbSessions = await invoke<DbSession[]>('db_get_all_sessions');
        const sessions = await Promise.all(
          dbSessions.map(async (dbSession) => {
            try {
              let dbMessages = await invoke<DbMessage[]>('db_get_messages', { sessionId: dbSession.id });
              if (dbMessages.length > 0) {
                const last = dbMessages[dbMessages.length - 1];
                if (last.role === 'assistant' && (!last.content || last.content.trim() === '') && !last.reasoning && !last.tool_calls) {
                  dbMessages = dbMessages.slice(0, -1);
                }
              }
              return dbToSession(dbSession, dbMessages);
            } catch (error) {
              console.warn(`Failed to load messages for session ${dbSession.id}, loading with empty messages:`, error);
              return dbToSession(dbSession, []);
            }
          }),
        );

        set({ sessions });
        // AUDIT-FIX [fix-22#1] — Use the safe localStorage helper. The
        // legacy → new key migration is now handled by `safeMigrateKey`.
        const current = safeGetItem<string>(CURRENT_SESSION_ID_STORAGE_KEY);
        let savedSessionId: string | null = current.value;
        if (!savedSessionId) {
          savedSessionId = safeMigrateKey(
            LEGACY_CURRENT_SESSION_ID_STORAGE_KEY,
            CURRENT_SESSION_ID_STORAGE_KEY,
          )
            ? safeGetItem<string>(CURRENT_SESSION_ID_STORAGE_KEY).value
            : null;
        }
        if (savedSessionId && sessions.some((session) => session.id === savedSessionId)) {
          set({ currentSessionId: savedSessionId });
        } else {
          set({ currentSessionId: null });
        }

        set({ isInitialized: true, error: null });
        clearRuntimeListeners();
        resetAllSessionToolRuntime();
        const { listen } = await import('@tauri-apps/api/event');
        const unlistenSubagentComplete = await listen<{ agentId: string; sessionId: string; success: boolean }>('subagent-complete', (event) => {
          useUIStore.getState().addNotification(
            event.payload.success ? 'success' : 'error',
            `Agent ${event.payload.agentId.slice(0, 12)}... completed`,
            event.payload.sessionId,
          );
        });
        runtimeListenerCleanups.push(unlistenSubagentComplete);

        const unlistenSubagentError = await listen<{ agentId: string; sessionId: string; error: string }>('subagent-error', (event) => {
          useUIStore.getState().addNotification(
            'error',
            `Agent ${event.payload.agentId.slice(0, 12)}... failed: ${event.payload.error}`,
            event.payload.sessionId,
          );
        });
        runtimeListenerCleanups.push(unlistenSubagentError);

        const unlistenToolStart = await listen<{ session_id: string; tool_call_id: string; name: string }>('tool-start', (event) => {
          if (!get().sessions.some((session) => session.id === event.payload.session_id)) {
            return;
          }
          markSessionToolRunning(
            event.payload.session_id,
            event.payload.tool_call_id,
            event.payload.name,
            set,
            get,
          );
        });
        runtimeListenerCleanups.push(unlistenToolStart);

        const unlistenToolComplete = await listen<{ session_id: string; tool_call_id: string; name: string; is_error: boolean }>('tool-complete', (event) => {
          if (!get().sessions.some((session) => session.id === event.payload.session_id)) {
            return;
          }
          resolveSessionTool(
            event.payload.session_id,
            event.payload.tool_call_id,
            event.payload.name,
            event.payload.is_error ? 'failed' : 'done',
            event.payload.is_error ? `Error: ${event.payload.name} failed` : '',
            set,
            get,
          );
        });
        runtimeListenerCleanups.push(unlistenToolComplete);

        const unlistenToolError = await listen<{ session_id: string; tool_call_id: string; name: string; error: string }>('tool-error', (event) => {
          if (!get().sessions.some((session) => session.id === event.payload.session_id)) {
            return;
          }
          resolveSessionTool(
            event.payload.session_id,
            event.payload.tool_call_id,
            event.payload.name,
            'failed',
            `Error: ${event.payload.error}`,
            set,
            get,
          );
        });
        runtimeListenerCleanups.push(unlistenToolError);

        const swarmModule = await import('../services/swarm');
        const unsubscribeSwarmTaskResults = swarmModule.swarmEvents.on('task_result_received', async (detail) => {
          try {
            const { findDelegationForAgent } = await import('../services/orchestration');
            if (findDelegationForAgent(detail.fromAgentId)) {
              return;
            }
          } catch {
            // ignore orchestration availability issues here
          }

          const team = swarmModule.getTeam(detail.teamId);
          if (!team?.sessionId) {
            return;
          }
          if (!get().sessions.some((session) => session.id === team.sessionId)) {
            return;
          }
          const fromAgent = swarmModule.getAgent(detail.fromAgentId);
          const agentName = fromAgent?.name || detail.fromAgentId.slice(-8);
          const task = detail.taskId ? swarmModule.getTask(detail.taskId) : undefined;
          const taskDesc = task?.description?.slice(0, 80) ?? 'task';
          await get().addMessageToSession(
            team.sessionId,
            createMessage('user', `[Swarm] Teammate "${agentName}" completed "${taskDesc}":\n\n${detail.content}`),
          );
          useUIStore.getState().addNotification('success', `Teammate "${agentName}" finished: ${taskDesc}`, team.sessionId);
        });
        runtimeListenerCleanups.push(unsubscribeSwarmTaskResults);
      } catch (error) {
        console.error('Failed to load sessions:', error);
        try {
          // AUDIT-FIX [fix-20#1] / [fix-22#1] — Try the new key first,
          // then fall back to the legacy `ai-agent-sessions` namespace so
          // existing installations keep their data. Uses the safe
          // storage helpers for quota-error tolerance.
          let stored = safeGetItem<string>('pipi-shrimp-sessions').value;
          if (!stored) {
            const migrated = safeMigrateKey(
              'ai-agent-sessions',
              'pipi-shrimp-sessions',
            );
            if (migrated) {
              stored = safeGetItem<string>('pipi-shrimp-sessions').value;
            }
          }
          if (stored) {
            set({ sessions: JSON.parse(stored) as Session[] });
          }
        } catch (localStorageError) {
          console.error('Failed to load from localStorage:', localStorageError);
        }
        set({ isInitialized: false, error: `Failed to load sessions: ${error instanceof Error ? error.message : String(error)}` });
      }
    },

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
      if (
        previousSessionId
        && (get().pendingToolCalls > 0 || get().pendingToolResults.length > 0 || uiStore.permissionQueue.length > 0)
      ) {
        failUnresolvedSessionTools(
          previousSessionId,
          set,
          get,
          (_toolCallId, label) => `Error: ${label} cancelled due to session change`,
        );
      }
      resetTransientSessionStateForNewChat(previousSessionId, {
        isStreaming: get().isStreaming,
        pendingToolCalls: get().pendingToolCalls,
        pendingToolResultsLength: get().pendingToolResults.length,
        permissionQueueLength: uiStore.permissionQueue.length,
      }, {
        stopSubprocess: (sessionId) => {
          safeInvokeOrNull('stop_subprocess', { sessionId });
        },
        clearAllPermissions: () => uiStore.clearAllPermissions(),
        clearQuestionnaire: (sessionId) => uiStore.clearQuestionnaire(sessionId),
        clearNotificationHistory: (sessionId) => uiStore.clearNotificationHistory(sessionId),
        clearArtifactId: () => uiStore.clearArtifactId(),
        clearTaskProgress: () => uiStore.clearTaskProgress(),
        setActiveSkill: (name) => uiStore.setActiveSkill(name),
        setAgentPanelTab: (tab) => uiStore.setAgentPanelTab(tab),
        closeArtifactsPanel: () => artifactsStore.closePanel(),
        scrubDanglingToolCalls: (sessionId) => {
          void scrubDanglingToolCalls(sessionId, set, get);
        },
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
      const pendingPermissions = get().currentSessionId === sessionId ? [...useUIStore.getState().permissionQueue] : [];
      const updatedSession = { ...session, permissionMode, updatedAt: Date.now() };
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)) }));
      await safeInvoke('db_save_session', { session: sessionToDb(updatedSession) });

      if (pendingPermissions.length === 0) {
        return;
      }
      useUIStore.getState().clearAllPermissions();
      for (const request of pendingPermissions) {
        request._resolve?.(permissionMode === 'bypass' || permissionMode === 'auto-edits');
      }
    },

    /**
     * Update the 6-mode execution mode for a session and derive the
     * 4-mode PermissionMode in lockstep so existing preToolUseHooks keep
     * working. Persisted via db_save_session so the choice survives reload.
     */
    updateSessionExecutionMode: async (sessionId: string, executionMode) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const profile = getExecutionMode(executionMode);
      const derivedPermissionMode = resolvePermissionMode(executionMode);
      const updatedSession = {
        ...session,
        executionMode: profile.id,
        permissionMode: derivedPermissionMode,
        updatedAt: Date.now(),
      };
      set((state) => ({
        sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updatedSession : candidate)),
      }));
      await safeInvoke('db_save_session', { session: sessionToDb(updatedSession) });

      // Mirror behavior of updateSessionPermissionMode: if the new mode
      // auto-approves safe tools, resolve any pending permission requests.
      if (profile.permissionMode === 'bypass' || profile.permissionMode === 'auto-edits') {
        const pendingPermissions = get().currentSessionId === sessionId
          ? [...useUIStore.getState().permissionQueue]
          : [];
        if (pendingPermissions.length > 0) {
          useUIStore.getState().clearAllPermissions();
          for (const request of pendingPermissions) {
            request._resolve?.(true);
          }
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

    ...createChatActionMethods({
      set,
      get,
      ensureSessionWorkDir,
      runMicrocompactAfterStreaming,
      runSMCompactAfterStreaming,
    }),

    loadSessions: (sessions: Session[]) => {
      set({ sessions });
    },

    selectSession: (sessionId: string) => {
      if (!get().sessions.some((session) => session.id === sessionId)) {
        return;
      }
      const previousSessionId = get().currentSessionId;
      if (get().streamingTimeoutId) {
        clearTimeout(get().streamingTimeoutId!);
      }
      // AUDIT-FIX [audit-1#4] — When switching sessions, stop the subprocess
      // that OWNS the running stream (streamingSessionId), not just the
      // session we're leaving. The previous check only fired when both
      // previousSessionId was set AND isStreaming was true, but streaming
      // state can already have been cleared by other code paths while the
      // backend subprocess is still alive — particularly during a session
      // change initiated from a different code path. Use the helper that
      // falls back to streamingSessionId before currentSessionId.
      if (previousSessionId && previousSessionId !== sessionId) {
        const owningSessionId = resolveStreamingOwnerSessionId(
          get().streamingSessionId,
          get().isStreaming ? previousSessionId : null,
        );
        if (owningSessionId) {
          safeInvokeOrNull('stop_subprocess', { sessionId: owningSessionId });
        }
      }
      useUIStore.getState().clearAllPermissions();
      if (previousSessionId && previousSessionId !== sessionId) {
        useUIStore.getState().clearQuestionnaire(previousSessionId);
      }
      if (
        previousSessionId &&
        previousSessionId !== sessionId &&
        (get().pendingToolCalls > 0 || get().pendingToolResults.length > 0 || useUIStore.getState().permissionQueue.length > 0)
      ) {
        failUnresolvedSessionTools(
          previousSessionId,
          set,
          get,
          (_toolCallId, label) => `Error: ${label} cancelled due to session change`,
        );
        void scrubDanglingToolCalls(previousSessionId, set, get);
      }
      safeSetItem(CURRENT_SESSION_ID_STORAGE_KEY, sessionId);
      set({
        currentSessionId: sessionId,
        error: null,
        isStreaming: false,
        streamingContent: '',
        streamingReasoning: '',
        streamingTimeoutId: null,
        pendingToolCalls: 0,
        pendingToolResults: [],
        streamingSessionId: null,
      });
      // AUDIT-FIX [audit-1#2] — Drop runtime for any session that isn't the
      // newly-selected one, so stale tool steps don't outlive a session switch.
      clearNonCurrentSessionToolRuntime(set, get);
      syncSessionToolRuntimeToCurrentSession(set, get);
    },

    deleteSession: async (sessionId: string) => {
      const uiStore = useUIStore.getState();
      const sessionWorkDir = get().sessions.find((session) => session.id === sessionId)?.workDir;
      const previousCurrentSessionId = get().currentSessionId;
      await safeInvoke('db_delete_session', { sessionId });
      await safeInvokeOrNull('delete_app_chat_dir', { sessionId });
      if (sessionWorkDir) {
        await safeInvokeOrNull('delete_session_work_dir', { path: sessionWorkDir });
      }
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
          await safeInvoke('db_delete_session', { sessionId });
          deletedSessionIds.push(sessionId);
          await safeInvokeOrNull('delete_app_chat_dir', { sessionId });
          const sessionWorkDir = get().sessions.find((session) => session.id === sessionId)?.workDir;
          if (sessionWorkDir) {
            await safeInvokeOrNull('delete_session_work_dir', { path: sessionWorkDir });
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
      const updatedSession = { ...session, cwd, workDir: cwd, updatedAt: Date.now() };
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

    setSessionWorkDir: async (sessionId: string) => {
      const selectedPath = await invoke<string | null>('open_folder_dialog');
      if (!selectedPath) {
        return null;
      }
      const initResult = await invoke<string>('init_pipi_shrimp', { workDir: selectedPath });
      const isNewProject = initResult.endsWith('|new');
      if (isNewProject) {
        try {
          const lines: string[] = ['## 📌 Project Overview\n'];
          for (const name of ['README.md', 'readme.md', 'README.txt']) {
            try {
              const res = await invoke<{ content: string }>('read_file', { path: `${selectedPath}/${name}`, workDir: selectedPath });
              if (res?.content) {
                lines.push(`### README\n\`\`\`\n${res.content.split('\n').slice(0, 20).join('\n')}\n\`\`\`\n`);
                break;
              }
            } catch {
              // ignore missing file
            }
          }
          const techStack: string[] = [];
          for (const { file, label } of [
            { file: 'package.json', label: 'Node.js / JS/TS' },
            { file: 'Cargo.toml', label: 'Rust' },
            { file: 'pyproject.toml', label: 'Python' },
            { file: 'go.mod', label: 'Go' },
            { file: 'pom.xml', label: 'Java/Maven' },
            { file: 'build.gradle', label: 'Java/Gradle' },
          ]) {
            try {
              await invoke('read_file', { path: `${selectedPath}/${file}`, workDir: selectedPath });
              techStack.push(label);
            } catch {
              // ignore missing manifest
            }
          }
          if (techStack.length > 0) {
            lines.push(`## 🛠 Tech Stack\n${techStack.map((entry) => `- ${entry}`).join('\n')}\n`);
          }
          try {
            const entries = await invoke<{ name: string; is_dir: boolean }[]>('list_files', { path: selectedPath });
            lines.push(`## 📖 Top-level Structure\n${[
              ...entries.filter((entry) => entry.is_dir).map((entry) => `📁 ${entry.name}`),
              ...entries.filter((entry) => !entry.is_dir).map((entry) => `📄 ${entry.name}`),
            ].join('\n')}\n`);
          } catch {
            // ignore list failure
          }
          const coreMdPath = `${selectedPath}/.pipi-shrimp/core.md`;
          const coreRes = await invoke<{ content: string }>('read_file', { path: coreMdPath, workDir: selectedPath });
          await invoke('write_file', {
            path: coreMdPath,
            content: (coreRes?.content ?? '').replace(
              '## 📌 Project Overview\n[Auto-detected on bind — see below]\n\n## 🛠 Tech Stack\n[Auto-detected on bind — see below]',
              lines.join('\n'),
            ),
            workDir: selectedPath,
          });
        } catch (error) {
          console.debug('[setSessionWorkDir] auto-scan failed (non-fatal):', error);
        }
      }
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return null;
      }
      const updated = { ...session, workDir: selectedPath, updatedAt: Date.now() };
      await invoke('db_save_session', { session: sessionToDb(updated) });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
      return selectedPath;
    },

    ensureSessionWorkDir: async (sessionId: string) => ensureSessionWorkDir(sessionId, set, get),

    clearSessionWorkDir: async (sessionId: string) => {
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        return;
      }
      const updated = { ...session, workDir: undefined, updatedAt: Date.now() };
      await invoke('db_save_session', { session: sessionToDb(updated) });
      set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
    },

    writeToWorkDir: async (sessionId: string, filename: string, content: string) => {
      let session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session?.workDir) {
        useUIStore.getState().addNotification('info', '请选择一个文件夹来保存生成的文件。', sessionId);
        const selectedPath = await get().setSessionWorkDir(sessionId);
        if (!selectedPath) {
          try {
            const defaultDir = await invoke<string>('get_app_default_dir', { sessionId });
            const currentSession = get().sessions.find((candidate) => candidate.id === sessionId);
            if (currentSession) {
              const updated = { ...currentSession, workDir: defaultDir, updatedAt: Date.now() };
              await invoke('db_save_session', { session: sessionToDb(updated) });
              set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
            }
          } catch {
            return null;
          }
        }
        session = get().sessions.find((candidate) => candidate.id === sessionId);
      }
      if (!session?.workDir) {
        return null;
      }
      try {
        let outputDir = session.outputDir;
        if (!outputDir) {
          outputDir = await invoke<string>('get_next_output_dir', { workDir: session.workDir });
          await invoke('create_directory', { path: outputDir });
          const updated = { ...session, outputDir, updatedAt: Date.now() };
          set((state) => ({ sessions: state.sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate)) }));
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
      const session = get().sessions.find((candidate) => candidate.id === sessionId);
      if (!session?.workDir) {
        return [];
      }
      try {
        return await invoke<OutputFolder[]>('list_pipi_shrimp_index', { workDir: session.workDir });
      } catch (error) {
        console.error('Failed to get work dir index:', error);
        return [];
      }
    },

    getDailyTokenStats: async (yearMonth: string, apiConfigId?: string) => {
      try {
        return await invoke('db_get_daily_token_stats', { yearMonth, apiConfigId: apiConfigId ?? null });
      } catch (error) {
        console.error('Failed to get daily token stats:', error);
        return [];
      }
    },

    getMonthlyTokenStats: async (apiConfigId?: string) => {
      try {
        return await invoke('db_get_monthly_token_stats', { apiConfigId: apiConfigId ?? null });
      } catch (error) {
        console.error('Failed to get monthly token stats:', error);
        return [];
      }
    },

    getModelTokenStats: async (apiConfigId?: string) => {
      try {
        return await invoke('db_get_model_token_stats', { apiConfigId: apiConfigId ?? null });
      } catch (error) {
        console.error('Failed to get model token stats:', error);
        return [];
      }
    },

    getTotalTokenStats: async (apiConfigId?: string) => {
      try {
        const [input, output, total] = await invoke<[number, number, number]>('db_get_total_token_stats', { apiConfigId: apiConfigId ?? null });
        return { input, output, total };
      } catch (error) {
        console.error('Failed to get total token stats:', error);
        return { input: 0, output: 0, total: 0 };
      }
    },

    resetTokenEstimate: async () => {
      await invoke('reset_token_estimate');
    },
  })),
);

export type { Message, Project, Session } from '../types/chat';
