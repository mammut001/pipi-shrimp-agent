/**
 * Telegram Service - Wraps Tauri commands for Telegram operations
 *
 * This service provides a clean API for the frontend to interact with
 * the Telegram Bot API through the Tauri backend.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  TelegramBotInfo,
  TelegramMessage,
  TelegramUpdate,
  TelegramConnectionStatus,
  TelegramSendMessageParams,
} from '../types/telegram';

// ============= Error Types =============

export class TelegramError extends Error {
  constructor(
    message: string,
    public code?: number,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

// ============= Service API =============

/**
 * Connect to Telegram with a bot token
 * Validates the token by calling getMe and starts long-polling
 */
export async function telegramConnect(token: string): Promise<TelegramBotInfo> {
  try {
    const result = await invoke<TelegramBotInfo>('telegram_connect', { token });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to connect to Telegram', undefined, error);
  }
}

/**
 * Disconnect from Telegram
 * Stops long-polling and clears the connection
 */
export async function telegramDisconnect(): Promise<void> {
  try {
    await invoke('telegram_disconnect');
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to disconnect from Telegram', undefined, error);
  }
}

/**
 * Send a text message to a chat
 */
export async function telegramSendMessage(
  chatId: number,
  text: string,
  options?: Partial<TelegramSendMessageParams>
): Promise<TelegramMessage> {
  try {
    const result = await invoke<TelegramMessage>('telegram_send_message', {
      chatId,
      text,
      replyToMessageId: options?.replyToMessageId,
      parseMode: options?.parseMode,
      disableWebPagePreview: options?.disableWebPagePreview,
      disableNotification: options?.disableNotification,
    });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to send message', undefined, error);
  }
}

/**
 * Get current connection status
 */
export async function telegramGetStatus(): Promise<TelegramConnectionStatus> {
  try {
    const result = await invoke<TelegramConnectionStatus>('telegram_get_status');
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to get status', undefined, error);
  }
}

/**
 * Get bot information
 */
export async function telegramGetBotInfo(): Promise<TelegramBotInfo | null> {
  try {
    const result = await invoke<TelegramBotInfo | null>('telegram_get_bot_info');
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to get bot info', undefined, error);
  }
}

/**
 * Validate a bot token without connecting
 * Useful for checking if token is valid before saving
 */
export async function telegramValidateToken(token: string): Promise<TelegramBotInfo> {
  try {
    const result = await invoke<TelegramBotInfo>('telegram_validate_token', { token });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Invalid token', undefined, error);
  }
}

/**
 * Get pending messages count (messages awaiting response)
 */
export async function telegramGetPendingCount(): Promise<number> {
  try {
    const result = await invoke<number>('telegram_get_pending_count');
    return result;
  } catch (error) {
    return 0;
  }
}

/**
 * Set the command prefix for the bot
 */
export async function telegramSetCommandPrefix(prefix: string): Promise<void> {
  try {
    await invoke('telegram_set_command_prefix', { prefix });
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to set command prefix', undefined, error);
  }
}

/**
 * Set allowed chats (for whitelist mode)
 */
export async function telegramSetAllowedChats(chatIds: number[]): Promise<void> {
  try {
    await invoke('telegram_set_allowed_chats', { chatIds });
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to set allowed chats', undefined, error);
  }
}

/**
 * Download file from Telegram
 */
export async function telegramDownloadFile(
  fileId: string,
  destination: string
): Promise<string> {
  try {
    const result = await invoke<string>('telegram_download_file', {
      fileId,
      destination,
    });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to download file', undefined, error);
  }
}

/**
 * Get file download URL
 */
export async function telegramGetFileUrl(fileId: string): Promise<string> {
  try {
    const result = await invoke<string>('telegram_get_file_url', { fileId });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to get file URL', undefined, error);
  }
}

/**
 * Send typing indicator to a chat
 */
export async function telegramSendTyping(chatId: number): Promise<void> {
  try {
    await invoke('telegram_send_typing', { chatId });
  } catch (error) {
    // Silently fail for typing indicator
    console.warn('Failed to send typing indicator:', error);
  }
}

/**
 * Send a chat action (typing, uploading, etc.)
 */
export async function telegramSendChatAction(
  chatId: number,
  action: 'typing' | 'upload_photo' | 'record_video' | 'upload_video' |
          'record_voice' | 'upload_voice' | 'upload_document' | 'find_location' |
          'record_video_note' | 'upload_video_note'
): Promise<void> {
  try {
    await invoke('telegram_send_chat_action', { chatId, action });
  } catch (error) {
    console.warn('Failed to send chat action:', error);
  }
}

/**
 * Answer to a callback query
 */
export async function telegramAnswerCallbackQuery(
  callbackQueryId: string,
  options?: {
    text?: string;
    url?: string;
    showAlert?: boolean;
    cacheTime?: number;
  }
): Promise<void> {
  try {
    await invoke('telegram_answer_callback_query', {
      callbackQueryId,
      text: options?.text,
      url: options?.url,
      showAlert: options?.showAlert,
      cacheTime: options?.cacheTime,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to answer callback query', undefined, error);
  }
}

/**
 * Get updates (for debugging)
 */
export async function telegramGetUpdates(offset?: number, limit?: number): Promise<TelegramUpdate[]> {
  try {
    const result = await invoke<TelegramUpdate[]>('telegram_get_updates', {
      offset,
      limit,
    });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to get updates', undefined, error);
  }
}

/**
 * Set webhook URL
 * Note: Webhook mode is not yet implemented
 */
export async function telegramSetWebhook(url: string, secretToken?: string): Promise<void> {
  try {
    await invoke('telegram_set_webhook', { url, secretToken });
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to set webhook', undefined, error);
  }
}

/**
 * Delete webhook
 */
export async function telegramDeleteWebhook(): Promise<void> {
  try {
    await invoke('telegram_delete_webhook');
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to delete webhook', undefined, error);
  }
}

/**
 * Get webhook info
 */
export interface TelegramWebhookInfo {
  url?: string;
  hasCustomCertificate: boolean;
  pendingUpdateCount: number;
  ipAddress?: string;
  lastErrorDate?: number;
  lastErrorMessage?: string;
  lastSynchronizeErrorDate?: number;
  maxConnections?: number;
  allowedUpdates?: string[];
}

export async function telegramGetWebhookInfo(): Promise<TelegramWebhookInfo> {
  try {
    const result = await invoke<TelegramWebhookInfo>('telegram_get_webhook_info');
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new TelegramError(error.message, undefined, error);
    }
    throw new TelegramError('Failed to get webhook info', undefined, error);
  }
}

// ============= Event Listeners =============

type TelegramEventHandler = (event: {
  type: string;
  data?: unknown;
}) => void;

const eventListeners: Map<string, Set<TelegramEventHandler>> = new Map();

/**
 * Listen to Telegram events from the backend
 */
export function telegramOn(
  event: 'message' | 'error' | 'status' | 'callback_query',
  handler: TelegramEventHandler
): () => void {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(handler);

  // Return unsubscribe function
  return () => {
    eventListeners.get(event)?.delete(handler);
  };
}

/**
 * Emit a Telegram event (for internal use)
 */
export function telegramEmit(event: string, data?: unknown): void {
  const handlers = eventListeners.get(event);
  if (handlers) {
    handlers.forEach((handler) => {
      try {
        handler({ type: event, data });
      } catch (error) {
        console.error('Error in Telegram event handler:', error);
      }
    });
  }
}

// ============= Utility Functions =============

/**
 * Parse Telegram error response
 */
export function parseTelegramError(error: unknown): { code: number; message: string } {
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err.description === 'string') {
      const code = typeof err.code === 'number' ? err.code : 0;
      return { code, message: err.description as string };
    }
  }
  return { code: 0, message: 'Unknown error' };
}

/**
 * Check if error is a Telegram API error
 */
export function isTelegramApiError(error: unknown): boolean {
  return error instanceof TelegramError || (error instanceof Error && error.name === 'TelegramError');
}

/**
 * Get human-readable error message for common Telegram errors
 */
export function getTelegramErrorMessage(error: unknown): string {
  if (error instanceof TelegramError) {
    const { code, message } = parseTelegramError(error.originalError);

    switch (code) {
      case 401:
        return 'Invalid bot token. Please check your token and try again.';
      case 400:
        if (message.includes('chat not found')) {
          return 'Chat not found. Make sure the bot has been started by the user.';
        }
        if (message.includes('bot was blocked by the user')) {
          return 'Bot was blocked by the user.';
        }
        return `Bad request: ${message}`;
      case 403:
        return 'Access denied. The bot cannot send messages to this user.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
        return 'Telegram server error. Please try again later.';
      default:
        return message || error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown error occurred';
}
