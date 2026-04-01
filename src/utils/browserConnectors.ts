/**
 * Browser Connectors - Runtime connector abstraction
 *
 * Provides a unified interface for different browser/IM surfaces
 * Implements browser_web, telegram (real implementation), and reserves space for other IM connectors
 */

import type {
  RuntimeConnector,
  BrowserConnectorType,
  BrowserTaskEnvelope,
  BrowserInspectionResult,
} from '../types/browser';
import { matchProfileByUrl } from './browserProfiles';
import {
  inspectBrowserState,
} from './browserCommands';
import { useSettingsStore } from '../store/settingsStore';
import { useBrowserAgentStore } from '../store/browserAgentStore';
import {
  useTelegramStore,
  useTelegramConnected,
  useTelegramBotInfo,
  useTelegramMessages,
  useTelegramChats,
} from '../store/telegramStore';
import type {
  TelegramMessage,
} from '../types/telegram';
import {
  formatChatName,
  formatMessageDate,
} from '../types/telegram';

// ============= Telegram-Specific Inspection Result =============

/**
 * Telegram-specific authentication states
 */
export type TelegramAuthState = 'authenticated' | 'not_configured' | 'error';

/**
 * Telegram-specific inspection result
 */
export interface TelegramInspectionResult {
  connected: boolean;
  botInfo?: {
    username: string;
    firstName: string;
  };
  recentMessages: TelegramMessage[];
  activeChats: Map<number, { type: string; name: string }>;
  authState: TelegramAuthState;
  error?: string;
}

// ============= Browser Web Connector =============

/**
 * Browser Web Connector
 * Implements the RuntimeConnector interface for standard web browsing
 */
class BrowserWebConnector implements RuntimeConnector {
  readonly id: string;
  readonly connectorType: BrowserConnectorType = 'browser_web';

  constructor(id: string = 'browser-web-default') {
    this.id = id;
  }

  /**
   * Check if this connector can handle the given target
   */
  canHandle(target: string): boolean {
    // Browser web connector handles HTTP/HTTPS URLs
    return target.startsWith('http://') || target.startsWith('https://');
  }

  /**
   * Inspect current page state
   */
  async inspect(): Promise<BrowserInspectionResult> {
    const raw = await inspectBrowserState();
    const profile = matchProfileByUrl(raw.url);

    // Import the parser dynamically to avoid circular dependencies
    const { parseInspectionResult } = await import('./browserInspection');

    return parseInspectionResult(raw, profile.id);
  }

  /**
   * Open a target URL
   */
  async open(targetUrl: string): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.openWindow(targetUrl);
  }

  /**
   * Request user to authenticate manually
   */
  async requestUserAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.requestLogin();
  }

  /**
   * Resume after authentication
   */
  async resumeAfterAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.confirmLoginAndResume();
  }

  /**
   * Execute a task
   */
  async execute(task: BrowserTaskEnvelope): Promise<void> {
    const store = useBrowserAgentStore.getState();

    // Get API config
    const config = useSettingsStore.getState().getActiveConfig();
    if (!config?.apiKey) {
      throw new Error('API not configured');
    }

    // Execute via store
    await store.executeTask(task.executionPrompt);
  }

  /**
   * Stop current execution
   */
  async stop(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.stopTask();
  }
}

// ============= WhatsApp Connector (Placeholder) =============

/**
 * WhatsApp Web Connector (reserved for future implementation)
 *
 * Note: This is a placeholder for future IM connector support.
 * The current implementation uses the same browser approach as BrowserWebConnector.
 */
class WhatsAppConnector implements RuntimeConnector {
  readonly id: string;
  readonly connectorType: BrowserConnectorType = 'im_whatsapp';

  constructor(id: string = 'whatsapp-default') {
    this.id = id;
  }

  canHandle(target: string): boolean {
    return target.includes('whatsapp');
  }

  async inspect(): Promise<BrowserInspectionResult> {
    // Same as browser web for now
    const raw = await inspectBrowserState();
    const { parseInspectionResult } = await import('./browserInspection');
    return parseInspectionResult(raw, 'whatsapp_web');
  }

  async open(targetUrl: string): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.openWindow(targetUrl);
  }

  async requestUserAuth(): Promise<void> {
    // WhatsApp uses QR code login
    const store = useBrowserAgentStore.getState();
    store.requestLogin();
  }

  async resumeAfterAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.confirmLoginAndResume();
  }

  async execute(task: BrowserTaskEnvelope): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.executeTask(task.executionPrompt);
  }

  async stop(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.stopTask();
  }
}

// ============= Telegram Connector (Real Implementation) =============

/**
 * Telegram Connector - Real implementation using Telegram Bot API
 *
 * This connector integrates with the Telegram Bot API to:
 * - Inspect connection status and recent messages
 * - Execute tasks by sending messages to chats
 * - Monitor incoming messages from users
 */
class TelegramConnectorImpl implements RuntimeConnector {
  readonly id: string;
  readonly connectorType: BrowserConnectorType = 'im_telegram';

  constructor(id: string = 'telegram-default') {
    this.id = id;
  }

  /**
   * Check if this connector can handle the given target
   * Telegram connector handles telegram:// URLs or messages to specific chats
   */
  canHandle(target: string): boolean {
    const lowerTarget = target.toLowerCase();
    return (
      lowerTarget.includes('telegram') ||
      target.startsWith('tg://') ||
      /^\d+$/.test(target) || // Chat ID
      target === 'telegram'
    );
  }

  /**
   * Inspect Telegram connection status and recent messages
   */
  async inspect(): Promise<BrowserInspectionResult> {
    const isConnected = useTelegramConnected();
    const botInfo = useTelegramBotInfo();

    return {
      url: 'telegram://bot',
      title: botInfo ? `@${botInfo.username}` : 'Telegram Bot',
      authState: isConnected ? 'authenticated' : 'unauthenticated',
      matchedProfileId: 'telegram_bot',
      matchedSignals: [
        isConnected ? 'connected' : 'disconnected',
        ...(botInfo ? [`bot:@${botInfo.username}`] : []),
      ],
      safeForAgent: isConnected,
    };
  }

  /**
   * Inspect Telegram-specific state
   * This provides more detailed Telegram information than the standard inspect
   */
  async inspectTelegram(): Promise<TelegramInspectionResult> {
    const store = useTelegramStore.getState();
    const isConnected = useTelegramConnected();
    const botInfo = useTelegramBotInfo();
    const messages = useTelegramMessages();
    const chats = useTelegramChats();

    return {
      connected: isConnected,
      botInfo: botInfo
        ? {
            username: botInfo.username,
            firstName: botInfo.firstName,
          }
        : undefined,
      recentMessages: messages.slice(-20),
      activeChats: chats,
      authState: isConnected
        ? 'authenticated'
        : store.status === 'error'
        ? 'error'
        : 'not_configured',
      error: store.error,
    };
  }

  /**
   * Open Telegram (opens web.telegram.org in browser)
   */
  async open(_targetUrl: string): Promise<void> {
    const store = useBrowserAgentStore.getState();
    // Open Telegram web interface
    await store.openWindow('https://web.telegram.org');
  }

  /**
   * Request user to configure Telegram bot token
   */
  async requestUserAuth(): Promise<void> {
    // For Telegram, "auth" means configuring the bot token
    // This will trigger a UI prompt to the user
    const store = useBrowserAgentStore.getState();
    store.requestLogin();
  }

  /**
   * Resume after configuring bot token
   */
  async resumeAfterAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.confirmLoginAndResume();
  }

  /**
   * Execute a task
   *
   * For Telegram, this means:
   * 1. Parse the task to determine target chat and message
   * 2. Send the message via the Telegram Bot API
   * 3. Wait for and return the response
   */
  async execute(task: BrowserTaskEnvelope): Promise<void> {
    const store = useTelegramStore.getState();

    // Check if connected
    if (store.status !== 'connected') {
      throw new Error('Telegram bot is not connected. Please configure your bot token.');
    }

    // Get API config
    const config = useSettingsStore.getState().getActiveConfig();
    if (!config?.apiKey) {
      throw new Error('API not configured');
    }

    // Parse the execution prompt
    // Expected format: "send <chat_id> <message>" or just "<message>" for default chat
    const { targetChatId, message } = this.parseExecutionPrompt(task.executionPrompt);

    if (!targetChatId) {
      throw new Error('No target chat specified. Please specify a chat ID.');
    }

    if (!message) {
      throw new Error('No message to send. Please provide a message.');
    }

    // Send the message
    await store.sendMessage(targetChatId, message);
  }

  /**
   * Execute a task on a specific chat
   */
  async executeOnChat(chatId: number, message: string): Promise<TelegramMessage> {
    const store = useTelegramStore.getState();

    if (store.status !== 'connected') {
      throw new Error('Telegram bot is not connected.');
    }

    return store.sendMessage(chatId, message);
  }

  /**
   * Stop current execution (not applicable for Telegram)
   */
  async stop(): Promise<void> {
    // Telegram doesn't have ongoing executions to stop
    // This is a no-op for this connector
  }

  /**
   * Connect to Telegram with a bot token
   */
  async connect(token: string): Promise<void> {
    const store = useTelegramStore.getState();
    await store.connect(token);
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect(): Promise<void> {
    const store = useTelegramStore.getState();
    await store.disconnect();
  }

  /**
   * Get connection status
   */
  getStatus(): 'connected' | 'connecting' | 'disconnected' | 'error' | 'reconnecting' {
    const store = useTelegramStore.getState();
    return store.status;
  }

  /**
   * Parse execution prompt to extract target chat and message
   */
  private parseExecutionPrompt(
    prompt: string
  ): { targetChatId: number | null; message: string } {
    // Format: "send <chat_id> <message>" or "chat:<chat_id> <message>"
    const sendMatch = prompt.match(/^send\s+(\d+)\s+(.+)$/is);
    if (sendMatch) {
      return {
        targetChatId: parseInt(sendMatch[1], 10),
        message: sendMatch[2].trim(),
      };
    }

    const chatMatch = prompt.match(/^chat:(\d+)\s+(.+)$/is);
    if (chatMatch) {
      return {
        targetChatId: parseInt(chatMatch[1], 10),
        message: chatMatch[2].trim(),
      };
    }

    // Default: no target chat, just message
    return {
      targetChatId: null,
      message: prompt.trim(),
    };
  }
}

// ============= Generic Web Connector =============

/**
 * Generic Web Connector (fallback for unknown sites)
 */
class GenericWebConnector implements RuntimeConnector {
  readonly id: string;
  readonly connectorType: BrowserConnectorType = 'generic_web';

  constructor(id: string = 'generic-default') {
    this.id = id;
  }

  canHandle(_target: string): boolean {
    // Generic connector handles everything as fallback
    return true;
  }

  async inspect(): Promise<BrowserInspectionResult> {
    const raw = await inspectBrowserState();
    const { parseInspectionResult } = await import('./browserInspection');
    return parseInspectionResult(raw, 'generic_authenticated_site');
  }

  async open(targetUrl: string): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.openWindow(targetUrl);
  }

  async requestUserAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.requestLogin();
  }

  async resumeAfterAuth(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.confirmLoginAndResume();
  }

  async execute(task: BrowserTaskEnvelope): Promise<void> {
    const store = useBrowserAgentStore.getState();
    await store.executeTask(task.executionPrompt);
  }

  async stop(): Promise<void> {
    const store = useBrowserAgentStore.getState();
    store.stopTask();
  }
}

// ============= Connector Factory =============

/**
 * Get a connector instance based on connector type
 */
export function getConnector(type: BrowserConnectorType): RuntimeConnector {
  switch (type) {
    case 'browser_web':
      return new BrowserWebConnector();
    case 'im_whatsapp':
      return new WhatsAppConnector();
    case 'im_telegram':
      return new TelegramConnectorImpl();
    case 'im_slack':
      // Slack uses web interface, similar to browser_web
      return new BrowserWebConnector('slack-connector');
    case 'generic_web':
    default:
      return new GenericWebConnector();
  }
}

/**
 * Auto-detect connector type from URL
 */
export function detectConnectorType(url: string): BrowserConnectorType {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('whatsapp')) {
    return 'im_whatsapp';
  }
  if (lowerUrl.includes('telegram') || lowerUrl.startsWith('tg://')) {
    return 'im_telegram';
  }
  if (lowerUrl.includes('slack')) {
    return 'im_slack';
  }

  return 'browser_web';
}

/**
 * Get all available connector types
 */
export function getAvailableConnectors(): BrowserConnectorType[] {
  return ['browser_web', 'im_whatsapp', 'im_telegram', 'im_slack', 'generic_web'];
}

// ============= Telegram Helper Functions =============

/**
 * Get Telegram connector instance
 */
export function getTelegramConnector(): TelegramConnectorImpl {
  return new TelegramConnectorImpl();
}

/**
 * Check if Telegram is connected
 */
export function isTelegramConnected(): boolean {
  return useTelegramConnected();
}

/**
 * Get Telegram bot info
 */
export function getTelegramBotInfo() {
  return useTelegramBotInfo();
}

/**
 * Get recent Telegram messages
 */
export function getRecentTelegramMessages(count: number = 10): TelegramMessage[] {
  return useTelegramMessages().slice(-count);
}

/**
 * Get unique Telegram chats
 */
export function getTelegramChatList(): Array<{
  id: number;
  type: string;
  name: string;
  lastMessage?: TelegramMessage;
}> {
  const chats = useTelegramChats();
  return Array.from(chats.entries()).map(([id, chat]) => ({
    id,
    ...chat,
  }));
}

/**
 * Send a message to a Telegram chat
 */
export async function sendTelegramMessage(
  chatId: number,
  text: string
): Promise<TelegramMessage> {
  const store = useTelegramStore.getState();
  return store.sendMessage(chatId, text);
}

/**
 * Format a Telegram message for display
 */
export function formatTelegramMessageForDisplay(message: TelegramMessage): string {
  const sender = message.from
    ? message.from.firstName + (message.from.lastName ? ` ${message.from.lastName}` : '')
    : 'Unknown';
  const chat = formatChatName(message.chat);
  const time = formatMessageDate(message.date);

  const content = message.text || message.caption || '[Media]';

  return `[${time}] ${chat} / ${sender}: ${content}`;
}

// Export connector classes for extensibility
export {
  BrowserWebConnector,
  WhatsAppConnector,
  TelegramConnectorImpl as TelegramConnector,
  GenericWebConnector,
};
