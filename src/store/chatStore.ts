/**
 * Chat store - Zustand state management for chat/sessions
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ChatState, Session, Message, Project, OutputFolder } from '../types/chat';
import { createSession, createMessage, createProject } from '../types/chat';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';
import type { ImportedFile } from '../types/settings';

/**
 * Streaming timeout - 300 seconds
 * If the API doesn't respond within this time, we'll force stop the streaming
 */
const STREAMING_TIMEOUT_MS = 300000;

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
    _eventListeners: [] as Array<() => void>,  // Cleanup functions for event listeners

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
      
      // Cleanup any existing event listeners before re-initializing
      const { _eventListeners } = get();
      if (_eventListeners.length > 0) {
        _eventListeners.forEach((unlisten) => {
          try {
            unlisten();
          } catch (e) {
            console.warn('Failed to unlisten event during re-init:', e);
          }
        });
      }
      
      // 立即设置，防止并发调用（App.tsx 和 Chat.tsx 都会调用 init）
      set({ isInitialized: true, _eventListeners: [] });

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

        // Set up streaming event listener
        const { appendStreamingContent } = get();

        // Listen for streaming tokens from Rust backend
        const unlistenToken = await listen<string>('claude-token', (event) => {
          appendStreamingContent(event.payload);
        });

        // Listen for token events from Rust backend (Reasoning)
        const unlistenReasoning = await listen<string>('claude-reasoning', (event) => {
          set((state) => ({ streamingReasoning: state.streamingReasoning + event.payload }));
        });

        // Listen for tool_use events from Rust backend
        const unlistenToolUse = await listen<{
          tool_call_id: string;
          name: string;
          arguments: string;
        }>('claude-tool-use', async (event) => {
          console.log('Tool use requested:', event.payload);

          // CROSS-SESSION GUARD: only process tool events that belong to the session
          // that started the current streaming request.
          //
          // IMPORTANT: use (!A || A !== B) not (A && A !== B).
          // The weaker (&&) form only fires when streamingSessionId is non-null, so stale
          // events that arrive *after* streaming has already completed (streamingSessionId
          // was cleared to null) would slip through and be executed in the wrong session.
          // The correct rule is: ONLY allow events when streamingSessionId is set AND
          // matches the current session. Discard everything else.
          const { streamingSessionId } = get();
          const currentSessId = get().currentSessionId;
          if (!streamingSessionId || streamingSessionId !== currentSessId) {
            console.warn(
              `[cross-session guard] Discarding stale tool-use event. ` +
              `streamingSessionId=${streamingSessionId ?? 'null'}, currentSessId=${currentSessId}`
            );
            return;
          }

          // Increment pending tool calls counter for batching
          set((state) => ({ pendingToolCalls: state.pendingToolCalls + 1 }));

          const { setPermissionRequest, addTaskStep } = useUIStore.getState();
          const { executeTool, currentMessages, currentSession } = get();

          // Get permissionMode from current session (per-session setting)
          const session = currentSession();
          const permissionMode = session?.permissionMode || 'standard';

          // Update the last assistant message to include tool_calls
          // This is needed so when we send tool result, the API knows which tool_call we're responding to
          const msgs = currentMessages();
          if (msgs.length > 0) {
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg.role === 'assistant') {
              const updatedToolCalls = [
                ...(lastMsg.tool_calls || []),
                {
                  id: event.payload.tool_call_id,
                  name: event.payload.name,
                  arguments: event.payload.arguments,
                },
              ];
              // Add tool_calls to the last assistant message in memory
              set((state) => ({
                sessions: state.sessions.map((s) =>
                  s.id === currentSessId
                    ? {
                        ...s,
                        messages: s.messages.map((m, i) =>
                          i === s.messages.length - 1 && m.role === 'assistant'
                            ? { ...m, tool_calls: updatedToolCalls }
                            : m
                        ),
                      }
                    : s
                ),
              }));
              // CRITICAL: persist to database so tool_calls survive across message rebuilds
              const updatedMsg = { ...lastMsg, tool_calls: updatedToolCalls };
              invoke('db_save_message', { message: messageToDb(updatedMsg, currentSessId!) })
                .catch((e: unknown) => console.error('Failed to persist tool_calls:', e));
            }
          }

          // Add to task progress UI — use tool_call_id as step id for precise lookup later
          addTaskStep(
            `${event.payload.name}: ${event.payload.arguments.slice(0, 50)}${event.payload.arguments.length > 50 ? '...' : ''}`,
            event.payload.tool_call_id
          );

          if (permissionMode === 'bypass' || permissionMode === 'auto-edits') {
            // Auto mode and bypass mode: execute without asking
            console.log(`${permissionMode} mode active, auto-executing tool...`);
            await executeTool(event.payload.name, event.payload.arguments, event.payload.tool_call_id);
          } else {
            // ASK mode: show permission modal
            setPermissionRequest({
              id: event.payload.tool_call_id,
              toolName: event.payload.name,
              toolInput: event.payload.arguments,
              description: `Execute ${event.payload.name}?`,
            });
          }
        });

        // Store unlisten functions in store state for proper cleanup
        set({ _eventListeners: [unlistenToken, unlistenReasoning, unlistenToolUse] });

        console.log('✅ Store initialization completed successfully');
        set({ isInitialized: true, error: null });
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
     * Execute a tool and handle the result (permission-aware)
     * Modified to batch tool results - collects results and sends all at once
     */
    executeTool: async (toolName: string, toolInput: string, toolCallId: string) => {
      const { setError } = get();
      const { addNotification, taskProgress, updateTaskStep } = useUIStore.getState();

      // Capture the owning session at call-time. If the user switches sessions while
      // this async tool is running, we discard the result rather than injecting an
      // orphaned tool_result into the wrong session (which causes a 400 on next call).
      const owningSessionId = get().currentSessionId;

      // Find the task step by toolCallId (exact match — avoids wrong step when same tool runs multiple times)
      const currentStep = taskProgress.find(s => s.id === toolCallId);
      if (currentStep) {
        updateTaskStep(currentStep.id, 'running');
      }

      try {
        addNotification('info', `Executing tool: ${toolName}...`);

        // get_current_workspace is handled on the TS side — no Rust round-trip needed.
        // The session's workDir is already in memory; returning it avoids the paradox of
        // asking the AI to supply the path it is trying to discover.
        let result: string;
        if (toolName === 'get_current_workspace') {
          const session = get().sessions.find(s => s.id === owningSessionId);
          const workDir = session?.workDir;
          result = workDir
            ? JSON.stringify({ work_dir: workDir, message: `Current working directory: ${workDir}` })
            : JSON.stringify({ work_dir: null, message: 'No working directory bound to this session. Ask the user to bind a folder first.' });
        } else {
          const session = get().sessions.find(s => s.id === owningSessionId);
          const workDir = session?.workDir ?? null;
          // Call Rust backend to execute the tool
          result = await invoke<string>('execute_tool', {
            toolName: toolName,   // Tauri auto-converts camelCase → snake_case for Rust
            arguments: toolInput,
            workDir,
          });
        }

        // Session-consistency check: if the user switched sessions while the tool was
        // running, discard this result. Injecting it would corrupt the new session's
        // message history (orphaned tool_result → 400 on every subsequent API call).
        if (get().currentSessionId !== owningSessionId) {
          console.warn(
            `[executeTool] Session changed during execution of ${toolName} ` +
            `(was ${owningSessionId}, now ${get().currentSessionId}). Discarding result.`
          );
          set((state) => ({ pendingToolCalls: Math.max(0, state.pendingToolCalls - 1) }));
          return;
        }

        console.log(`Tool ${toolName} executed successfully:`, result);

        if (currentStep) {
          updateTaskStep(currentStep.id, 'done');
        }

        // Collect the result instead of sending immediately (for batching)
        set((state) => ({
          pendingToolResults: [...state.pendingToolResults, { toolCallId, result }],
          pendingToolCalls: Math.max(0, state.pendingToolCalls - 1),  // Prevent negative
        }));

        // Check if all tool calls are complete, then send all results at once
        const { pendingToolCalls: remaining, sendAllToolResults } = get();
        if (remaining === 0) {
          console.log('All tool calls complete, sending batched results...');
          await sendAllToolResults();
        }

      } catch (error) {
        console.error(`Tool ${toolName} execution failed:`, error);

        if (currentStep) {
          updateTaskStep(currentStep.id, 'failed');
        }

        // Decrement counter on error and add error result so AI can see what happened
        const errorMessage = error instanceof Error ? error.message : String(error);
        set((state) => ({
          pendingToolCalls: Math.max(0, state.pendingToolCalls - 1),  // Prevent negative
          pendingToolResults: [
            ...state.pendingToolResults,
            { toolCallId, result: `Error: ${errorMessage}` },
          ],
        }));

        setError(`Tool ${toolName} failed: ${errorMessage}`);
        useUIStore.getState().addNotification('error', `Execution failed: ${toolName}`);

        // Check if all tools are done (even with errors)
        const { pendingToolCalls: remaining, sendAllToolResults } = get();
        if (remaining === 0) {
          await sendAllToolResults();
        }
      }
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
      const hasPendingAskFlow =
        isCurrentSession &&
        (pendingPermissions.length > 0 || get().pendingToolCalls > 0 || get().pendingToolResults.length > 0);

      const updatedSession = {
        ...session,
        permissionMode,
        updatedAt: Date.now(),
      };

      // Update local state
      set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? updatedSession : s),
        // Keep in-flight tool state intact when switching to auto modes for the active session.
        // Ask -> bypass/auto should continue the existing tool loop, not corrupt it.
        ...(hasPendingAskFlow && (permissionMode === 'bypass' || permissionMode === 'auto-edits')
          ? {}
          : {
              pendingToolCalls: 0,
              pendingToolResults: [],
            }),
      }));

      // Persist to database
      await invoke('db_save_session', { session: sessionToDb(updatedSession) });

      if (!hasPendingAskFlow) return;

      if (permissionMode === 'bypass' || permissionMode === 'auto-edits') {
        // Drain queued ASK permissions into immediate execution.
        useUIStore.getState().clearAllPermissions();
        for (const req of pendingPermissions) {
          await get().executeTool(req.toolName, req.toolInput, req.id);
        }
        return;
      }

      // Switching away from Ask while tool calls are unresolved would leave the
      // session history malformed (assistant.tool_calls with no tool_result).
      useUIStore.getState().clearAllPermissions();
      await scrubDanglingToolCalls(sessionId, set, get);
      set({
        pendingToolCalls: 0,
        pendingToolResults: [],
        streamingSessionId: null,
      });
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
     * Send all accumulated tool results to AI in a single batch
     */
    sendAllToolResults: async () => {
      const {
        currentSessionId,
        pendingToolResults,
        addMessage,
        setStreaming,
        setError,
        currentMessages,
        updateLastMessage,
      } = get();

      if (!currentSessionId || pendingToolResults.length === 0) {
        // Clear pending state
        set({ pendingToolResults: [], pendingToolCalls: 0 });
        return;
      }

      try {
        setStreaming(true);
        // Reset both streaming buffers before the second API call
        set({ streamingContent: '', streamingReasoning: '' });

        // Add all tool results as user messages (Claude SDK bridge will convert to 'tool' role)
        // NOTE: Do NOT set tool_call_id on the message — the __TOOL_RESULT__: prefix in content
        // is the sole source of truth for Rust's format_messages_for_anthropic().
        // Setting tool_call_id causes Rust's branch-1 to use the raw content (still prefixed).
        for (const { toolCallId, result } of pendingToolResults) {
          const resultMessage = createMessage('user', `__TOOL_RESULT__:${toolCallId}:${result}`);
          await addMessage(resultMessage);
        }

        const apiConfig = useSettingsStore.getState().getActiveConfig();
        if (!apiConfig) {
          setError('No API configuration found. Please add an API key in Settings.');
          setStreaming(false);
          set({ pendingToolResults: [], pendingToolCalls: 0 });
          return;
        }

        // Prepare all messages for next turn - include tool_calls when present
        // IMPORTANT: TypeScript ToolCall uses 'id' but Rust ToolCall expects 'tool_call_id'
        const messages = buildApiMessages(currentMessages());

        if (messages.length === 0) {
          setError('Message history is empty. Cannot continue conversation.');
          setStreaming(false);
          set({ pendingToolResults: [], pendingToolCalls: 0 });
          return;
        }

        // Diagnostic: log messages being sent to help debug tool_call_id issues
        console.log('[sendAllToolResults] pendingToolResults:', JSON.stringify(pendingToolResults));
        console.log('[sendAllToolResults] messages being sent to API:', JSON.stringify(
          messages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content.slice(0, 80) : m.content,
            tool_calls: m.tool_calls ? m.tool_calls.map((tc: {tool_call_id: string; name: string}) => ({ id: tc.tool_call_id, name: tc.name })) : undefined,
            tool_call_id: m.tool_call_id,
          }))
        ));

        // Create placeholder for AI's next thought
        const assistantMessage = createMessage('assistant', '');
        await addMessage(assistantMessage);

        // Build full system prompt — mirror sendMessage: session-level only, no global files
        let systemPrompt = useUIStore.getState().agentInstructions;
        const toolResultSession = get().sessions.find(s => s.id === currentSessionId);
        const sessionWorkingFilesForTool = toolResultSession?.workingFiles ?? [];
        const sessionWorkDirForTool = toolResultSession?.workDir;

        if (sessionWorkDirForTool) {
          systemPrompt += `\n\n## Working Directory\n\nYour working directory for this session is: \`${sessionWorkDirForTool}\`\nUse this path with \`bash\`, \`read_file\`, \`write_file\`, \`list_files\`, and \`grep\` tools.`;
        }
        if (sessionWorkingFilesForTool.length > 0) {
          const filesList = sessionWorkingFilesForTool.map(f => `- ${f.name}: ${f.path}`).join('\n');
          systemPrompt += `\n\n## Working Files\n\nThe following files have been added to this session's context:\n${filesList}\n\nUse \`read_file\` with the exact paths above to read their contents before editing.`;
        }

        const response = await invoke<{
          content: string;
          artifacts: Array<{
            type: string;
            content: string;
            title?: string;
            language?: string;
          }>;
          model: string;
          usage?: { input_tokens: number; output_tokens: number };
          tool_calls: Array<{ tool_call_id: string; name: string; arguments: string }>;
        }>('send_claude_sdk_chat_streaming', {
          messages,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          baseUrl: apiConfig.baseUrl || '',
          systemPrompt,
        });

        // Finalize the assistant message with streamed content
        const { streamingContent: finalContent, streamingReasoning } = get();

        const usedMoreTools = response.tool_calls && response.tool_calls.length > 0;

        if (usedMoreTools) {
          // AI called another tool in this turn - save reasoning, let the next
          // sendAllToolResults handle finalization (the event handler already fired)
          const rawPrefix = finalContent || response.content || '';
          const { reasoning: parsedPrefixReasoning } = parseThinkContent(rawPrefix);
          await updateLastMessage('', undefined, mergeReasoningParts(streamingReasoning, parsedPrefixReasoning));
          // Clear pending list (already processed) but leave streaming active
          set({ pendingToolResults: [], streamingContent: '', streamingReasoning: '' });
        } else {
          // Final response - no more tools
          // Strip <think>...</think> tags before persisting (MiniMax embeds think inline).
          const rawFinal = finalContent || response.content || '';
          const { content: cleanFinal, reasoning: parsedFinalReasoning } = parseThinkContent(rawFinal);
          
          // Prepare token usage for message
          const tokenUsage = response.usage ? {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            model: response.model || apiConfig?.model,
          } : undefined;
          
          await updateLastMessage(
            cleanFinal,
            response.artifacts?.map((a) => ({
              id: crypto.randomUUID(),
              type: a.type as 'html' | 'svg' | 'mermaid' | 'react' | 'code',
              content: a.content,
              title: a.title,
              language: a.language,
            })),
            mergeReasoningParts(streamingReasoning, parsedFinalReasoning),
            tokenUsage
          );
          
          // Save token usage to database
          if (response.usage) {
            const now = new Date();
            const date = now.toISOString().split('T')[0];  // YYYY-MM-DD
            await invoke('db_save_token_usage', {
              usage: {
                id: crypto.randomUUID(),
                session_id: currentSessionId,
                date,
                input_tokens: response.usage.input_tokens,
                output_tokens: response.usage.output_tokens,
                model: response.model || apiConfig?.model || 'unknown',
                created_at: Math.floor(now.getTime() / 1000),
              },
            }).catch((e: unknown) => console.error('Failed to save token usage:', e));
          }
          
          // Clear all streaming + pending state (including cross-session guard)
          set({ pendingToolResults: [], pendingToolCalls: 0, streamingContent: '', streamingReasoning: '', streamingSessionId: null });
          setStreaming(false);
        }

      } catch (error) {
        console.error('Failed to send tool results:', error);
        // Surface the actual error message so the user can diagnose the problem
        // (e.g. API error, context-length exceeded, network failure, etc.)
        const errMsg = typeof error === 'string'
          ? error
          : (error instanceof Error ? error.message : String(error));
        setError(`Failed to send tool results: ${errMsg}`);
        setStreaming(false);
        set({ pendingToolResults: [], pendingToolCalls: 0, streamingContent: '', streamingReasoning: '', streamingSessionId: null });

        // Remove empty assistant placeholder to prevent "Thinking..." stuck state
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
     * Send tool execution result back to AI
     */
    sendToolResult: async (toolCallId: string, result: string) => {
      const {
        currentSessionId,
        addMessage,
        setStreaming,
        setError,
        currentMessages
      } = get();

      if (!currentSessionId) return;

      try {
        setStreaming(true);
        set({ streamingContent: '' });

        // Add tool result as a "user" message (Claude SDK bridge will convert to 'tool' role)
        // NOTE: Do NOT set tool_call_id — use __TOOL_RESULT__: prefix only (see sendAllToolResults)
        const resultMessage = createMessage('user', `__TOOL_RESULT__:${toolCallId}:${result}`);
        await addMessage(resultMessage);

        const apiConfig = useSettingsStore.getState().getActiveConfig();

        // Prepare all messages for next turn - include tool_calls when present
        // IMPORTANT: TypeScript ToolCall uses 'id' but Rust ToolCall expects 'tool_call_id'
        const messages = buildApiMessages(currentMessages());

        if (messages.length === 0) {
          setError('Message history is empty. Cannot continue conversation.');
          setStreaming(false);
          return;
        }

        // Create placeholder for AI's next thought
        const assistantMessage = createMessage('assistant', '');
        await addMessage(assistantMessage);

        await invoke<{
          content: string;
          artifacts: any[];
          usage?: { input_tokens: number; output_tokens: number };
        }>('send_claude_sdk_chat_streaming', {
          messages,
          apiKey: apiConfig?.apiKey,
          model: apiConfig?.model,
          baseUrl: apiConfig?.baseUrl || '',
          systemPrompt: useUIStore.getState().agentInstructions,
        });

        // Event listener 'claude-token' will handle UI updates
      } catch (error) {
        console.error('Failed to send tool result:', error);
        setError('Failed to send tool result back to AI');
        setStreaming(false);
      }
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
            set({ streamingContent: '', streamingReasoning: '' });
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
     * Send message - call API (with streaming)
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

      // Clear previous progress
      useUIStore.getState().clearTaskProgress();

      // Get active API config from settings store
      const apiConfig = useSettingsStore.getState().getActiveConfig();
      if (!apiConfig?.apiKey) {
        setError('API key not configured. Please set up your API key in Settings.');
        return;
      }

      // Timeout timer reference
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        // Add user message
        const userMessage = createMessage('user', content);
        if (targetSessionId && targetSessionId !== get().currentSessionId) {
          get().selectSession(targetSessionId);
        }
        await addMessage(userMessage);

        // Set streaming state — record which session owns this request so the
        // claude-tool-use listener can discard stale events if the user switches sessions.
        setStreaming(true);
        set({ streamingContent: '', streamingSessionId: activeSessionId });

        // Set timeout protection - use the same timeout as setStreaming (300s)
        timeoutId = setTimeout(() => {
          console.warn(`⏱️ Streaming timeout after ${STREAMING_TIMEOUT_MS / 1000}s, force stopping...`);
          if (get().isStreaming) {
            setStreaming(false);
            set({ streamingContent: '', streamingReasoning: '' });
            setError(`Response timeout (${STREAMING_TIMEOUT_MS / 1000}s exceeded). Please try again.`);
            // Try to stop the subprocess
            invoke('stop_subprocess').catch(console.error);
          }
        }, STREAMING_TIMEOUT_MS);

        // Convert frontend messages to Rust format
        // IMPORTANT: TypeScript ToolCall uses 'id' but Rust ToolCall expects 'tool_call_id'
        const messages = buildApiMessages(currentMessages());

        if (messages.length === 0) {
          setError('Message content is empty. Cannot send.');
          setStreaming(false);
          return;
        }

        // Create placeholder assistant message for streaming updates
        const assistantMessage = createMessage('assistant', '');
        await addMessage(assistantMessage);

        // Build system prompt with session-level context only.
        // IMPORTANT: Global importedFiles are intentionally NOT included here — they would
        // contaminate every conversation. Each session's context is self-contained.
        let systemPrompt = useUIStore.getState().agentInstructions;

        const currentSession = get().sessions.find(s => s.id === activeSessionId);
        const sessionWorkingFiles = currentSession?.workingFiles ?? [];
        const sessionWorkDir = currentSession?.workDir;

        // Inject bound working directory into system prompt so AI knows where to navigate
        if (sessionWorkDir) {
          systemPrompt += `\n\n## Working Directory\n\nYour working directory for this session is: \`${sessionWorkDir}\`\nUse this path with \`bash\`, \`read_file\`, \`write_file\`, \`list_files\`, and \`grep\` tools. Resolve all relative paths against this directory.`;
          
          try {
            const coreMdPath = `${sessionWorkDir}/.pipi-shrimp/core.md`;
            const coreMdRes = await invoke<{ content: string; path: string }>('read_file', { 
              path: coreMdPath,
              workDir: sessionWorkDir
            });
            if (coreMdRes && coreMdRes.content) {
              systemPrompt += `\n\n## Project Core Memory (.pipi-shrimp/core.md)\n\n${coreMdRes.content}\n\n**CRITICAL INSTRUCTION**: The user relies on \`.pipi-shrimp/core.md\` to preserve project context between sessions. If the user tells you new persistent information about the project (e.g., what it is, tech stack, architecture, or rules), you MUST use the \`write_file\` tool to update \`.pipi-shrimp/core.md\` immediately so you don't forget it in future sessions. Combine the new knowledge with the existing content gracefully.`;
            }
          } catch (e) {
            console.debug('No core.md found or failed to read:', e);
          }
        }

        // Inject session-level working files (only files explicitly added to this session)
        if (sessionWorkingFiles.length > 0) {
          const filesList = sessionWorkingFiles.map((f) => `- ${f.name}: ${f.path}`).join('\n');
          systemPrompt += `\n\n## Working Files\n\nThe following files have been added to this session's context:\n${filesList}\n\nUse \`read_file\` with the exact paths above to read their contents before editing.`;
        }

        // Use streaming command
        // NOTE: response.tool_calls is non-empty when AI used tools this turn
        const response = await invoke<{
          content: string;
          artifacts: Array<{
            type: string;
            content: string;
            title?: string;
            language?: string;
          }>;
          model: string;
          usage: { input_tokens: number; output_tokens: number };
          tool_calls: Array<{ tool_call_id: string; name: string; arguments: string }>;
        }>('send_claude_sdk_chat_streaming', {
          messages,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          baseUrl: apiConfig.baseUrl || '',
          systemPrompt,
        });

        // Clear timeout on success
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        const { streamingContent: finalContent, streamingReasoning } = get();
        const { updateLastMessage } = get();

        const usedTools = response.tool_calls && response.tool_calls.length > 0;

        if (usedTools) {
          // Tools were called this turn. The event handler (claude-tool-use) will call
          // executeTool → sendAllToolResults which handles the second API call and ALL
          // final cleanup (setStreaming(false), clearing state).
          // Save any text the AI wrote before the tool call + reasoning.
          // Strip <think>...</think> so DB doesn't store raw think tags.
          const rawPrefix = finalContent || response.content || '';
          const { content: cleanPrefix, reasoning: parsedPrefixReasoning } = parseThinkContent(rawPrefix);
          await updateLastMessage(cleanPrefix, undefined, mergeReasoningParts(streamingReasoning, parsedPrefixReasoning));
          // Do NOT call setStreaming(false) or clear streamingContent here —
          // that would race with sendAllToolResults' second streaming invoke.
        } else {
          // Normal text response — finalize here.
          // Strip <think>...</think> tags before persisting (MiniMax embeds think inline).
          const rawContent = finalContent || response.content || '';
          const { content: cleanContent, reasoning: parsedReasoning } = parseThinkContent(rawContent);
          
          // Prepare token usage for message
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
          
          // Save token usage to database
          if (response.usage) {
            const now = new Date();
            const date = now.toISOString().split('T')[0];  // YYYY-MM-DD
            await invoke('db_save_token_usage', {
              usage: {
                id: crypto.randomUUID(),
                session_id: activeSessionId,
                date,
                input_tokens: response.usage.input_tokens,
                output_tokens: response.usage.output_tokens,
                model: response.model || apiConfig.model,
                created_at: Math.floor(now.getTime() / 1000),
              },
            }).catch((e: unknown) => console.error('Failed to save token usage:', e));
          }
          
          setStreaming(false);
          set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });
        }
      } catch (error) {
        // Clear timeout on error
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        console.error('Failed to send message:', error);
        const errorMsg = typeof error === 'string' ? error : (error instanceof Error ? error.message : 'Failed to send message');
        setError(errorMsg);
        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '', streamingSessionId: null });

        // Remove empty assistant placeholder to prevent "Thinking..." stuck state
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

      try {
        // Call the Rust backend to kill the subprocess
        console.log('stopGeneration: calling stop_subprocess');
        await invoke('stop_subprocess');
        console.log('stopGeneration: stop_subprocess completed');
      } catch (error) {
        console.error('Failed to stop subprocess:', error);
        setError(`Failed to stop generation: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Parse any <think> tags from streamingContent
      const parsed = parseThinkContent(streamingContent);
      const finalContent = parsed.content;
      const finalReasoning = mergeReasoningParts(streamingReasoning, parsed.reasoning);

      // Clear streaming content BEFORE updating message to prevent setStreaming from re-updating
      console.log('stopGeneration: clearing streaming content');
      set({ streamingContent: '', streamingReasoning: '' });

      // Update the last message with final content and reasoning
      if (currentSessionId && (finalContent || finalReasoning)) {
        console.log('stopGeneration: updating last message');
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== currentSessionId || s.messages.length === 0) return s;
            const lastMessage = s.messages[s.messages.length - 1];
            if (lastMessage.role !== 'assistant') return s;
            return {
              ...s,
              messages: [
                ...s.messages.slice(0, -1),
                {
                  ...lastMessage,
                  content: finalContent,
                  reasoning: finalReasoning || lastMessage.reasoning,
                },
              ],
              updatedAt: Date.now(),
            };
          }),
        }));
      }

      // Now call setStreaming(false) - it won't re-update since streamingContent is now empty
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

        // Final UI update to ensure content is fully displayed
        if (currentSessionId && streamingContent) {
          // Parse <think> tags from final content
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
          const { setStreaming } = get();
          setStreaming(false);
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
      await invoke('init_pipi_shrimp', { workDir: selectedPath });

      // 3. Update session in state and DB
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

    /**
     * Cleanup all event listeners (call on app unmount or before re-init)
     */
    cleanup: () => {
      const { _eventListeners } = get();
      _eventListeners.forEach((unlisten) => {
        try {
          unlisten();
        } catch (e) {
          console.warn('Failed to unlisten event:', e);
        }
      });
      set({ _eventListeners: [], isInitialized: false });
    },
  }))
);

export type { Session, Message, Project } from '../types/chat';
