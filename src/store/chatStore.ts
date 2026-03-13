/**
 * Chat store - Zustand state management for chat/sessions
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import type { ChatState, Session, Message } from '../types/chat';
import { createSession, createMessage } from '../types/chat';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';

/**
 * Database types matching Rust backend
 */
interface DbSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  cwd: string | null;
}

interface DbMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  artifacts: string | null;
  created_at: number;
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
  messages: dbMessages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
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
});

/**
 * Convert frontend message to database message
 */
const messageToDb = (message: Message, sessionId: string): DbMessage => ({
  id: message.id,
  session_id: sessionId,
  role: message.role,
  content: message.content,
  artifacts: message.artifacts ? JSON.stringify(message.artifacts) : null,
  created_at: message.timestamp,
});

/**
 * Chat store using Zustand
 */
export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => ({
    // ========== Initial State ==========
    sessions: [],
    currentSessionId: null,
    isStreaming: false,
    isInitialized: false,
    streamingContent: '',
    error: null,

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

    // ========== Action Methods ==========

    /**
     * Initialize store - load sessions from SQLite database
     */
    init: async () => {
      if (get().isInitialized) return;
      set({ isInitialized: true });

      try {
        // Load sessions from database
        const dbSessions = await invoke<DbSession[]>('db_get_all_sessions');

        // Load messages for each session
        const sessions: Session[] = await Promise.all(
          dbSessions.map(async (dbSession) => {
            const dbMessages = await invoke<DbMessage[]>('db_get_messages', {
              sessionId: dbSession.id,
            });
            return dbToSession(dbSession, dbMessages);
          })
        );

        set({ sessions });

        // Set up streaming event listener
        const { appendStreamingContent } = get();

        // Listen for streaming tokens from Rust backend
        const unlistenToken = await listen<string>('claude-token', (event) => {
          appendStreamingContent(event.payload);
        });

        // Listen for tool_use events from Rust backend
        const unlistenToolUse = await listen<{
          tool_call_id: string;
          name: string;
          arguments: string;
        }>('claude-tool-use', async (event) => {
          console.log('Tool use requested:', event.payload);
          
          const { permissionMode, setPermissionRequest, addTaskStep } = useUIStore.getState();
          const { executeTool } = get();

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
        (window as unknown as { __claudeToolUseUnlisten: () => void }).__claudeToolUseUnlisten = unlistenToolUse;
      } catch (error) {
        console.error('Failed to load sessions:', error);
        // Fallback to localStorage if database fails
        try {
          const stored = localStorage.getItem('ai-agent-sessions');
          if (stored) {
            const sessions: Session[] = JSON.parse(stored);
            set({ sessions });
          }
        } catch (e) {
          console.error('Failed to load from localStorage:', e);
        }
        set({ error: 'Failed to load sessions' });
      }
    },

    /**
     * Create a new session
     */
    startSession: async () => {
      const newSession = createSession();

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
     */
    executeTool: async (toolName: string, toolInput: string, toolCallId: string) => {
      const { sendToolResult, setError } = get();
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
          toolName,
          arguments: toolInput,
        });

        console.log(`Tool ${toolName} executed successfully:`, result);
        
        if (currentStep) {
          updateTaskStep(currentStep.id, 'done');
        }

        // Feed back the result to the AI to continue the conversation
        await sendToolResult(toolCallId, result);
        
      } catch (error) {
        console.error(`Tool ${toolName} execution failed:`, error);
        
        if (currentStep) {
          updateTaskStep(currentStep.id, 'failed');
        }

        setError(`Tool ${toolName} failed: ${error instanceof Error ? error.message : String(error)}`);
        useUIStore.getState().addNotification('error', `Execution failed: ${toolName}`);
        set({ isStreaming: false });
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

        // Add tool result as a "user" message for now (Claude SDK bridge will convert)
        // Note: In a real SDK, this would be a 'tool' role message
        const resultMessage = createMessage('user', `__TOOL_RESULT__:${toolCallId}:${result}`);
        // We don't necessarily want to show this in UI, or we show it as a special block
        // For simplicity in this v1, we'll adding it to the message log
        await addMessage(resultMessage);

        const apiConfig = useSettingsStore.getState().getActiveConfig();
        
        // Prepare all messages for next turn
        const messages = currentMessages().map((msg) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
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
          systemPrompt: null,
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

      try {
        // Add user message
        const userMessage = createMessage('user', content);
        await addMessage(userMessage);

        // Set streaming state
        setStreaming(true);
        set({ streamingContent: '' });

        // Convert frontend messages to Rust format
        const messages = currentMessages().map((msg) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
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
          systemPrompt: null,
        });

        // The streaming content has been accumulated in streamingContent via the event listener
        const { streamingContent: finalContent } = get();
        const { updateLastMessage } = get();

        const fullContent = finalContent || response.content;

        updateLastMessage(
          fullContent,
          response.artifacts?.map((a) => ({
            id: crypto.randomUUID(),
            type: a.type as 'html' | 'svg' | 'mermaid' | 'react' | 'code',
            content: a.content,
            title: a.title,
            language: a.language,
          }))
        );

        setStreaming(false);
        set({ streamingContent: '' });
      } catch (error) {
        console.error('Failed to send message:', error);
        const errorMsg = typeof error === 'string' ? error : (error instanceof Error ? error.message : 'Failed to send message');
        setError(errorMsg);
        setStreaming(false);
      }
    },

    /**
     * Stop/cancel the current generation (kill subprocess)
     */
    stopGeneration: async () => {
      const { isStreaming, streamingContent, setStreaming } = get();
      if (!isStreaming) return;

      try {
        // Call the Rust backend to kill the subprocess
        await invoke('stop_subprocess');

        // If there's accumulated streaming content, finalize the message
        if (streamingContent) {
          const { updateLastMessage } = get();
          // Mark the current message as complete with whatever we have so far
          updateLastMessage(streamingContent);
        }

        // Clear streaming state
        setStreaming(false);
        set({ streamingContent: '' });
      } catch (error) {
        console.error('Failed to stop generation:', error);
        // Still clear the streaming state even if kill fails
        setStreaming(false);
        set({ streamingContent: '' });
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
     * Update last message content (for streaming updates)
     */
    updateLastMessage: (content: string, artifacts?: Message['artifacts']) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== currentSessionId || s.messages.length === 0) return s;
          const messages = [...s.messages];
          const lastMessage = messages[messages.length - 1];
          messages[messages.length - 1] = {
            ...lastMessage,
            content,
            ...(artifacts && { artifacts }),
          };
          return { ...s, messages, updatedAt: Date.now() };
        }),
      }));
    },

    /**
     * Append streaming content to buffer and update last message in real-time
     */
    appendStreamingContent: (content: string) => {
      const { currentSessionId, streamingContent } = get();
      const newContent = streamingContent + content;

      // Update streaming content buffer
      set({ streamingContent: newContent });

      // Also update the last message in real-time for immediate UI feedback
      if (currentSessionId) {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== currentSessionId || s.messages.length === 0) return s;
            const messages = [...s.messages];
            const lastMessage = messages[messages.length - 1];
            messages[messages.length - 1] = { ...lastMessage, content: newContent };
            return { ...s, messages, updatedAt: Date.now() };
          }),
        }));
      }
    },

    /**
     * Set streaming status
     */
    setStreaming: (streaming: boolean) => {
      set({ isStreaming: streaming });
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
        set({ currentSessionId: sessionId });
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
  }))
);

export type { Session, Message } from '../types/chat';
