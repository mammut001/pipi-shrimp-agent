/**
 * Chat store - Zustand state management for chat/sessions
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/tauri';
import type { ChatState, Session, Message } from '../types/chat';
import { createSession, createMessage } from '../types/chat';
import { useSettingsStore } from './settingsStore';

/**
 * Storage key for persisting sessions
 */
const SESSIONS_STORAGE_KEY = 'ai-agent-sessions';

/**
 * Chat store using Zustand
 */
export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => ({
    // ========== Initial State ==========
    sessions: [],
    currentSessionId: null,
    isStreaming: false,
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
     * Initialize store - load sessions from local storage
     */
    init: async () => {
      try {
        const stored = localStorage.getItem(SESSIONS_STORAGE_KEY);
        if (stored) {
          const sessions: Session[] = JSON.parse(stored);
          set({ sessions });
        }
      } catch (error) {
        console.error('Failed to load sessions:', error);
        set({ error: 'Failed to load sessions' });
      }
    },

    /**
     * Create a new session
     */
    startSession: async () => {
      const newSession = createSession();
      set((state) => ({
        sessions: [...state.sessions, newSession],
        currentSessionId: newSession.id,
      }));
    },

    /**
     * Send message - call API
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

      // Get active API config from settings store
      const apiConfig = useSettingsStore.getState().getActiveConfig();
      if (!apiConfig?.apiKey) {
        setError('API key not configured. Please set up your API key in Settings.');
        return;
      }

      try {
        // Add user message
        const userMessage = createMessage('user', content);
        addMessage(userMessage);

        // Set streaming state
        setStreaming(true);
        set({ streamingContent: '' });

        // Convert frontend messages to Rust format
        const messages = currentMessages().map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        // Add the new user message
        messages.push({ role: 'user', content });

        // Call Tauri command to send to Claude SDK
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
        }>('send_claude_sdk_chat', {
          messages,
          apiKey: apiConfig.apiKey,
          model: apiConfig.model,
          baseUrl: apiConfig.baseUrl || null,
          systemPrompt: null,
        });

        // Add assistant response
        const assistantMessage = createMessage(
          'assistant',
          response.content,
          response.artifacts?.map((a) => ({
            id: crypto.randomUUID(),
            type: a.type as 'html' | 'svg' | 'mermaid' | 'react' | 'code',
            content: a.content,
            title: a.title,
            language: a.language,
          }))
        );
        addMessage(assistantMessage);

        setStreaming(false);
        set({ streamingContent: '' });
      } catch (error) {
        console.error('Failed to send message:', error);
        setError(error instanceof Error ? error.message : 'Failed to send message');
        setStreaming(false);
      }
    },

    /**
     * Add message to current session
     */
    addMessage: (message: Message) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

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
    updateLastMessage: (content: string) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== currentSessionId || s.messages.length === 0) return s;
          const messages = [...s.messages];
          const lastMessage = messages[messages.length - 1];
          messages[messages.length - 1] = { ...lastMessage, content };
          return { ...s, messages, updatedAt: Date.now() };
        }),
      }));
    },

    /**
     * Append streaming content to buffer
     */
    appendStreamingContent: (content: string) => {
      set((state) => ({
        streamingContent: state.streamingContent + content,
      }));
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
     * Delete a session
     */
    deleteSession: async (sessionId: string) => {
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

      // Persist to local storage
      try {
        const { sessions } = get();
        localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
      } catch (error) {
        console.error('Failed to persist sessions:', error);
      }
    },

    /**
     * Update session's working directory
     */
    updateSessionCwd: async (sessionId: string, cwd: string) => {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, cwd, updatedAt: Date.now() } : s
        ),
      }));
    },
  }))
);

/**
 * Persist sessions to local storage whenever they change
 */
useChatStore.subscribe(
  (state) => state.sessions,
  (sessions) => {
    try {
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    } catch (error) {
      console.error('Failed to persist sessions:', error);
    }
  }
);

export type { Session, Message } from '../types/chat';
