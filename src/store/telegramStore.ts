/**
 * Telegram Store - Zustand state management for Telegram connection
 *
 * Manages:
 * - Connection state (disconnected, connecting, connected, error)
 * - Bot information
 * - Message history
 * - Connection/disconnection actions
 */

import { create } from 'zustand';
import type {
  TelegramState,
  TelegramBotInfo,
  TelegramMessage,
  TelegramConnectionStatus,
} from '../types/telegram';
import {
  telegramConnect as connectTelegram,
  telegramDisconnect as disconnectTelegram,
  telegramSendMessage as sendTelegramMessage,
  telegramGetStatus,
  telegramGetBotInfo,
  telegramOn,
  getTelegramErrorMessage,
} from '../services/telegramService';
import { startTelegramPoller, stopTelegramPoller } from '../services/telegram/poller';
import { useSettingsStore } from './settingsStore';

// ============= Storage Keys =============

const TELEGRAM_MESSAGES_STORAGE_KEY = 'ai-agent-telegram-messages';

// ============= Load/Save Helpers =============

function loadMessages(): TelegramMessage[] {
  try {
    const stored = localStorage.getItem(TELEGRAM_MESSAGES_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load Telegram messages:', error);
  }
  return [];
}

function saveMessages(messages: TelegramMessage[]): void {
  try {
    // Only keep the last 100 messages
    const toSave = messages.slice(-100);
    localStorage.setItem(TELEGRAM_MESSAGES_STORAGE_KEY, JSON.stringify(toSave));
  } catch (error) {
    console.error('Failed to save Telegram messages:', error);
  }
}

// ============= Event Unsubscribers =============

let messageUnsubscribe: (() => void) | null = null;
let errorUnsubscribe: (() => void) | null = null;
let statusUnsubscribe: (() => void) | null = null;

// ============= Store =============

export const useTelegramStore = create<TelegramState>((set, get) => ({
  // ========== Initial State ==========

  status: 'disconnected',
  error: undefined,
  botInfo: undefined,
  token: undefined,
  messages: loadMessages(),
  lastUpdateId: 0,

  // ========== Connection Actions ==========

  /**
   * Connect to Telegram with a bot token
   */
  connect: async (token: string) => {
    const trimmedToken = token.trim();

    if (!trimmedToken) {
      set({ status: 'error', error: 'Token is required' });
      return;
    }

    // Clean up previous connection if any
    if (messageUnsubscribe) {
      messageUnsubscribe();
      messageUnsubscribe = null;
    }
    if (errorUnsubscribe) {
      errorUnsubscribe();
      errorUnsubscribe = null;
    }
    if (statusUnsubscribe) {
      statusUnsubscribe();
      statusUnsubscribe = null;
    }

    set({
      status: 'connecting',
      error: undefined,
      token: trimmedToken,
    });

    try {
      // Connect via Tauri backend
      const botInfo = await connectTelegram(trimmedToken);

      // Update store with bot info
      set({
        status: 'connected',
        botInfo,
      });

      // Save token to settings
      await useSettingsStore.getState().setTelegramToken(trimmedToken);

      // Set up event listeners
      setupEventListeners();
      await startTelegramPoller();

    } catch (error) {
      const errorMessage = getTelegramErrorMessage(error);
      set({
        status: 'error',
        error: errorMessage,
      });
      console.error('Telegram connection failed:', error);
    }
  },

  /**
   * Disconnect from Telegram
   */
  disconnect: async () => {
    await stopTelegramPoller();

    try {
      await disconnectTelegram();
    } catch (error) {
      console.warn('Error during disconnect:', error);
    }

    // Clean up event listeners
    if (messageUnsubscribe) {
      messageUnsubscribe();
      messageUnsubscribe = null;
    }
    if (errorUnsubscribe) {
      errorUnsubscribe();
      errorUnsubscribe = null;
    }
    if (statusUnsubscribe) {
      statusUnsubscribe();
      statusUnsubscribe = null;
    }

    // Clear sensitive data
    set({
      status: 'disconnected',
      error: undefined,
      botInfo: undefined,
      token: undefined,
    });

    // Don't clear messages on disconnect - keep for history
  },

  /**
   * Send a message to a chat
   */
  sendMessage: async (chatId: number, text: string) => {
    const { status } = get();

    if (status !== 'connected') {
      throw new Error('Not connected to Telegram');
    }

    if (!text.trim()) {
      throw new Error('Message text is required');
    }

    try {
      const message = await sendTelegramMessage(chatId, text);

      // Add the sent message to our history
      set((state) => {
        const messages = [...state.messages, message];
        saveMessages(messages);
        return { messages };
      });

      return message;
    } catch (error) {
      const errorMessage = getTelegramErrorMessage(error);
      throw new Error(errorMessage);
    }
  },

  // ========== Message Actions ==========

  /**
   * Clear message history
   */
  clearMessages: () => {
    set({ messages: [], lastUpdateId: 0 });
    localStorage.removeItem(TELEGRAM_MESSAGES_STORAGE_KEY);
  },

  /**
   * Add a message to the history
   */
  addMessage: (message: TelegramMessage) => {
    set((state) => {
      // Avoid duplicates
      if (state.messages.some((m) => m.messageId === message.messageId && m.chat.id === message.chat.id)) {
        return state;
      }

      const messages = [...state.messages, message];
      saveMessages(messages);
      return { messages };
    });
  },

  /**
   * Update the last processed update ID
   */
  updateLastUpdateId: (updateId: number) => {
    set({ lastUpdateId: updateId });
  },

  // ========== Internal Actions ==========

  /**
   * Set connection status
   */
  setStatus: (status: TelegramConnectionStatus, error?: string) => {
    set({ status, error });
  },
}));

// ============= Event Listeners Setup =============

function setupEventListeners(): void {
  // Listen for new messages
  messageUnsubscribe = telegramOn('message', (event) => {
    if (event.data && typeof event.data === 'object') {
      const message = event.data as TelegramMessage;

      // Update last update ID
      const store = useTelegramStore.getState();
      if (message.messageId > store.lastUpdateId) {
        store.updateLastUpdateId(message.messageId);
      }

      // Add message to history
      store.addMessage(message);
    }
  });

  // Listen for errors
  errorUnsubscribe = telegramOn('error', (event) => {
    const errorMessage = typeof event.data === 'string' ? event.data : 'Unknown error';
    useTelegramStore.setState({
      status: 'error',
      error: errorMessage,
    });
  });

  // Listen for status changes
  statusUnsubscribe = telegramOn('status', (event) => {
    if (event.data && typeof event.data === 'string') {
      const status = event.data as 'disconnected' | 'connecting' | 'connected' | 'error';
      useTelegramStore.setState({ status });
    }
  });
}

// ============= Store Initialization =============

/**
 * Initialize the Telegram store on app start
 * Checks for saved token and attempts to restore connection
 */
export async function initializeTelegramStore(): Promise<void> {
  const settingsStore = useSettingsStore.getState();
  const savedToken = settingsStore.telegramToken;

  if (savedToken) {
    // Auto-connect with saved token
    const store = useTelegramStore.getState();
    await store.connect(savedToken);
  } else {
    // Check connection status anyway
    try {
      const status = await telegramGetStatus();
      const botInfo = await telegramGetBotInfo();

      if (status === 'connected' && botInfo) {
        useTelegramStore.setState({ status, botInfo });
        await startTelegramPoller();
      } else {
        useTelegramStore.setState({ status });
      }
    } catch (error) {
      console.warn('Failed to check Telegram status:', error);
      useTelegramStore.setState({ status: 'disconnected' });
    }
  }
}

// ============= Selectors =============

/**
 * Get the Telegram store state
 */
export function useTelegramState(): Pick<
  TelegramState,
  'status' | 'error' | 'botInfo' | 'token' | 'messages' | 'lastUpdateId'
> {
  return useTelegramStore((state) => ({
    status: state.status,
    error: state.error,
    botInfo: state.botInfo,
    token: state.token,
    messages: state.messages,
    lastUpdateId: state.lastUpdateId,
  }));
}

/**
 * Get messages from a specific chat
 */
export function useTelegramMessages(chatId?: number): TelegramMessage[] {
  return useTelegramStore((state) => {
    if (chatId === undefined) {
      return state.messages;
    }
    return state.messages.filter((m) => m.chat.id === chatId);
  });
}

/**
 * Check if connected
 */
export function useTelegramConnected(): boolean {
  return useTelegramStore((state) => state.status === 'connected');
}

/**
 * Check if connecting
 */
export function useTelegramConnecting(): boolean {
  return useTelegramStore((state) => state.status === 'connecting');
}

/**
 * Get bot info
 */
export function useTelegramBotInfo(): TelegramBotInfo | undefined {
  return useTelegramStore((state) => state.botInfo);
}

/**
 * Get connection error
 */
export function useTelegramError(): string | undefined {
  return useTelegramStore((state) => state.error);
}

/**
 * Get recent messages (last N messages)
 */
export function useRecentTelegramMessages(count: number = 10): TelegramMessage[] {
  return useTelegramStore((state) => state.messages.slice(-count));
}

/**
 * Get unique chats from message history
 */
export function useTelegramChats(): Map<number, { type: string; name: string; lastMessage?: TelegramMessage }> {
  return useTelegramStore((state) => {
    const chatMap = new Map<number, { type: string; name: string; lastMessage?: TelegramMessage }>();

    for (const message of state.messages) {
      const chat = message.chat;
      if (!chatMap.has(chat.id)) {
        const name = chat.type === 'private'
          ? chat.firstName ?? chat.username ?? 'Unknown'
          : chat.title ?? chat.username ?? 'Unknown Chat';

        chatMap.set(chat.id, {
          type: chat.type,
          name,
          lastMessage: message,
        });
      } else {
        // Update last message if this one is newer
        const existing = chatMap.get(chat.id)!;
        if (!existing.lastMessage || message.date > existing.lastMessage.date) {
          existing.lastMessage = message;
        }
      }
    }

    return chatMap;
  });
}

// ============= Actions for External Use =============

/**
 * Quick send message function
 */
export async function sendTelegramChatMessage(
  chatId: number,
  text: string
): Promise<TelegramMessage> {
  return useTelegramStore.getState().sendMessage(chatId, text);
}

/**
 * Quick connect function
 */
export async function connectTelegramBot(token: string): Promise<void> {
  return useTelegramStore.getState().connect(token);
}

/**
 * Quick disconnect function
 */
export async function disconnectTelegramBot(): Promise<void> {
  return useTelegramStore.getState().disconnect();
}
