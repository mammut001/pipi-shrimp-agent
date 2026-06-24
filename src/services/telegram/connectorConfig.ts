import {
  DEFAULT_TELEGRAM_CONFIG,
  type TelegramConfig,
} from '@/types/telegram';

const TELEGRAM_CONNECTOR_CONFIG_STORAGE_KEY = 'pipi-shrimp-telegram-connector-config';

function readStoredConfig(): Partial<TelegramConfig> | null {
  try {
    const stored = localStorage.getItem(TELEGRAM_CONNECTOR_CONFIG_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<TelegramConfig>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn('Failed to load Telegram connector config:', error);
    return null;
  }
}

export function getTelegramConnectorConfig(): TelegramConfig {
  const stored = readStoredConfig();
  if (!stored) {
    return { ...DEFAULT_TELEGRAM_CONFIG };
  }

  return {
    ...DEFAULT_TELEGRAM_CONFIG,
    ...stored,
    allowedChats: normalizeAllowedChats(stored.allowedChats),
  };
}

function normalizeAllowedChats(
  allowedChats: TelegramConfig['allowedChats'] | undefined,
): TelegramConfig['allowedChats'] {
  if (allowedChats === '*') {
    return '*';
  }

  if (Array.isArray(allowedChats)) {
    return allowedChats.filter((chatId) => Number.isFinite(chatId));
  }

  return DEFAULT_TELEGRAM_CONFIG.allowedChats;
}

export function setTelegramConnectorAllowedChats(allowedChats: TelegramConfig['allowedChats']): void {
  const config = getTelegramConnectorConfig();
  const nextConfig: TelegramConfig = {
    ...config,
    allowedChats: normalizeAllowedChats(allowedChats),
  };

  try {
    localStorage.setItem(TELEGRAM_CONNECTOR_CONFIG_STORAGE_KEY, JSON.stringify(nextConfig));
  } catch (error) {
    console.warn('Failed to save Telegram connector config:', error);
  }
}

export function persistTelegramAllowedChatIds(chatIds: number[]): void {
  setTelegramConnectorAllowedChats(chatIds);
}