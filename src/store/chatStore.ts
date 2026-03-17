/**
 * Chat store - Zustand state management for chat/sessions
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import type { ChatState, Session, Message, Project } from '../types/chat';
import { createSession, createMessage, createProject } from '../types/chat';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';

/**
 * Streaming timeout - 30 seconds
 * If the API doesn't respond within this time, we'll force stop the streaming
 */
const STREAMING_TIMEOUT_MS = 30000;

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
}

interface DbMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  reasoning: string | null;
  artifacts: string | null;
  created_at: number;
}

interface DbProject {
  id: string;
  name: string;
  description?: string;
  color?: string;
  created_at: number;
  updated_at: number;
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
  messages: dbMessages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    reasoning: m.reasoning || undefined,
    timestamp: m.created_at,
    artifacts: m.artifacts ? JSON.parse(m.artifacts) : undefined,
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
});

/**
 * Convert frontend project to database project
 */
const projectToDb = (project: Project): DbProject => ({
  id: project.id,
  name: project.name,
  created_at: project.createdAt,
  updated_at: project.updatedAt,
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

  // Remove all <think>...</think> blocks from content
  cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Handle incomplete thinking (still streaming) - remove partial <think> at the end
  const partialThink = cleanContent.match(/<think>[\s\S]*$/);
  if (partialThink) {
    cleanContent = cleanContent.replace(/<think>[\s\S]*$/, '').trim();
  }

  return {
    content: cleanContent,
    reasoning: thinkingParts.length > 0 ? thinkingParts.join('\n') : undefined,
  };
};

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
        // Load Projects from database (with fallback)
        try {
          console.log('🔄 Loading projects from database...');
          const dbProjects = await invoke<DbProject[]>('db_get_all_projects');
          console.log('✅ Projects loaded:', dbProjects);
          const projects: Project[] = dbProjects.map(dbToProject);
          set({ projects });
        } catch (error) {
          console.warn('Failed to load projects, continuing with empty projects:', error);
          set({ projects: [] });
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
              const dbMessages = await invoke<DbMessage[]>('db_get_messages', {
                sessionId: dbSession.id,
              });
              return dbToSession(dbSession, dbMessages);
            } catch (err) {
              console.error(`Failed to load messages for session ${dbSession.id}:`, err);
              throw err;
            }
          })
        );
        console.log('✅ All messages loaded');

        set({ sessions });

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

          // Increment pending tool calls counter for batching
          set((state) => ({ pendingToolCalls: state.pendingToolCalls + 1 }));

          const { permissionMode, setPermissionRequest, addTaskStep } = useUIStore.getState();
          const { executeTool, currentMessages } = get();

          // Update the last assistant message to include tool_calls
          // This is needed so when we send tool result, the API knows which tool_call we're responding to
          const messages = currentMessages();
          if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.role === 'assistant') {
              // Add tool_calls to the last assistant message
              set((state) => ({
                sessions: state.sessions.map((s) =>
                  s.id === get().currentSessionId
                    ? {
                        ...s,
                        messages: s.messages.map((m, i) =>
                          i === s.messages.length - 1 && m.role === 'assistant'
                            ? {
                                ...m,
                                tool_calls: [
                                  ...(m.tool_calls || []),
                                  {
                                    id: event.payload.tool_call_id,
                                    name: event.payload.name,
                                    arguments: event.payload.arguments,
                                  },
                                ],
                              }
                            : m
                        ),
                      }
                    : s
                ),
              }));
            }
          }

          // Add to task progress UI
          addTaskStep(`${event.payload.name}: ${event.payload.arguments.slice(0, 50)}${event.payload.arguments.length > 50 ? '...' : ''}`);

          if (permissionMode === 'bypass') {
            console.log('Bypass mode active, auto-executing tool...');
            await executeTool(event.payload.name, event.payload.arguments, event.payload.tool_call_id);
          } else {
            // Trigger permission request via UI store
            setPermissionRequest({
              id: event.payload.tool_call_id,
              toolName: event.payload.name,
              toolInput: event.payload.arguments,
              description: `Execute ${event.payload.name}?`,
            });
          }
        });

        // Store unlisten functions for cleanup
        (window as unknown as { __claudeTokenUnlisten: () => void }).__claudeTokenUnlisten = unlistenToken;
        (window as unknown as { __claudeReasoningUnlisten: () => void }).__claudeReasoningUnlisten = unlistenReasoning;
        (window as unknown as { __claudeToolUseUnlisten: () => void }).__claudeToolUseUnlisten = unlistenToolUse;

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
      const newSession = createSession(undefined, projectId, model);

      // Save to database
      try {
        await invoke('db_save_session', { session: sessionToDb(newSession) });
      } catch (error) {
        console.error('Failed to save session to database:', error);
      }

      set((state) => ({
        sessions: [...state.sessions, newSession],
        currentSessionId: newSession.id,
      }));
    },

    /**
     * Execute a tool and handle the result (permission-aware)
     * Modified to batch tool results - collects results and sends all at once
     */
    executeTool: async (toolName: string, toolInput: string, toolCallId: string) => {
      const { setError } = get();
      const { addNotification, taskProgress, updateTaskStep } = useUIStore.getState();

      // Find the task step to update status
      const currentStep = taskProgress.find(s => s.label.startsWith(toolName));
      if (currentStep) {
        updateTaskStep(currentStep.id, 'running');
      }

      try {
        addNotification('info', `Executing tool: ${toolName}...`);

        // Call Rust backend to execute the tool
        const result = await invoke<string>('execute_tool', {
          tool_name: toolName,
          arguments: toolInput,
        });

        console.log(`Tool ${toolName} executed successfully:`, result);

        if (currentStep) {
          updateTaskStep(currentStep.id, 'done');
        }

        // Collect the result instead of sending immediately (for batching)
        set((state) => ({
          pendingToolResults: [...state.pendingToolResults, { toolCallId, result }],
          pendingToolCalls: state.pendingToolCalls - 1,
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

        // Still decrement counter on error
        set((state) => ({
          pendingToolCalls: state.pendingToolCalls - 1,
        }));

        setError(`Tool ${toolName} failed: ${error instanceof Error ? error.message : String(error)}`);
        useUIStore.getState().addNotification('error', `Execution failed: ${toolName}`);

        // Check if all tools are done (even with errors)
        const { pendingToolCalls: remaining, sendAllToolResults } = get();
        if (remaining === 0) {
          await sendAllToolResults();
        }
      }
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
        currentMessages
      } = get();

      if (!currentSessionId || pendingToolResults.length === 0) {
        // Clear pending state
        set({ pendingToolResults: [], pendingToolCalls: 0 });
        return;
      }

      try {
        setStreaming(true);
        set({ streamingContent: '' });

        // Add all tool results as user messages (Claude SDK bridge will convert to 'tool' role)
        for (const { toolCallId, result } of pendingToolResults) {
          const resultMessage = createMessage('user', `__TOOL_RESULT__:${toolCallId}:${result}`);
          (resultMessage as any).tool_call_id = toolCallId;
          await addMessage(resultMessage);
        }

        const apiConfig = useSettingsStore.getState().getActiveConfig();

        // Prepare all messages for next turn - include tool_calls when present
        const messages = currentMessages().map((msg) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
          ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
        }));

        if (messages.length === 0) {
          setError('Message history is empty. Cannot continue conversation.');
          setStreaming(false);
          set({ pendingToolResults: [], pendingToolCalls: 0 });
          return;
        }

        // Create placeholder for AI's next thought
        const assistantMessage = createMessage('assistant', '');
        await addMessage(assistantMessage);

        await invoke<{
          content: string;
          artifacts: any[];
        }>('send_claude_sdk_chat_streaming', {
          messages,
          apiKey: apiConfig?.apiKey,
          model: apiConfig?.model,
          baseUrl: apiConfig?.baseUrl || '',
          systemPrompt: useUIStore.getState().agentInstructions,
        });

        // Clear pending results after sending
        set({ pendingToolResults: [] });

        // Event listener 'claude-token' will handle UI updates
      } catch (error) {
        console.error('Failed to send tool results:', error);
        setError('Failed to send tool results back to AI');
        setStreaming(false);
        set({ pendingToolResults: [], pendingToolCalls: 0 });
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
        const resultMessage = createMessage('user', `__TOOL_RESULT__:${toolCallId}:${result}`);
        // Include the tool_call_id for reference
        (resultMessage as any).tool_call_id = toolCallId;
        await addMessage(resultMessage);

        const apiConfig = useSettingsStore.getState().getActiveConfig();

        // Prepare all messages for next turn - include tool_calls when present
        const messages = currentMessages().map((msg) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
          ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
        }));

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
     * Send message - call API (with streaming)
     */
    sendMessage: async (content: string) => {
      const {
        currentSessionId,
        currentMessages,
        addMessage,
        setStreaming,
        setError,
      } = get();

      if (!currentSessionId) {
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
        await addMessage(userMessage);

        // Set streaming state
        setStreaming(true);
        set({ streamingContent: '' });

        // Set timeout protection - if no response in 30 seconds, force stop
        timeoutId = setTimeout(() => {
          console.warn('⏱️ Streaming timeout after 30s, force stopping...');
          if (get().isStreaming) {
            setStreaming(false);
            set({ streamingContent: '', streamingReasoning: '' });
            setError('Response timeout (30s exceeded). Please try again.');
            // Try to stop the subprocess
            invoke('stop_subprocess').catch(console.error);
          }
        }, STREAMING_TIMEOUT_MS);

        // Convert frontend messages to Rust format
        const messages = currentMessages().map((msg) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
          ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
        }));

        if (messages.length === 0) {
          setError('Message content is empty. Cannot send.');
          setStreaming(false);
          return;
        }

        // Create placeholder assistant message for streaming updates
        const assistantMessage = createMessage('assistant', '');
        await addMessage(assistantMessage);

        // Use streaming command
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
        }>('send_claude_sdk_chat_streaming', {
          messages,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          baseUrl: apiConfig.baseUrl || '',
          systemPrompt: useUIStore.getState().agentInstructions,
        });

        // The streaming content has been accumulated in streamingContent via the event listener
        const { streamingContent: finalContent, streamingReasoning } = get();
        const { updateLastMessage } = get();

        const fullContent = finalContent || response.content;

        await updateLastMessage(
          fullContent,
          response.artifacts?.map((a) => ({
            id: crypto.randomUUID(),
            type: a.type as 'html' | 'svg' | 'mermaid' | 'react' | 'code',
            content: a.content,
            title: a.title,
            language: a.language,
          })),
          streamingReasoning
        );

        // Clear timeout on success
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '' });
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
        set({ streamingContent: '', streamingReasoning: '' });
      }
    },

    /**
     * Stop/cancel the current generation (kill subprocess)
     */
    stopGeneration: async () => {
      const { isStreaming, streamingContent, streamingReasoning, setStreaming } = get();
      if (!isStreaming) return;

      try {
        // Call the Rust backend to kill the subprocess
        await invoke('stop_subprocess');

        // If there's accumulated streaming content, finalize the message
        if (streamingContent || streamingReasoning) {
          const { updateLastMessage } = get();
          // Mark the current message as complete with whatever we have so far
          await updateLastMessage(streamingContent, undefined, streamingReasoning);
        }

        // Clear streaming state
        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '' });
      } catch (error) {
        console.error('Failed to stop generation:', error);
        // Still clear the streaming state even if kill fails
        setStreaming(false);
        set({ streamingContent: '', streamingReasoning: '' });
      }
    },

    /**
     * Retry the last failed message
     */
    retryLastMessage: async () => {
      const { currentSessionId, currentMessages, error } = get();
      if (!currentSessionId || !error) return;

      // Get the last user message
      const messages = currentMessages();
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

      if (lastUserMessage) {
        // Clear error
        set({ error: null });
        // Resend the message
        await get().sendMessage(lastUserMessage.content);
      }
    },

    /**
     * Add message to current session and persist to database
     */
    addMessage: async (message: Message) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      // Persist to database
      try {
        await invoke('db_save_message', { message: messageToDb(message, currentSessionId) });
      } catch (error) {
        console.error('Failed to save message to database:', error);
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
    updateLastMessage: async (content: string, artifacts?: Message['artifacts'], reasoning?: string) => {
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
            reasoning: reasoning !== undefined ? reasoning : lastMessage.reasoning,
            artifacts: artifacts !== undefined ? artifacts : lastMessage.artifacts,
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
              reasoning: parsedReasoning || streamingReasoning || lastMessage.reasoning,
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
                reasoning: finalReasoning || streamingReasoning || lastMessage.reasoning,
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
        set({
          currentSessionId: sessionId,
          error: null, // ✅ 清理错误
          isStreaming: false, // ✅ 清理流式状态
          streamingContent: '', // ✅ 清理内容
        });
      }
    },

    /**
     * Delete a session and remove from database
     */
    deleteSession: async (sessionId: string) => {
      // Delete from database
      try {
        await invoke('db_delete_session', { session_id: sessionId });
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
     * Update session's working directory and persist to database
     */
    updateSessionCwd: async (sessionId: string, cwd: string) => {
      // Get the current session to update in database
      const session = get().sessions.find((s) => s.id === sessionId);
      if (session) {
        const updatedSession = { ...session, cwd, updatedAt: Date.now() };
        try {
          await invoke('db_save_session', { session: sessionToDb(updatedSession) });
        } catch (error) {
          console.error('Failed to update session cwd in database:', error);
        }
      }

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, cwd, updatedAt: Date.now() } : s
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
        await invoke('db_delete_project', { project_id: projectId });
      } catch (error) {
        console.error('Failed to delete project from database:', error);
      }

      // Delete all sessions in this project from database
      const sessionsInProject = get().sessions.filter((s) => s.projectId === projectId);
      for (const session of sessionsInProject) {
        try {
          await invoke('db_delete_session', { session_id: session.id });
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
  }))
);

export type { Session, Message, Project } from '../types/chat';
