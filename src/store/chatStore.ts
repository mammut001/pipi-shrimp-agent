/**
 * Chat store - Zustand state management for chat/sessions
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { ChatState, Session, Message, Project, OutputFolder } from '../types/chat';
import { createSession, createMessage, createProject } from '../types/chat';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';
import { useCdpStore } from './cdpStore';
import { usePromptStore } from './promptStore';
import { runPreToolUseHooks } from '../services/tools/preToolUseHooks';
import { runPostToolUseHooks } from '../services/tools/postToolUseHooks';
import type { PostHookContext } from '../services/tools/postToolUseHooks';
import type { ImportedFile } from '../types/settings';
import { runMicrocompactCheck } from '../services/compact/microCompact';
import { trySessionMemoryCompact } from '../services/compact/sessionMemoryCompact';
import { triggerLegacyCompact } from '../services/compact/compact';
import { getCompactConfig, getContextTokenStats } from '../services/compact/config';


/**
 * Streaming timeout - 300 seconds
 * If the API doesn't respond within this time, we'll force stop the streaming
 */
const STREAMING_TIMEOUT_MS = 300000;

/**
 * Run microcompact check after streaming completes.
 * 
 * Layer 1: Microcompact — 每轮自动清理旧工具结果
 * 源码参考: microcompactMessages() 在 microCompact.ts
 * 
 * 调用时机: streaming 完成后立即调用
 * - 调用 Rust microcompact 命令（清除工具结果）
 * - 更新本地消息状态
 */
/**
 * Run Session Memory Compact (Layer 2) after streaming completes.
 * 
 * 触发条件:
 * - 当前 token 数 > sm_auto_threshold_tokens (默认 80K)
 * - Session Memory 文件存在且非空
 * 
 * 流程:
 * 1. 检查 token 阈值
 * 2. 调用 trySessionMemoryCompact
 * 3. 如果成功，替换 Zustand store 中的 messages
 */
/**
 * Run Layer 2 (SM Compact) and Layer 3 (Legacy Compact) after streaming completes.
 * 
 * Layer 2: Session Memory Compact
 * - 触发: token > sm_auto_threshold_tokens (80K) 且 SM 文件存在非空
 * 
 * Layer 3: Legacy Compact
 * - 触发: token > legacy_auto_threshold_tokens (120K) 且 SM compact 不可用
 * - 调用 LLM 生成完整摘要
 */
async function runSMCompactAfterStreaming(
  sessionId: string,
  set: (updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)) => void,
  _get: () => ChatState,
): Promise<void> {
  try {
    const config = getCompactConfig();
    
    // 获取当前 session
    const state = _get();
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;
    
    const messages = session.messages;
    const workDir = session.workDir ?? undefined;
    
    // 获取 token 统计
    const stats = await getContextTokenStats(sessionId);
    
    // ===== Layer 2: Session Memory Compact =====
    if (stats.current >= config.sm_auto_threshold_tokens) {
      const smResult = await trySessionMemoryCompact(sessionId, messages, workDir);
      
      if (smResult.did_compact && smResult.boundary_message && smResult.summary_message) {
        console.log('[SM Compact] Success:', smResult.deleted_count, 'messages removed');
        
        set((state) => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              messages: [
                {
                  id: smResult.boundary_message!.id,
                  role: 'system' as const,
                  content: smResult.boundary_message!.content,
                  timestamp: smResult.boundary_message!.created_at * 1000,
                  metadata: {
                    subtype: 'compact_boundary',
                    compact_type: smResult.boundary_message!.compact_type,
                  },
                } as any,
                smResult.summary_message!,
                ...s.messages.slice(smResult.deleted_count!),
              ],
            };
          }),
        }));
        return; // SM Compact 成功，不需要继续
      }
    }
    
    // ===== Layer 3: Legacy Compact =====
    // SM 不可用或未触发，且达到 legacy 阈值
    if (stats.current >= config.legacy_auto_threshold_tokens) {
      console.log('[Legacy Compact] Triggering...');
      
      const legacyResult = await triggerLegacyCompact(sessionId, messages);
      
      if (legacyResult.success && legacyResult.boundary_message && legacyResult.summary_message) {
        console.log('[Legacy Compact] Success:', legacyResult.deleted_count, 'messages removed');
        
        set((state) => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              messages: [
                {
                  id: legacyResult.boundary_message!.id,
                  role: 'system' as const,
                  content: legacyResult.boundary_message!.content,
                  timestamp: legacyResult.boundary_message!.created_at * 1000,
                  metadata: {
                    subtype: 'compact_boundary',
                    compact_type: legacyResult.boundary_message!.compact_type,
                  },
                } as any,
                legacyResult.summary_message!,
                ...(legacyResult.messages_to_keep ?? []),
              ],
            };
          }),
        }));
      } else if (legacyResult.error) {
        console.warn('[Legacy Compact] Failed:', legacyResult.error);
      }
    }
  } catch (e) {
    console.warn('[Compact] Check failed:', e);
  }
}

async function runMicrocompactAfterStreaming(
  sessionId: string,
  set: (updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)) => void,
  _get: () => ChatState,
): Promise<void> {
  try {
    const result = await runMicrocompactCheck(sessionId);
    if (result.did_compact && result.updates && result.updates.length > 0) {
      console.log('[Microcompact] Cleared', result.updates.length, 'tool results');
      
      // 应用更新到 Zustand store
      for (const update of result.updates) {
        // 更新消息 content
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              messages: s.messages.map((m) => {
                if (m.id !== update.message_id) return m;
                return {
                  ...m,
                  content: update.new_content,
                  metadata: {
                    ...m.metadata,
                    compact_metadata: {
                      tool_result_cleared: true,
                      tool_result_cleared_at: update.cleared_at,
                      estimated_tokens: 5,
                    },
                  },
                };
              }),
            };
          }),
        }));
      }
    }
  } catch (e) {
    // Microcompact 失败不影响主流程，只记录日志
    console.warn('[Microcompact] Check failed:', e);
  }
}

/**
 * Database types matching Rust backend
 */
interface DbSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  cwd: string | null;
  project_id: string | null;
  model: string | null;
  work_dir?: string | null;
  working_files?: string | null;  // JSON serialized ImportedFile[]
  permission_mode?: string | null;  // NEW: session permission mode
}

interface DbMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  reasoning: string | null;
  artifacts: string | null;
  tool_calls: string | null;  // JSON-serialized Vec<ToolCall>
  created_at: number;
}

interface DbProject {
  id: string;
  name: string;
  description?: string;
  color?: string;
  work_dir?: string;      // NEW
  created_at: number;
  updated_at: number;
}

/**
 * Safely parse JSON with fallback
 */
function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch (e) {
    console.warn('Failed to parse JSON:', e);
    return fallback;
  }
}

/**
 * Convert database session to frontend session
 */
const dbToSession = (dbSession: DbSession, dbMessages: DbMessage[]): Session => ({
  id: dbSession.id,
  title: dbSession.title,
  createdAt: dbSession.created_at,
  updatedAt: dbSession.updated_at,
  cwd: dbSession.cwd || undefined,
  projectId: dbSession.project_id || undefined,
  model: dbSession.model || undefined,
  workDir: dbSession.work_dir || undefined,
  workingFiles: safeJsonParse(dbSession.working_files, undefined),
  permissionMode: (dbSession.permission_mode as Session['permissionMode']) || undefined,
  messages: dbMessages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    reasoning: m.reasoning || undefined,
    timestamp: m.created_at,
    artifacts: safeJsonParse(m.artifacts, undefined),
    tool_calls: safeJsonParse(m.tool_calls, undefined),
  })),
});

/**
 * Convert frontend session to database session
 */
const sessionToDb = (session: Session): DbSession => ({
  id: session.id,
  title: session.title,
  created_at: session.createdAt,
  updated_at: session.updatedAt,
  cwd: session.cwd || null,
  project_id: session.projectId || null,
  model: session.model || null,
  work_dir: session.workDir || null,
  working_files: session.workingFiles ? JSON.stringify(session.workingFiles) : null,
  permission_mode: session.permissionMode || null,
});

/**
 * Convert frontend message to database message
 */
const messageToDb = (message: Message, sessionId: string): DbMessage => ({
  id: message.id,
  session_id: sessionId,
  role: message.role,
  content: message.content,
  reasoning: message.reasoning || null,
  artifacts: message.artifacts ? JSON.stringify(message.artifacts) : null,
  tool_calls: message.tool_calls ? JSON.stringify(message.tool_calls) : null,
  created_at: message.timestamp,
});

/**
 * Convert database project to frontend project
 */
const dbToProject = (dbProject: DbProject): Project => ({
  id: dbProject.id,
  name: dbProject.name,
  createdAt: dbProject.created_at,
  updatedAt: dbProject.updated_at,
  workDir: dbProject.work_dir || undefined,   // NEW
});

/**
 * Convert frontend project to database project
 */
const projectToDb = (project: Project): DbProject => ({
  id: project.id,
  name: project.name,
  created_at: project.createdAt,
  updated_at: project.updatedAt,
  work_dir: project.workDir,                  // NEW
});

/**
 * Parse <think>...</think> tags from content
 * Returns { content: string (without think tags), reasoning: string | undefined }
 */
const parseThinkContent = (rawContent: string): { content: string; reasoning?: string } => {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  const thinkingParts: string[] = [];
  let cleanContent = rawContent;

  let match;
  while ((match = thinkRegex.exec(rawContent)) !== null) {
    thinkingParts.push(match[1].trim());
  }

  // Remove all complete <think>...</think> blocks from content
  cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Handle incomplete thinking (still streaming) - remove partial <think> at the end
  // e.g. content ends with "<think>some reasoning still coming..."
  const partialThink = cleanContent.match(/<think>[\s\S]*$/);
  if (partialThink) {
    cleanContent = cleanContent.replace(/<think>[\s\S]*$/, '').trim();
  }

  // Strip orphaned </think> closing tags that have no matching <think> opener.
  // This happens when a previous streaming chunk already consumed the <think> block
  // but a stray </think> token arrives in a subsequent chunk.
  cleanContent = cleanContent.replace(/<\/think>/g, '').trim();

  // For MiniMax/other providers, a chunk can contain one or more complete <think>
  // blocks. Preserve them in order so the UI can collapse them into one bubble.
  return {
    content: cleanContent,
    reasoning: mergeReasoningParts(...thinkingParts),
  };
};

/**
 * Merge multiple reasoning fragments into a single display string.
 *
 * This keeps the fragments in arrival order, removes empty entries, and de-dupes
 * identical blocks so repeated finalization doesn't duplicate the bubble text.
 */
const mergeReasoningParts = (...parts: Array<string | undefined | null>): string | undefined => {
  const merged: string[] = [];

  for (const part of parts) {
    const normalized = part?.trim();
    if (!normalized) continue;
    if (!merged.includes(normalized)) {
      merged.push(normalized);
    }
  }

  return merged.length > 0 ? merged.join('\n\n') : undefined;
};

/**
 * Remove unresolved tool_calls from the last assistant message of a session.
 *
 * Why this exists:
 * In Ask mode, the model can emit assistant.tool_calls and then wait for user approval.
 * If the user switches chat or force-switches permission mode before those tool calls
 * are completed, the conversation history becomes structurally invalid for OpenAI-
 * compatible endpoints such as MiniMax: it contains an assistant message with
 * `tool_calls` but no corresponding tool result messages. The next request then fails
 * with HTTP 400.
 *
 * To prevent that permanent corruption, we scrub dangling tool_calls from the last
 * assistant message when the pending ASK flow is abandoned.
 */
async function scrubDanglingToolCalls(
  sessionId: string,
  set: (updater: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)) => void,
  get: () => ChatState
): Promise<void> {
  const session = get().sessions.find((s) => s.id === sessionId);
  if (!session || session.messages.length === 0) return;

  const lastMessage = session.messages[session.messages.length - 1];
  if (lastMessage.role !== 'assistant' || !lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
    return;
  }

  const fallbackContent = lastMessage.content.trim() || '[Tool execution cancelled before completion.]';
  const cleanedMessage: Message = {
    ...lastMessage,
    content: fallbackContent,
    tool_calls: undefined,
  };

  set((state) => ({
    sessions: state.sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            updatedAt: Date.now(),
            messages: s.messages.map((m, i) =>
              i === s.messages.length - 1 ? cleanedMessage : m
            ),
          }
        : s
    ),
  }));

  try {
    await invoke('db_save_message', { message: messageToDb(cleanedMessage, sessionId) });
  } catch (error) {
    console.error('Failed to scrub dangling tool_calls from database:', error);
  }
}

const parseToolResultMessage = (message: Message): { toolCallId: string; result: string } | null => {
  if (message.role !== 'user' || !message.content.startsWith('__TOOL_RESULT__:')) {
    return null;
  }

  const match = message.content.match(/^__TOOL_RESULT__:([^:]+):([\s\S]*)$/);
  if (!match) return null;

  return {
    toolCallId: match[1],
    result: match[2],
  };
};

/**
 * Build API-safe messages for Rust.
 *
 * OpenAI-compatible providers are strict: if an assistant message contains
 * `tool_calls`, it must be followed immediately by matching tool result messages.
 * If the history is malformed, drop the entire broken block rather than sending
 * orphaned `tool_result` messages that trigger 400 errors.
 */
function buildApiMessages(messages: Message[]) {
  const apiMessages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    tool_calls?: Array<{ tool_call_id: string; name: string; arguments: string }>;
    tool_call_id?: string;
  }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const resultMessages: Array<{ message: Message; parsed: { toolCallId: string; result: string } }> = [];
      let cursor = i + 1;

      while (cursor < messages.length) {
        const parsed = parseToolResultMessage(messages[cursor]);
        if (!parsed) break;
        resultMessages.push({ message: messages[cursor], parsed });
        cursor += 1;
      }

      const resultById = new Map(resultMessages.map(({ parsed }) => [parsed.toolCallId, parsed.result]));
      const expectedIds = msg.tool_calls.map((tc) => tc.id);
      const allExpectedPresent = expectedIds.every((id) => resultById.has(id));
      const noExtraResults = resultMessages.length === expectedIds.length
        && resultMessages.every(({ parsed }) => expectedIds.includes(parsed.toolCallId));

      if (!allExpectedPresent || !noExtraResults) {
        console.warn('[buildApiMessages] Dropping malformed tool-call block before API request:', {
          assistantToolCallIds: expectedIds,
          toolResultIds: resultMessages.map(({ parsed }) => parsed.toolCallId),
        });
        i = cursor - 1;
        continue;
      }

      apiMessages.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls.map((tc) => ({
          tool_call_id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
      });

      for (const toolCall of msg.tool_calls) {
        apiMessages.push({
          role: 'user',
          content: `__TOOL_RESULT__:${toolCall.id}:${resultById.get(toolCall.id) ?? ''}`,
        });
      }

      i = cursor - 1;
      continue;
    }

    const parsedToolResult = parseToolResultMessage(msg);
    if (parsedToolResult) {
      console.warn('[buildApiMessages] Skipping orphan tool result before API request:', parsedToolResult.toolCallId);
      continue;
    }

    apiMessages.push({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
      ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
    });
  }

  return apiMessages;
}

/**
 * Storage key for persisting current session ID (so we can restore it on restart)
 */
const CURRENT_SESSION_ID_STORAGE_KEY = 'ai-agent-current-session-id';

/**
 * Chat store using Zustand
 */
export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => ({
    // ========== Initial State ==========
    sessions: [],
    projects: [],
    currentSessionId: null,
    isStreaming: false,
    isInitialized: false,
    streamingContent: '',
    streamingReasoning: '',
    error: null,
    streamingTimeoutId: null as ReturnType<typeof setTimeout> | null,
    lastUiUpdateTime: 0,
    pendingToolCalls: 0,  // Counter for pending parallel tool executions
    pendingToolResults: [] as { toolCallId: string; result: string }[],  // Accumulated tool results
    streamingSessionId: null as string | null,  // Session that owns the current streaming request — guards against cross-session event contamination

    // ========== Computed Properties ==========
    currentSession: () => {
      const { sessions, currentSessionId } = get();
      if (!currentSessionId) return null;
      return sessions.find((s) => s.id === currentSessionId) || null;
    },

    currentMessages: () => {
      const session = get().currentSession();
      return session?.messages || [];
    },

    getSessionsByProject: (projectId: string | null) => {
      const { sessions } = get();
      if (projectId === null) {
        // Return sessions without a project
        return sessions.filter((s) => !s.projectId);
      }
      return sessions.filter((s) => s.projectId === projectId);
    },

    // ========== Action Methods ==========

    /**
     * Initialize store - load sessions from SQLite database
     */
    init: async () => {
      if (get().isInitialized) return;
      
      // 立即设置，防止并发调用（App.tsx 和 Chat.tsx 都会调用 init）
      set({ isInitialized: true });

      try {
        // Load Projects from database (preserve existing if fails)
        try {
          console.log('🔄 Loading projects from database...');
          const dbProjects = await invoke<DbProject[]>('db_get_all_projects');
          console.log('✅ Projects loaded:', dbProjects);
          const projects: Project[] = dbProjects.map(dbToProject);
          set({ projects });
        } catch (error) {
          // Don't clear projects on load failure - preserve whatever is in state
          console.warn('Failed to load projects from database, keeping existing state:', error);
        }

        // Load sessions from database
        console.log('🔄 Loading sessions from database...');
        const dbSessions = await invoke<DbSession[]>('db_get_all_sessions');
        console.log('✅ Sessions loaded:', dbSessions);

        // Load messages for each session
        console.log('🔄 Loading messages for', dbSessions.length, 'sessions...');
        const sessions: Session[] = await Promise.all(
          dbSessions.map(async (dbSession) => {
            try {
              let dbMessages = await invoke<DbMessage[]>('db_get_messages', {
                sessionId: dbSession.id,  // Tauri v1: camelCase → Rust session_id
              });
              
              // CLEANUP: If the very last message is an empty assistant placeholder (stuck from crash),
              // remove it so the session doesn't look broken/stuck in "thinking" on reload.
              if (dbMessages.length > 0) {
                const last = dbMessages[dbMessages.length - 1];
                if (last.role === 'assistant' && (!last.content || last.content.trim() === '') && !last.reasoning && !last.tool_calls) {
                  console.warn(`🧹 Found dangling assistant placeholder in session ${dbSession.id}, removing...`);
                  dbMessages = dbMessages.slice(0, -1);
                  // We don't bother deleting it from DB here, as it will be overwritten/cleaned up on next save
                }
              }
              
              return dbToSession(dbSession, dbMessages);
            } catch (err) {
              // Don't throw - return session with empty messages so other sessions still load
              console.warn(`Failed to load messages for session ${dbSession.id}, loading with empty messages:`, err);
              return dbToSession(dbSession, []);
            }
          })
        );
        console.log('✅ All messages loaded');

        set({ sessions });

        // Restore the previously selected session (from localStorage), or fall back to most recent
        const savedSessionId = localStorage.getItem(CURRENT_SESSION_ID_STORAGE_KEY);
        let selectedSessionId: string | null = null;

        if (savedSessionId && sessions.some(s => s.id === savedSessionId)) {
          // Session exists - restore it
          selectedSessionId = savedSessionId;
          console.log('✅ Restored previously selected session:', savedSessionId);
        } else if (sessions.length > 0) {
          // No saved session or session was deleted - select most recent
          const mostRecent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          selectedSessionId = mostRecent.id;
          console.log('✅ Auto-selected most recent session:', mostRecent.id, mostRecent.title);
        }

        if (selectedSessionId) {
          set({ currentSessionId: selectedSessionId });
        }

        console.log('✅ Store initialization completed successfully');
        set({ isInitialized: true, error: null });

        // === Subagent event listeners ===
        const { listen } = await import('@tauri-apps/api/event');

        // Listen for subagent completion events
        await listen<{ agentId: string; sessionId: string; content: string; success: boolean; error?: string }>(
          'subagent-complete',
          (event) => {
            console.log(`[Subagent] Complete: ${event.payload.agentId}`, event.payload.success ? '✅' : '❌');
            // Update task step if visible
            const uiStore = useUIStore.getState();
            uiStore.addNotification(
              event.payload.success ? 'success' : 'error',
              `Agent ${event.payload.agentId.slice(0, 12)}... completed`,
            );
          },
        );

        // Listen for subagent error events
        await listen<{ agentId: string; sessionId: string; error: string }>(
          'subagent-error',
          (event) => {
            console.error(`[Subagent] Error: ${event.payload.agentId}`, event.payload.error);
            const uiStore = useUIStore.getState();
            uiStore.addNotification('error', `Agent ${event.payload.agentId.slice(0, 12)}... failed: ${event.payload.error}`);
          },
        );
      } catch (error) {
        console.error('❌ Failed to load sessions:', error);
        console.error('Error details:', {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          error: error,
        });

        // Fallback to localStorage if database fails
        try {
          const stored = localStorage.getItem('ai-agent-sessions');
          if (stored) {
            const sessions: Session[] = JSON.parse(stored);
            console.log('📦 Loaded', sessions.length, 'sessions from localStorage');
            set({ sessions });
          }
        } catch (e) {
          console.error('Failed to load from localStorage:', e);
        }
        // 重置 isInitialized 以允许重试
        set({ isInitialized: false, error: 'Failed to load sessions: ' + (error instanceof Error ? error.message : String(error)) });
      }
    },

    /**
     * Create a new session (optionally in a project and with a specific model)
     */
    startSession: async (projectId?: string, model?: string) => {
      const sessionCount = get().sessions.length;
      const title = `Chat ${sessionCount + 1}`;
      const newSession = createSession(title, projectId, model);

      // Save to database
      try {
        await invoke('db_save_session', { session: sessionToDb(newSession) });
      } catch (error) {
        console.error('Failed to save session to database:', error);
      }

      // Clear stale permission dialogs before switching to the new session
      useUIStore.getState().clearAllPermissions();

      // Persist current session ID so we can restore it on restart
      localStorage.setItem(CURRENT_SESSION_ID_STORAGE_KEY, newSession.id);

      set((state) => ({
        sessions: [...state.sessions, newSession],
        currentSessionId: newSession.id,
        // Reset streaming/error state so stale state from previous session doesn't bleed in
        isStreaming: false,
        error: null,
        streamingContent: '',
        streamingReasoning: '',
        pendingToolCalls: 0,
        pendingToolResults: [],
        streamingSessionId: null,
      }));

      return newSession.id;
    },

    /**
     * Add working files to a session (session-level)
     */
    addSessionWorkingFiles: async (sessionId: string, files: ImportedFile[]) => {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session) return;

      const updatedSession = {
        ...session,
        workingFiles: [...(session.workingFiles ?? []), ...files],
        updatedAt: Date.now(),
      };

      // Update local state
      set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updatedSession : s),
      }));

      // Persist to database
      await invoke('db_save_session', { session: sessionToDb(updatedSession) });
    },

    /**
     * Remove a working file from a session
     */
    removeSessionWorkingFile: async (sessionId: string, fileId: string) => {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session) return;

      const updatedSession = {
        ...session,
        workingFiles: (session.workingFiles ?? []).filter(f => f.id !== fileId),
        updatedAt: Date.now(),
      };

      // Update local state
      set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updatedSession : s),
      }));

      // Persist to database
      await invoke('db_save_session', { session: sessionToDb(updatedSession) });
    },

    /**
     * Clear all working files from a session
     */
    clearSessionWorkingFiles: async (sessionId: string) => {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session) return;

      const updatedSession = {
        ...session,
        workingFiles: [],
        updatedAt: Date.now(),
      };

      // Update local state
      set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updatedSession : s),
      }));

      // Persist to database
      await invoke('db_save_session', { session: sessionToDb(updatedSession) });
    },

    /**
     * Update session's permission mode (execution mode: standard, auto-edits, bypass, plan-only)
     */
    updateSessionPermissionMode: async (sessionId: string, permissionMode: 'standard' | 'auto-edits' | 'bypass' | 'plan-only') => {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session) return;

      const isCurrentSession = get().currentSessionId === sessionId;
      const pendingPermissions = isCurrentSession ? [...useUIStore.getState().permissionQueue] : [];
      const hasPendingAskFlow = isCurrentSession && pendingPermissions.length > 0;

      const updatedSession = {
        ...session,
        permissionMode,
        updatedAt: Date.now(),
      };

      // Update local state
      set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updatedSession : s),
      }));

      // Persist to database
      await invoke('db_save_session', { session: sessionToDb(updatedSession) });

      if (!hasPendingAskFlow) return;

      if (permissionMode === 'bypass' || permissionMode === 'auto-edits') {
        // Drain queued ASK permissions into immediate execution.
        useUIStore.getState().clearAllPermissions();
        for (const req of pendingPermissions) {
          req._resolve?.(true);
        }
        return;
      }

      // Switching away from Ask while tool calls are unresolved
      useUIStore.getState().clearAllPermissions();
      for (const req of pendingPermissions) {
        req._resolve?.(false);
      }
    },

    /**
     * Rename a session (update title)
     */
    renameSession: async (sessionId: string, newTitle: string) => {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session) return;

      const updatedSession = {
        ...session,
        title: newTitle,
        updatedAt: Date.now(),
      };

      // Update local state
      set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updatedSession : s),
      }));

      // Persist to database
      await invoke('update_session_title', { sessionId, title: newTitle });
    },

    /**
     * Generate an AI response using browser task result as context.
     * Does NOT add a visible user message — injects a hidden context message
     * so the AI can answer based on what the browser agent found.
     */
    generateBrowserResultResponse: async (browserResult: string, originalQuery: string) => {
      console.log('[generateBrowserResultResponse] called', { browserResult: browserResult?.substring(0, 80), originalQuery });
      const {
        currentSessionId,
        addMessage,
        setStreaming,
        setError,
      } = get();

      if (!currentSessionId) {
        console.warn('[generateBrowserResultResponse] no currentSessionId, aborting');
        return;
      }

      const apiConfig = useSettingsStore.getState().getActiveConfig();
      if (!apiConfig?.apiKey) {
        setError('API key not configured.');
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        setStreaming(true);
        set({ streamingContent: '', streamingSessionId: currentSessionId });

        timeoutId = setTimeout(() => {
          if (get().isStreaming) {
            setStreaming(false);
            set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
            invoke('stop_subprocess', { sessionId: currentSessionId }).catch(console.error);
          }
        }, 300_000);

        // Use ONLY the original query as context — do NOT send full conversation history.
        // When the conversation has many turns with tool calls, sending all 55+ messages
        // causes the model to continue the prior task pattern ("我将打开 GitHub...") instead
        // of simply reporting the browser result that is injected into the system prompt.
        // A single user message is all the model needs: system prompt has the data.
        const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
          { role: 'user', content: originalQuery || '请根据浏览器获取到的数据回答问题。' },
        ];
        console.log('[generateBrowserResultResponse] messages to API:', messages.length, messages.map(m => `${m.role}:${m.content?.substring(0,40)}`));
        const assistantMessage = createMessage('assistant', '');
        await addMessage(assistantMessage);

        // Inject browser result into system prompt instead of as a user message.
        // Adding it as a user message creates consecutive user messages (original query +
        // context), which MiniMax and other APIs reject → stuck "思考中..." with 0 output tokens.
        let systemPrompt = useUIStore.getState().agentInstructions;
        const currentSession = get().sessions.find(s => s.id === currentSessionId);
        const sessionWorkDir = currentSession?.workDir;
        if (sessionWorkDir) {
          systemPrompt += `\n\n## Working Directory\n\nYour working directory: \`${sessionWorkDir}\``;
        }
        systemPrompt += `\n\n---\n## 浏览器代理任务结果\n用户的问题是："${originalQuery}"\n\n浏览器代理获取到的数据：\n${browserResult}\n\n请根据以上数据，用自然的语言直接回答用户的问题。不要提及"浏览器代理"或内部流程，直接给出结果即可。`;

        console.log('[generateBrowserResultResponse] invoking API with systemPrompt length:', systemPrompt.length);
        const response = await invoke<{
          content: string;
          artifacts: Array<{ type: string; content: string; title?: string; language?: string }>;
          model: string;
          usage: { input_tokens: number; output_tokens: number };
          tool_calls: Array<{ tool_call_id: string; name: string; arguments: string }>;
        }>('send_claude_sdk_chat_streaming', {
          messages,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          baseUrl: apiConfig.baseUrl || '',
          systemPrompt,
          noTools: true,
          browserConnected: useCdpStore.getState().status === 'connected',
          sessionId: currentSessionId,
        });

        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }

        const { streamingContent: finalContent, streamingReasoning } = get();
        const { updateLastMessage } = get();

        const rawContent = finalContent || response.content || '';
        console.log('[generateBrowserResultResponse] API done. streamingContent len:', finalContent?.length, 'response.content len:', response.content?.length, 'rawContent preview:', rawContent.substring(0, 100));
        const { content: cleanContent, reasoning: parsedReasoning } = parseThinkContent(rawContent);

        const tokenUsage = response.usage ? {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          model: response.model || apiConfig.model,
        } : undefined;

        await updateLastMessage(
          cleanContent,
          response.artifacts?.map((a) => ({
            id: crypto.randomUUID(),
            type: a.type as 'html' | 'svg' | 'mermaid' | 'react' | 'code',
            content: a.content,
            title: a.title,
            language: a.language,
          })),
          mergeReasoningParts(streamingReasoning, parsedReasoning),
          tokenUsage
        );

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
      } catch (error) {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        const errorMsg = typeof error === 'string' ? error : (error instanceof Error ? error.message : 'Failed to generate response');
        setError(errorMsg);

        // Save any accumulated content before clearing
        const { streamingContent: errContent, streamingReasoning: errReasoning, updateLastMessage: saveLastMsg } = get();
        if (errContent || errReasoning) {
          const { content: cleanErr, reasoning: parsedErrReasoning } = parseThinkContent(errContent || '');
          saveLastMsg(cleanErr, undefined, mergeReasoningParts(errReasoning, parsedErrReasoning))
            .catch((e: unknown) => console.error('Failed to persist sendMessage error content:', e));
        }

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
        // Remove empty assistant placeholder
        const sid = get().currentSessionId;
        if (sid) {
          set((state) => ({
            sessions: state.sessions.map((s) => {
              if (s.id !== sid || s.messages.length === 0) return s;
              const last = s.messages[s.messages.length - 1];
              if (last.role === 'assistant' && !last.content && !last.reasoning) {
                return { ...s, messages: s.messages.slice(0, -1) };
              }
              return s;
            }),
          }));
        }
      }
    },

    /**
     * Send message - call API (with streaming + multi-round tool loop)
     */
    sendMessage: async (content: string, targetSessionId?: string) => {
      const {
        currentSessionId,
        currentMessages,
        addMessage,
        setStreaming,
        setError,
      } = get();

      const activeSessionId = targetSessionId || currentSessionId;

      if (!activeSessionId) {
        setError('No active session');
        return;
      }

      useUIStore.getState().clearTaskProgress();

      const apiConfig = useSettingsStore.getState().getActiveConfig();
      if (!apiConfig?.apiKey) {
        setError('API key not configured. Please set up your API key in Settings.');
        return;
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        const userMessage = createMessage('user', content);
        if (targetSessionId && targetSessionId !== get().currentSessionId) {
          get().selectSession(targetSessionId);
        }
        await addMessage(userMessage);

        setStreaming(true);
        set({ streamingContent: '', streamingSessionId: activeSessionId });

        timeoutId = setTimeout(() => {
          console.warn(`⏱️ Streaming timeout after ${STREAMING_TIMEOUT_MS / 1000}s, force stopping...`);
          if (get().isStreaming) {
            setStreaming(false);
            set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
            setError(`Response timeout (${STREAMING_TIMEOUT_MS / 1000}s exceeded). Please try again.`);
            invoke('stop_subprocess', { sessionId: activeSessionId }).catch(console.error);
          }
        }, STREAMING_TIMEOUT_MS);

        const messages = buildApiMessages(currentMessages());
        if (messages.length === 0) {
          setError('Message content is empty. Cannot send.');
          setStreaming(false);
          set({ streamingSessionId: null });
          return;
        }

        const assistantMessage = createMessage('assistant', '');
        await addMessage(assistantMessage);

        // === Build system prompt using prompt template (section caching) ===
        const template = usePromptStore.getState().getActiveTemplate();
        const currentSession = get().sessions.find(s => s.id === activeSessionId);
        const sessionWorkingFiles = currentSession?.workingFiles ?? [];
        const sessionWorkDir = currentSession?.workDir;

        let coreMdContent = '';
        if (sessionWorkDir) {
          try {
            const coreMdPath = `${sessionWorkDir}/.pipi-shrimp/core.md`;
            const coreMdRes = await invoke<{ content: string; path: string }>('read_file', {
              path: coreMdPath,
              workDir: sessionWorkDir
            });
            if (coreMdRes && coreMdRes.content) {
              coreMdContent = coreMdRes.content;
            }
          } catch (e) {
            console.debug('No core.md found or failed to read:', e);
          }
        }

        const workingFilesList = sessionWorkingFiles.length > 0
          ? sessionWorkingFiles.map((f) => `- ${f.name}: ${f.path}`).join('\n')
          : '';

        // === Relevant Memory Recall ===
        let memoryContext = '';
        if (sessionWorkDir) {
          try {
            const { getMemoryDir, getTopicMemoriesDir } = await import('../services/memory/memoryPaths');
            const { findRelevantMemories, buildMemoryContext } = await import('../services/memory/relevantRecall');
            const memoryDir = await getMemoryDir(sessionWorkDir);
            const topicDir = getTopicMemoriesDir(memoryDir);
            const relevantMemories = await findRelevantMemories(topicDir, content);
            if (relevantMemories.length > 0) {
              memoryContext = await buildMemoryContext(relevantMemories);
            }
          } catch (e) {
            console.debug('Memory recall failed:', e);
          }
        }

        const { buildPrompt } = await import('../services/prompt/promptBuilder');
        const { systemPrompt } = buildPrompt(
          template?.sections || [],
          {
            agentInstructions: useUIStore.getState().agentInstructions,
            workDir: sessionWorkDir || '',
            coreMdContent,
            workingFilesList,
            memoryContext,
            originalQuery: '',
            browserResult: '',
          },
        );

        // === Multi-round tool loop via Core Query Engine ===
        const { runChatTurn } = await import('../core/QueryEngine');
        const apiMessages = currentMessages();
        const engine = runChatTurn(activeSessionId, apiMessages, systemPrompt);
        
        const uiStore = useUIStore.getState();
        let tokenUsageResult: any = undefined;

        for await (const chunk of engine) {
          if (chunk.type === 'text_delta') {
            get().appendStreamingContent(chunk.content);
          } else if (chunk.type === 'reasoning_delta') {
            set((state) => ({ streamingReasoning: state.streamingReasoning + chunk.content }));
          } else if (chunk.type === 'status_update') {
            uiStore.addNotification('info', chunk.message);
          } else if (chunk.type === 'tool_call_request') {
            const tool = chunk.tool;
            uiStore.addTaskStep(
              `${tool.name}: ${tool.arguments.slice(0, 50)}${tool.arguments.length > 50 ? '...' : ''}`,
              tool.id
            );
            uiStore.updateTaskStep(tool.id, 'pending');

            const currentSess = get().sessions.find(s => s.id === activeSessionId);
            const permissionMode = currentSess?.permissionMode || 'standard';

            // === PreToolUse Hooks (dangerous commands, path validation, permission mode) ===
            const hookResult = await runPreToolUseHooks({
              toolName: tool.name,
              toolArgs: tool.arguments,
              workDir: currentSess?.workDir,
              permissionMode,
              sessionId: activeSessionId,
            });

            let toolResultContent = '';
            if (!hookResult.approved) {
              // Hooks blocked the tool execution
              uiStore.updateTaskStep(tool.id, 'failed');
              uiStore.addNotification('error', hookResult.error || 'Tool execution blocked');
              toolResultContent = `Error: ${hookResult.error || 'Tool execution blocked'}`;
              chunk._resolve(toolResultContent);
            } else {
              // Hooks approved — now check permission mode for UI flow
              const effectiveArgs = hookResult.modifiedArgs || tool.arguments;
              const shouldBypass = permissionMode === 'bypass' || permissionMode === 'auto-edits';

              const approved = shouldBypass ? true : await uiStore.waitForPermission(tool);

              if (!approved) {
                uiStore.updateTaskStep(tool.id, 'failed');
                toolResultContent = 'Permission denied by user.';
              } else {
                uiStore.updateTaskStep(tool.id, 'running');
                try {
                  const workDir = currentSess?.workDir ?? null;
                  if (tool.name === 'get_current_workspace') {
                    toolResultContent = workDir
                      ? JSON.stringify({ work_dir: workDir, message: `Current working directory: ${workDir}` })
                      : JSON.stringify({ work_dir: null, message: 'No working directory bound to this session.' });
                  } else if (tool.name === 'agent_tool') {
                    // === Multi-Agent: AgentTool execution ===
                    const args = JSON.parse(effectiveArgs);
                    if (args.team_name && args.name) {
                      // Swarm teammate path
                      const { spawnTeammate, createTeam, getTeamStatus } = await import('../services/multiagent/swarm');
                      const { getCurrentAgentContext } = await import('../services/multiagent/agentContext');
                      const parentCtx = getCurrentAgentContext() || {
                        agentId: 'main',
                        sessionId: activeSessionId,
                        workDir: workDir || undefined,
                        toolPool: [],
                        metadata: {},
                      };

                      let team = getTeamStatus(args.team_name);
                      if (!team) {
                        team = createTeam(args.team_name, parentCtx, [args.name]);
                      }

                      const agentId = await spawnTeammate(
                        args.team_name,
                        args.name,
                        args.prompt,
                        args.description || `Teammate ${args.name}`,
                        parentCtx,
                      );
                      toolResultContent = `Teammate ${args.name} spawned in team ${args.team_name} with ID: ${agentId}`;
                    } else if (args.run_in_background) {
                      // Background subagent path
                      const { runAgentBackground } = await import('../services/multiagent/subagent');
                      const { getCurrentAgentContext } = await import('../services/multiagent/agentContext');
                      const parentCtx = getCurrentAgentContext() || {
                        agentId: 'main',
                        sessionId: activeSessionId,
                        workDir: workDir || undefined,
                        toolPool: [],
                        metadata: {},
                      };
                      const agentId = await runAgentBackground({
                        name: args.name || 'background-agent',
                        prompt: args.prompt,
                        description: args.description || 'Background agent task',
                        sessionId: activeSessionId,
                        parentContext: parentCtx,
                        runInBackground: true,
                        model: args.model,
                      });
                      toolResultContent = `Background agent started with ID: ${agentId}. Results will be delivered via task notification.`;
                    } else {
                      // Sync subagent path
                      const { runAgentSync } = await import('../services/multiagent/subagent');
                      const { getCurrentAgentContext } = await import('../services/multiagent/agentContext');
                      const parentCtx = getCurrentAgentContext() || {
                        agentId: 'main',
                        sessionId: activeSessionId,
                        workDir: workDir || undefined,
                        toolPool: [],
                        metadata: {},
                      };
                      const result = await runAgentSync({
                        name: args.name || 'subagent',
                        prompt: args.prompt,
                        description: args.description || 'Subagent task',
                        sessionId: activeSessionId,
                        parentContext: parentCtx,
                        model: args.model,
                      });
                      toolResultContent = result.success
                        ? result.content
                        : `Error: ${result.error}`;
                    }
                  } else {
                    toolResultContent = await invoke<string>('execute_tool', {
                      toolName: tool.name,
                      arguments: effectiveArgs,
                      workDir,
                    });
                  }
                  uiStore.updateTaskStep(tool.id, 'done');
                } catch (err) {
                  uiStore.updateTaskStep(tool.id, 'failed');
                  toolResultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
                }

                // === PostToolUse Hooks (audit logging, side effects) ===
                const postCtx: PostHookContext = {
                  toolName: tool.name,
                  toolArgs: effectiveArgs,
                  result: toolResultContent,
                  isError: toolResultContent.startsWith('Error:'),
                  sessionId: activeSessionId,
                };
                runPostToolUseHooks(postCtx).catch((e: unknown) => console.warn('[PostToolUseHooks] Error:', e));
              }
              chunk._resolve(toolResultContent);
            }
          } else if (chunk.type === 'error') {
            throw chunk.error;
          } else if (chunk.type === 'turn_complete') {
            if (chunk.tokenUsage) {
              tokenUsageResult = chunk.tokenUsage;
            }
          }
        }

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // Merge accumulated streaming content with tool loop's final content
        const { streamingContent, streamingReasoning, updateLastMessage } = get();
        const finalContent = streamingContent || '';

        const { content: cleanContent, reasoning: parsedReasoning } = parseThinkContent(finalContent);

        const tokenUsage = tokenUsageResult ? {
          input_tokens: tokenUsageResult.input_tokens,
          output_tokens: tokenUsageResult.output_tokens,
          model: tokenUsageResult.model || apiConfig.model,
        } : undefined;

        await updateLastMessage(
          cleanContent,
          undefined,
          mergeReasoningParts(streamingReasoning, parsedReasoning),
          tokenUsage,
        );

        if (tokenUsage) {
          const now = new Date();
          const date = now.toISOString().split('T')[0];
          await invoke('db_save_token_usage', {
            usage: {
              id: crypto.randomUUID(),
              session_id: activeSessionId,
              date,
              input_tokens: tokenUsage.input_tokens,
              output_tokens: tokenUsage.output_tokens,
              model: tokenUsage.model || apiConfig.model,
              created_at: Math.floor(now.getTime() / 1000),
            },
          }).catch((e: unknown) => console.error('Failed to save token usage:', e));
        }

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });

        // === Auto Memory Extraction (fire-and-forget) ===
        try {
          const { shouldExtractMemory, extractMemories } = await import('../services/memory/autoExtraction');
          const currentMsgs = currentMessages();
          // Simple heuristic: extract if session has 10+ messages and no tool calls in last turn
          if (currentMsgs.length >= 10 && shouldExtractMemory(currentMsgs, 0, false)) {
            extractMemories(currentMsgs, sessionWorkDir).catch((e: unknown) => console.warn('[Auto Memory] Extraction failed:', e));
          }
        } catch (e) {
          console.debug('Auto memory extraction setup failed:', e);
        }

        await runMicrocompactAfterStreaming(activeSessionId, set, get);
        await runSMCompactAfterStreaming(activeSessionId, set, get);
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        console.error('Failed to send message:', error);
        const errorMsg = typeof error === 'string' ? error : (error instanceof Error ? error.message : 'Failed to send message');
        setError(errorMsg);

        const { streamingContent: errContent, streamingReasoning: errReasoning, updateLastMessage: saveLastMsg } = get();
        if (errContent || errReasoning) {
          const { content: cleanErr, reasoning: parsedErrReasoning } = parseThinkContent(errContent || '');
          saveLastMsg(cleanErr, undefined, mergeReasoningParts(errReasoning, parsedErrReasoning)).catch(() => {});
        }

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });

        const sid = get().currentSessionId;
        if (sid) {
          set((state) => ({
            sessions: state.sessions.map((s) => {
              if (s.id !== sid || s.messages.length === 0) return s;
              const last = s.messages[s.messages.length - 1];
              if (last.role === 'assistant' && !last.content && !last.reasoning) {
                return { ...s, messages: s.messages.slice(0, -1) };
              }
              return s;
            }),
          }));
        }
      }
    },

    /**
     * Stop/cancel the current generation (kill subprocess)
     */
    stopGeneration: async () => {
      const { isStreaming, streamingContent, streamingReasoning, setStreaming, currentSessionId, setError } = get();
      if (!isStreaming) {
        console.log('stopGeneration: not streaming, returning');
        return;
      }
      console.log('stopGeneration: stopping...');

      // Capture content BEFORE clearing — this is the text the user has seen so far
      const capturedContent = streamingContent;
      const capturedReasoning = streamingReasoning;

      try {
        // Call the Rust backend to kill the subprocess
        console.log('stopGeneration: calling stop_subprocess');
        await invoke('stop_subprocess', { sessionId: currentSessionId });
        console.log('stopGeneration: stop_subprocess completed');
      } catch (error) {
        console.error('Failed to stop subprocess:', error);
        setError(`Failed to stop generation: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Parse <think> tags from captured content
      const parsed = parseThinkContent(capturedContent);
      const finalContent = parsed.content;
      const finalReasoning = mergeReasoningParts(capturedReasoning, parsed.reasoning);

      // Clear streaming content BEFORE updating message to prevent setStreaming from re-updating
      console.log('stopGeneration: clearing streaming content');
      set({ streamingContent: '', streamingReasoning: '' });

      // Update the last message with final content AND persist to database
      if (currentSessionId && (finalContent || finalReasoning)) {
        console.log('stopGeneration: updating and persisting last message');
        const { updateLastMessage } = get();
        await updateLastMessage(finalContent, undefined, finalReasoning);
      }

      // Now call setStreaming(false) — it won't re-update since streamingContent is now empty
      console.log('stopGeneration: calling setStreaming(false)');
      setStreaming(false);
      console.log('stopGeneration: done');
    },

    /**
     * Retry the last failed message.
     * Logic:
     * 1. Clear the current error
     * 2. Find the last user message
     * 3. Remove all messages following that user message (to clean up the failed assistant attempt)
     * 4. Call sendMessage with the same content
     */
    retryLastMessage: async () => {
      const { currentSessionId, sessions, error } = get();
      if (!currentSessionId || !error) return;

      const session = sessions.find((s) => s.id === currentSessionId);
      if (!session) return;

      const messages = session.messages;
      const lastUserIndex = [...messages].reverse().findIndex((m) => m.role === 'user');
      
      if (lastUserIndex !== -1) {
        const actualIndex = messages.length - 1 - lastUserIndex;
        const lastUserMessage = messages[actualIndex];
        const content = lastUserMessage.content;

        // Find messages to delete from DB (everything after the last user message, inclusive)
        const messagesToDelete = messages.slice(actualIndex);
        
        // Strip everything after the last user message (including the failed assistant placeholder)
        // This ensures the retry doesn't pollute the history with duplicates.
        set((state) => ({
          error: null,
          pendingToolCalls: 0,
          pendingToolResults: [],
          sessions: state.sessions.map((s) =>
            s.id === currentSessionId
              ? { ...s, messages: s.messages.slice(0, actualIndex) } // Remove user msg + everything after
              : s
          ),
        }));

        // DELETE from database to prevent orphans from reappearing on reload
        for (const msg of messagesToDelete) {
          invoke('db_delete_message', { messageId: msg.id }).catch(e => 
            console.error(`Failed to delete orphaned message ${msg.id} from DB:`, e)
          );
        }

        // Resend the message (this will add the user message back cleanly)
        await get().sendMessage(content);
      } else {
        // Fallback: just clear error if no user message found
        set({ error: null });
      }
    },

    /**
     * Add message to current session and persist to database
     */
    addMessage: async (message: Message) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      // Persist to database — skip hidden/transient messages (metadata not serialized to DB,
      // so they'd re-appear without the hidden flag on reload and pass through the UI filter)
      if (!message.metadata?.hidden) {
        try {
          await invoke('db_save_message', { message: messageToDb(message, currentSessionId) });
        } catch (error) {
          console.error('Failed to save message to database:', error);
        }
      }

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId
            ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() }
            : s
        ),
      }));
    },

    /**
     * Update last message content (for streaming updates) and persist to database
     */
    updateLastMessage: async (content: string, artifacts?: Message['artifacts'], reasoning?: string, tokenUsage?: Message['token_usage']) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      let messageToUpdate: Message | null = null;

      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== currentSessionId || s.messages.length === 0) return s;

          const lastMessageIndex = s.messages.length - 1;
          const lastMessage = s.messages[lastMessageIndex];

          if (lastMessage.role !== 'assistant') return s;

          const updatedMessage = {
            ...lastMessage,
            content,
            reasoning: mergeReasoningParts(reasoning, lastMessage.reasoning),
            artifacts: artifacts !== undefined ? artifacts : lastMessage.artifacts,
            token_usage: tokenUsage !== undefined ? tokenUsage : lastMessage.token_usage,
            updatedAt: Date.now(),
          };

          messageToUpdate = updatedMessage;

          return {
            ...s,
            messages: s.messages.map((m, i) => (i === lastMessageIndex ? updatedMessage : m)),
            updatedAt: Date.now(),
          };
        }),
      }));

      // Persist to database
      if (messageToUpdate) {
        try {
          await invoke('db_save_message', { message: messageToDb(messageToUpdate, currentSessionId) });
        } catch (error) {
          console.error('Failed to persist streaming update to database:', error);
        }
      }
    },

    /**
     * Update a specific message by ID (content + metadata) and persist to database.
     * Used for consolidating browser progress messages into a single dynamic bubble.
     */
    updateMessageContent: async (messageId: string, content: string, metadata?: Record<string, unknown>) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      let messageToUpdate: Message | null = null;

      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== currentSessionId) return s;

          const msgIndex = s.messages.findIndex((m) => m.id === messageId);
          if (msgIndex === -1) return s;

          const updatedMessage: Message = {
            ...s.messages[msgIndex],
            content,
            metadata: metadata !== undefined ? { ...s.messages[msgIndex].metadata, ...metadata } : s.messages[msgIndex].metadata,
          };

          messageToUpdate = updatedMessage;

          const newMessages = [...s.messages];
          newMessages[msgIndex] = updatedMessage;
          return { ...s, messages: newMessages, updatedAt: Date.now() };
        }),
      }));

      // Persist to database
      if (messageToUpdate) {
        try {
          await invoke('db_save_message', { message: messageToDb(messageToUpdate, currentSessionId) });
        } catch (error) {
          console.error('Failed to persist updateMessageContent to database:', error);
        }
      }
    },

    /**
     * Append streaming content to buffer and update last message with throttling (100ms)
     */
    appendStreamingContent: (content: string) => {
      const { currentSessionId, streamingContent, lastUiUpdateTime } = get();
      const newContent = streamingContent + content;
      const now = Date.now();

      // Always update streaming content buffer
      set({ streamingContent: newContent });

      // Throttle UI updates to every 100ms
      if (now - lastUiUpdateTime >= 100 && currentSessionId) {
        const { streamingReasoning } = get();
        // Parse <think> tags from streaming content
        const parsed = parseThinkContent(newContent);
        const displayContent = parsed.content;
        const parsedReasoning = parsed.reasoning;

        set((state) => ({
          lastUiUpdateTime: now,
          sessions: state.sessions.map((s) => {
            if (s.id !== currentSessionId || s.messages.length === 0) return s;
            const messages = [...s.messages];
            const lastMessage = messages[messages.length - 1];
            messages[messages.length - 1] = {
              ...lastMessage,
              content: displayContent,
              reasoning: mergeReasoningParts(parsedReasoning, streamingReasoning, lastMessage.reasoning),
            };
            return { ...s, messages, updatedAt: Date.now() };
          }),
        }));
      }
    },

    /**
     * Set streaming status with timeout protection (300 seconds)
     */
    setStreaming: (streaming: boolean) => {
      const { streamingTimeoutId, currentSessionId, streamingContent } = get();

      // Clear existing timeout when stopping streaming
      if (!streaming && streamingTimeoutId) {
        clearTimeout(streamingTimeoutId);

        // Final UI update to ensure content is fully displayed in the session
        if (currentSessionId && streamingContent) {
          const parsed = parseThinkContent(streamingContent);
          const finalContent = parsed.content;
          const finalReasoning = parsed.reasoning;
          const { streamingReasoning } = get();

          set((state) => ({
            isStreaming: false,
            streamingTimeoutId: null,
            sessions: state.sessions.map((s) => {
              if (s.id !== currentSessionId || s.messages.length === 0) return s;
              const messages = [...s.messages];
              const lastMessage = messages[messages.length - 1];
              messages[messages.length - 1] = {
                ...lastMessage,
                content: finalContent,
                reasoning: mergeReasoningParts(finalReasoning, streamingReasoning, lastMessage.reasoning),
              };
              return { ...s, messages, updatedAt: Date.now() };
            }),
          }));
        } else {
          set({ isStreaming: false, streamingTimeoutId: null });
        }
        return;
      }

      // Start streaming with 300 second timeout (5 minutes for complex tasks)
      if (streaming) {
        const timeoutId = setTimeout(() => {
          console.warn('Streaming timeout (300s) reached, stopping...');
          const { setStreaming, currentSessionId, streamingSessionId } = get();
          const owningSessionId = streamingSessionId || currentSessionId;
          if (owningSessionId) {
            invoke('stop_subprocess', { sessionId: owningSessionId }).catch((e: unknown) =>
              console.error('Failed to stop subprocess after generic streaming timeout:', e)
            );
          }
          setStreaming(false);
          set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
        }, 300000);
        set({ isStreaming: true, streamingTimeoutId: timeoutId });
      }
    },

    /**
     * Set error message
     */
    setError: (error: string | null) => {
      set({ error });
    },

    /**
     * Clear error message
     */
    clearError: () => {
      set({ error: null });
    },

    /**
     * Load sessions list
     */
    loadSessions: (sessions: Session[]) => {
      set({ sessions });
    },

    /**
     * Select a session
     */
    selectSession: (sessionId: string) => {
      const exists = get().sessions.some((s) => s.id === sessionId);
      if (exists) {
        const previousSessionId = get().currentSessionId;
        // Clear any pending timeout
        const { streamingTimeoutId } = get();
        if (streamingTimeoutId) {
          clearTimeout(streamingTimeoutId);
        }

        // Clear any stale ASK-mode permission dialogs from the previous session.
        // If a dialog is left open when the user switches sessions and they later
        // approve it, the tool_result gets injected into the WRONG session's message
        // history (no matching tool_use), causing a permanent 400 on every future call.
        useUIStore.getState().clearAllPermissions();

        // If we're leaving a session mid-ASK-flow, scrub its dangling tool_calls so
        // the next request to that session won't hit OpenAI-compatible 400 errors.
        if (
          previousSessionId &&
          previousSessionId !== sessionId &&
          (
            get().pendingToolCalls > 0 ||
            get().pendingToolResults.length > 0 ||
            useUIStore.getState().permissionQueue.length > 0
          )
        ) {
          void scrubDanglingToolCalls(previousSessionId, set, get);
        }

        // Persist current session ID so we can restore it on restart
        localStorage.setItem(CURRENT_SESSION_ID_STORAGE_KEY, sessionId);

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
      }
    },

    /**
     * Delete a session and remove from database
     */
    deleteSession: async (sessionId: string) => {
      // Delete from database
      try {
        await invoke('db_delete_session', { sessionId });
      } catch (error) {
        console.error('Failed to delete session from database:', error);
      }

      set((state) => {
        const newSessions = state.sessions.filter((s) => s.id !== sessionId);
        const newCurrentSessionId =
          state.currentSessionId === sessionId
            ? newSessions.length > 0
              ? newSessions[0].id
              : null
            : state.currentSessionId;

        return {
          sessions: newSessions,
          currentSessionId: newCurrentSessionId,
        };
      });
    },

    /**
     * Delete multiple sessions at once
     */
    deleteSessions: async (sessionIds: string[]) => {
      // Delete from database
      let deleteErrors = 0;
      for (const sessionId of sessionIds) {
        try {
          await invoke('db_delete_session', { sessionId });
          console.log(`🗑️ Deleted session from DB: ${sessionId}`);
        } catch (error) {
          deleteErrors++;
          console.error(`❌ Failed to delete session ${sessionId} from database:`, error);
        }
      }
      if (deleteErrors > 0) {
        console.warn(`⚠️ ${deleteErrors}/${sessionIds.length} sessions failed to delete from database`);
      } else {
        console.log(`✅ All ${sessionIds.length} sessions deleted from database`);
      }

      set((state) => {
        const sessionIdSet = new Set(sessionIds);
        const newSessions = state.sessions.filter((s) => !sessionIdSet.has(s.id));
        let newCurrentSessionId = state.currentSessionId;

        // If current session was deleted, select the first available one
        if (sessionIdSet.has(state.currentSessionId || '')) {
          newCurrentSessionId = newSessions.length > 0 ? newSessions[0].id : null;
        }

        return {
          sessions: newSessions,
          currentSessionId: newCurrentSessionId,
        };
      });
    },

    /**
     * Update session's working directory and persist to database
     */
    updateSessionCwd: async (sessionId: string, cwd: string) => {
      // Get the current session to update in database
      const session = get().sessions.find((s) => s.id === sessionId);
      if (session) {
        const updatedSession = { ...session, cwd, workDir: cwd, updatedAt: Date.now() };
        try {
          await invoke('db_save_session', { session: sessionToDb(updatedSession) });
        } catch (error) {
          console.error('Failed to update session cwd in database:', error);
        }
      }

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, cwd, workDir: cwd, updatedAt: Date.now() } : s
        ),
      }));
    },

    /**
     * Update session's project
     */
    updateSessionProject: async (sessionId: string, projectId: string | null) => {
      const session = get().sessions.find((s) => s.id === sessionId);
      if (session) {
        const updatedSession = { ...session, projectId: projectId || undefined, updatedAt: Date.now() };
        try {
          await invoke('db_save_session', { session: sessionToDb(updatedSession) });
        } catch (error) {
          console.error('Failed to update session project in database:', error);
        }
      }

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, projectId: projectId || undefined, updatedAt: Date.now() } : s
        ),
      }));
    },

    /**
     * Create a new project
     */
    createProject: async (name: string) => {
      const newProject = createProject(name);

      // Persist to database
      try {
        await invoke('db_save_project', { project: projectToDb(newProject) });
      } catch (error) {
        console.error('Failed to save project to database:', error);
      }

      set((state) => ({
        projects: [...state.projects, newProject],
      }));
    },

    /**
     * Delete a project (and all its sessions)
     */
    deleteProject: async (projectId: string) => {
      // Delete from database first
      try {
        await invoke('db_delete_project', { projectId });
      } catch (error) {
        console.error('Failed to delete project from database:', error);
      }

      // Delete all sessions in this project from database
      const sessionsInProject = get().sessions.filter((s) => s.projectId === projectId);
      for (const session of sessionsInProject) {
        try {
          await invoke('db_delete_session', { sessionId: session.id });
        } catch (error) {
          console.error('Failed to delete session from database:', error);
        }
      }

      set((state) => ({
        projects: state.projects.filter((p) => p.id !== projectId),
        sessions: state.sessions.filter((s) => s.projectId !== projectId),
        // If the current session was deleted, select another one
        currentSessionId: sessionsInProject.some((s) => s.id === state.currentSessionId)
          ? state.sessions.find((s) => s.projectId !== projectId)?.id || null
          : state.currentSessionId,
      }));
    },

    /**
     * Rename a project
     */
    renameProject: async (projectId: string, name: string) => {
      const project = get().projects.find((p) => p.id === projectId);
      if (project) {
        const updatedProject = { ...project, name, updatedAt: Date.now() };
        // Persist to database
        try {
          await invoke('db_update_project', { project: projectToDb(updatedProject) });
        } catch (error) {
          console.error('Failed to update project in database:', error);
        }

        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, name, updatedAt: Date.now() } : p
          ),
        }));
      }
    },

    setSessionWorkDir: async (sessionId: string) => {
      // 1. Open native folder picker
      const selectedPath = await invoke<string | null>('open_folder_dialog');
      if (!selectedPath) return null;

      // 2. Init .pipi-shrimp in selected folder
      // Returns "pipiDir|new" or "pipiDir|exists"
      const initResult = await invoke<string>('init_pipi_shrimp', { workDir: selectedPath });
      const isNewProject = initResult.endsWith('|new');

      // 3. Auto-scan project files if core.md was freshly created
      if (isNewProject) {
        try {
          const lines: string[] = [`## 📌 Project Overview\n`];

          // Read README if present
          for (const name of ['README.md', 'readme.md', 'README.txt']) {
            try {
              const res = await invoke<{ content: string }>('read_file', {
                path: `${selectedPath}/${name}`,
                workDir: selectedPath,
              });
              if (res?.content) {
                const preview = res.content.split('\n').slice(0, 20).join('\n');
                lines.push(`### README\n\`\`\`\n${preview}\n\`\`\`\n`);
                break;
              }
            } catch { /* not found */ }
          }

          // Detect tech stack from manifest files
          const techStack: string[] = [];
          const manifests = [
            { file: 'package.json', label: 'Node.js / JS/TS' },
            { file: 'Cargo.toml', label: 'Rust' },
            { file: 'pyproject.toml', label: 'Python' },
            { file: 'go.mod', label: 'Go' },
            { file: 'pom.xml', label: 'Java/Maven' },
            { file: 'build.gradle', label: 'Java/Gradle' },
          ];
          for (const { file, label } of manifests) {
            try {
              await invoke('read_file', { path: `${selectedPath}/${file}`, workDir: selectedPath });
              techStack.push(label);
            } catch { /* not found */ }
          }
          if (techStack.length > 0) {
            lines.push(`## 🛠 Tech Stack\n${techStack.map(t => `- ${t}`).join('\n')}\n`);
          }

          // List top-level structure
          try {
            const entries = await invoke<{ name: string; is_dir: boolean }[]>('list_files', {
              path: selectedPath,
            });
            const dirs = entries.filter(e => e.is_dir).map(e => `📁 ${e.name}`);
            const files = entries.filter(e => !e.is_dir).map(e => `📄 ${e.name}`);
            lines.push(`## 📖 Top-level Structure\n${[...dirs, ...files].join('\n')}\n`);
          } catch { /* skip */ }

          // Read existing core.md and inject auto-detected sections at the top
          const coreMdPath = `${selectedPath}/.pipi-shrimp/core.md`;
          const coreRes = await invoke<{ content: string }>('read_file', {
            path: coreMdPath,
            workDir: selectedPath,
          });
          const existing = coreRes?.content ?? '';
          // Replace the placeholder overview section with auto-detected content
          const updated = existing.replace(
            '## 📌 Project Overview\n[Auto-detected on bind — see below]\n\n## 🛠 Tech Stack\n[Auto-detected on bind — see below]',
            lines.join('\n')
          );
          await invoke('write_file', {
            path: coreMdPath,
            content: updated,
            workDir: selectedPath,
          });
        } catch (e) {
          console.debug('[setSessionWorkDir] auto-scan failed (non-fatal):', e);
        }
      }

      // 4. Update session in state and DB
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session) return null;

      const updated = { ...session, workDir: selectedPath, updatedAt: Date.now() };
      await invoke('db_save_session', { session: sessionToDb(updated) });

      set(state => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updated : s)
      }));

      return selectedPath;
    },

    clearSessionWorkDir: async (sessionId: string) => {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session) return;

      const updated = { ...session, workDir: undefined, updatedAt: Date.now() };
      await invoke('db_save_session', { session: sessionToDb(updated) });

      set(state => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updated : s)
      }));
    },

    writeToWorkDir: async (sessionId: string, filename: string, content: string) => {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session?.workDir) return null;

      try {
        // Get next output directory path
        const outputDir = await invoke<string>('get_next_output_dir', { workDir: session.workDir });

        // Create the directory
        await invoke('create_directory', { path: outputDir });

        // Write the file
        const filePath = `${outputDir}/${filename}`;
        await invoke('write_file', { path: filePath, content });

        console.log(`✅ Written to work dir: ${filePath}`);
        return filePath;
      } catch (error) {
        console.error('Failed to write to work dir:', error);
        return null;
      }
    },

    getWorkDirIndex: async (sessionId: string) => {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session?.workDir) return [];

      try {
        return await invoke<OutputFolder[]>('list_pipi_shrimp_index', { workDir: session.workDir });
      } catch (error) {
        console.error('Failed to get work dir index:', error);
        return [];
      }
    },

    // ========== Token Stats ==========

    getDailyTokenStats: async (yearMonth: string) => {
      try {
        return await invoke<{ date: string; input_tokens: number; output_tokens: number; total_tokens: number }[]>(
          'db_get_daily_token_stats',
          { yearMonth }
        );
      } catch (error) {
        console.error('Failed to get daily token stats:', error);
        return [];
      }
    },

    getMonthlyTokenStats: async () => {
      try {
        return await invoke<{ date: string; input_tokens: number; output_tokens: number; total_tokens: number }[]>(
          'db_get_monthly_token_stats'
        );
      } catch (error) {
        console.error('Failed to get monthly token stats:', error);
        return [];
      }
    },

    getModelTokenStats: async () => {
      try {
        return await invoke<{ model: string; input_tokens: number; output_tokens: number; total_tokens: number }[]>(
          'db_get_model_token_stats'
        );
      } catch (error) {
        console.error('Failed to get model token stats:', error);
        return [];
      }
    },

    getTotalTokenStats: async () => {
      try {
        const [input, output, total] = await invoke<[number, number, number]>('db_get_total_token_stats');
        return { input, output, total };
      } catch (error) {
        console.error('Failed to get total token stats:', error);
        return { input: 0, output: 0, total: 0 };
      }
    },
  }))
);

export type { Session, Message, Project } from '../types/chat';
