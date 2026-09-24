import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

import { triggerLegacyCompact } from '../services/compact/compact';
import { hydrateSessionModes } from '../services/executionMode';
import { getCompactConfig, getContextTokenStats } from '../services/compact/config';
import { runMicrocompactCheck } from '../services/compact/microCompact';
import { trySessionMemoryCompact } from '../services/compact/sessionMemoryCompact';
import type { ChatState, Message, Session } from '../types/chat';
import { createMessage } from '../types/chat';
import {
  dbToProject,
  dbToSession,
  type DbMessage,
  type DbProject,
  type DbSession,
} from '../utils/chatHelpers';
import { createChatActionMethods } from './chat/chatActions';
import {
  createChatSessionLifecycleActions,
  createChatSessionManagementActions,
} from './chat/chatSessionActions';
import {
  CURRENT_SESSION_ID_STORAGE_KEY,
  ensureSessionWorkDir,
  LEGACY_CURRENT_SESSION_ID_STORAGE_KEY,
} from './chat/sessionLifecycle';
import { filterSessionsByProject, selectCurrentMessages, selectCurrentSession } from './chat/chatSelectors';
import { safeSetItem, safeGetItem, safeMigrateKey } from '@/utils/safeStorage';
import {
  markSessionToolRunning,
  resetAllSessionToolRuntime,
  resolveSessionTool,
} from './chat/toolRuntimeState';
import { terminalizeInterruptedToolTurnsForSessions } from './chat/scrubDanglingToolCalls';
import {
  getSessionPipiOutputDir as resolveSessionPipiOutputDirHelper,
} from '../utils/sessionFolders';
import { useUIStore } from './uiStore';

type RuntimeListenerCleanup = () => void;
type ChatSetState = (
  updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;

let runtimeListenerCleanups: RuntimeListenerCleanup[] = [];

function mapToolCompleteStatus(
  status: string | undefined,
  isError: boolean,
): 'done' | 'failed' | 'cancelled' | 'timed_out' | 'rejected' {
  switch (status) {
    case 'success':
      return 'done';
    case 'failed':
      return 'failed';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'timed_out':
    case 'timeout':
      return 'timed_out';
    default:
      return isError ? 'failed' : 'done';
  }
}

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
    // Two-folder model: session memory is an **app-owned** artefact
    // (stored as `.pipi-shrimp/session-memory.md` under the folder the
    // Rust `get_memory_path(work_dir)` helper picks). Pre-v7 the JS
    // caller passed the user's repo as `work_dir`, which is why the
    // legacy mirror used `session.workDir` here. In the two-folder
    // model we MUST pass the **PiPi Output Folder** instead — using the
    // Project Folder would silently drop a `.pipi-shrimp/` tree into
    // the user's repo on every compact, which is exactly the pollution
    // the two-folder split is supposed to prevent.
    //
    // Resolution order mirrors `getSessionPipiOutputDir`: an explicit
    // binding wins; otherwise fall back to the per-session app-managed
    // default. We do NOT call `ensureSessionWorkDir` here because that
    // helper may auto-provision a new folder; compact should be best-
    // effort and silently skip when the session has no output binding
    // (the next bind will re-trigger compact anyway).
    const pipiOutputDir = session.pipiOutputDir
      ?? resolveSessionPipiOutputDirHelper(session);
    const memoryWorkDir = pipiOutputDir ?? undefined;
    if (stats.current >= config.sm_auto_threshold_tokens) {
      const result = await trySessionMemoryCompact(sessionId, session.messages, memoryWorkDir);
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
      // Two-folder model: same reasoning as the SM branch above —
      // legacy compact also writes session memory to `workDir`, so it
      // must point at the PiPi Output Folder rather than the user's
      // repo. Reuse the resolved `memoryWorkDir` so the two branches
      // stay in sync.
      const result = await triggerLegacyCompact(sessionId, session.messages, memoryWorkDir);
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
        // GPT P0 knife 1 — crash/reload: terminalize orphan tool_calls from
        // persisted history only (no toolRuntimeState). Scrub + durable notice
        // so the next runChatTurn does not see an open tool request.
        await terminalizeInterruptedToolTurnsForSessions(set, get, { kind: 'interrupted' });
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
        } else if (sessions.length > 0) {
          const latestSession = sessions.reduce((latest, session) => (
            session.updatedAt > latest.updatedAt ? session : latest
          ));
          set({ currentSessionId: latestSession.id });
          safeSetItem(CURRENT_SESSION_ID_STORAGE_KEY, latestSession.id);
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

        const unlistenToolComplete = await listen<{
          session_id: string;
          tool_call_id: string;
          name: string;
          is_error: boolean;
          status?: string;
        }>('tool-complete', (event) => {
          if (!get().sessions.some((session) => session.id === event.payload.session_id)) {
            return;
          }
          const stepStatus = mapToolCompleteStatus(event.payload.status, event.payload.is_error);
          resolveSessionTool(
            event.payload.session_id,
            event.payload.tool_call_id,
            event.payload.name,
            stepStatus,
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
            set({ sessions: (JSON.parse(stored) as Session[]).map(hydrateSessionModes) });
            // GPT P0 — localStorage fallback must write back after terminalize
            // so the next reload does not re-see orphan tool_calls.
            await terminalizeInterruptedToolTurnsForSessions(set, get, {
              kind: 'interrupted',
              persist: 'localStorage',
            });
          }
        } catch (localStorageError) {
          console.error('Failed to load from localStorage:', localStorageError);
        }
        set({ isInitialized: false, error: `Failed to load sessions: ${error instanceof Error ? error.message : String(error)}` });
      }
    },

    ...createChatSessionLifecycleActions(set, get),
    ...createChatActionMethods({
      set,
      get,
      ensureSessionWorkDir,
      runMicrocompactAfterStreaming,
      runSMCompactAfterStreaming,
    }),

    ...createChatSessionManagementActions(set, get),
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
