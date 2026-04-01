/**
 * Telegram Connector Tests
 *
 * Unit tests for the Telegram implementation:
 * - Type utilities
 * - Store actions
 * - Service functions (mocked)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============= Mock Dependencies =============

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock localStorage
const mockLocalStorage = {
  data: {} as Record<string, string>,
  getItem: vi.fn((key: string) => mockLocalStorage.data[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage.data[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage.data[key];
  }),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// ============= Type Utility Tests =============

describe('Telegram Type Utilities', () => {
  // Import utility functions
  const {
    isCommandMessage,
    extractCommand,
    isChatAllowed,
    formatChatName,
    formatMessageDate,
  } = await import('../types/telegram');

  describe('isCommandMessage', () => {
    it('should return true for message with bot_command entity', () => {
      const message = {
        messageId: 1,
        chat: { id: 123, type: 'private' as const },
        date: Date.now(),
        text: '/start hello',
        entities: [
          { type: 'bot_command' as const, offset: 0, length: 6 },
        ],
      };

      expect(isCommandMessage(message)).toBe(true);
    });

    it('should return true for text starting with /', () => {
      const message = {
        messageId: 1,
        chat: { id: 123, type: 'private' as const },
        date: Date.now(),
        text: '/help',
      };

      expect(isCommandMessage(message)).toBe(true);
    });

    it('should return false for regular text message', () => {
      const message = {
        messageId: 1,
        chat: { id: 123, type: 'private' as const },
        date: Date.now(),
        text: 'Hello, how are you?',
      };

      expect(isCommandMessage(message)).toBe(false);
    });
  });

  describe('extractCommand', () => {
    it('should extract command and args from bot_command entity', () => {
      const message = {
        messageId: 1,
        chat: { id: 123, type: 'private' as const },
        date: Date.now(),
        text: '/start arg1 arg2',
        entities: [
          { type: 'bot_command' as const, offset: 0, length: 6 },
        ],
      };

      const result = extractCommand(message);
      expect(result).toEqual({
        command: '/start',
        args: 'arg1 arg2',
      });
    });

    it('should handle command without args', () => {
      const message = {
        messageId: 1,
        chat: { id: 123, type: 'private' as const },
        date: Date.now(),
        text: '/help',
        entities: [
          { type: 'bot_command' as const, offset: 0, length: 5 },
        ],
      };

      const result = extractCommand(message);
      expect(result).toEqual({
        command: '/help',
        args: '',
      });
    });

    it('should return null for non-command text', () => {
      const message = {
        messageId: 1,
        chat: { id: 123, type: 'private' as const },
        date: Date.now(),
        text: 'Hello there',
      };

      expect(extractCommand(message)).toBeNull();
    });
  });

  describe('isChatAllowed', () => {
    const config = {
      commandPrefix: '/',
      allowedChats: '*',
      groupPolicy: 'mention' as const,
      dmPolicy: 'open' as const,
      typingIndicator: true,
    };

    it('should allow all chats when allowedChats is *', () => {
      expect(isChatAllowed(123, config)).toBe(true);
      expect(isChatAllowed(456, config)).toBe(true);
    });

    it('should only allow specified chats when allowedChats is array', () => {
      const restrictedConfig = {
        ...config,
        allowedChats: [123, 789],
      };

      expect(isChatAllowed(123, restrictedConfig)).toBe(true);
      expect(isChatAllowed(456, restrictedConfig)).toBe(false);
      expect(isChatAllowed(789, restrictedConfig)).toBe(true);
    });
  });

  describe('formatChatName', () => {
    it('should format private chat name', () => {
      const chat = {
        id: 123,
        type: 'private' as const,
        firstName: 'John',
        lastName: 'Doe',
      };

      expect(formatChatName(chat)).toBe('John Doe');
    });

    it('should format group chat name', () => {
      const chat = {
        id: 123,
        type: 'group' as const,
        title: 'My Group',
      };

      expect(formatChatName(chat)).toBe('My Group');
    });

    it('should return Unknown for missing name', () => {
      const chat = {
        id: 123,
        type: 'private' as const,
      };

      expect(formatChatName(chat)).toBe('Unknown');
    });
  });

  describe('formatMessageDate', () => {
    it('should format timestamp to locale string', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const result = formatMessageDate(timestamp);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });
});

// ============= Telegram Service Tests =============

describe('TelegramService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export telegram service functions', async () => {
    const service = await import('../services/telegramService');

    expect(typeof service.telegramConnect).toBe('function');
    expect(typeof service.telegramDisconnect).toBe('function');
    expect(typeof service.telegramSendMessage).toBe('function');
    expect(typeof service.telegramGetStatus).toBe('function');
    expect(typeof service.telegramValidateToken).toBe('function');
  });
});

// ============= Telegram Store Tests =============

describe('TelegramStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.data = {};
  });

  it('should have correct initial state', async () => {
    const { useTelegramStore } = await import('../store/telegramStore');

    const state = useTelegramStore.getState();

    expect(state.status).toBe('disconnected');
    expect(state.error).toBeUndefined();
    expect(state.botInfo).toBeUndefined();
    expect(state.token).toBeUndefined();
    expect(state.messages).toEqual([]);
  });
});

// ============= Browser Connector Tests =============

describe('TelegramConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export TelegramConnector class', async () => {
    const { TelegramConnector } = await import('../utils/browserConnectors');

    expect(typeof TelegramConnector).toBe('function');
  });

  it('should export helper functions', async () => {
    const helpers = await import('../utils/browserConnectors');

    expect(typeof helpers.getTelegramConnector).toBe('function');
    expect(typeof helpers.isTelegramConnected).toBe('function');
    expect(typeof helpers.sendTelegramMessage).toBe('function');
  });

  describe('canHandle', () => {
    it('should handle telegram URLs', async () => {
      const { getTelegramConnector } = await import('../utils/browserConnectors');
      const connector = getTelegramConnector();

      expect(connector.canHandle('https://telegram.me/mybot')).toBe(true);
      expect(connector.canHandle('telegram://chat')).toBe(true);
      expect(connector.canHandle('telegram')).toBe(true);
    });

    it('should handle numeric chat IDs', async () => {
      const { getTelegramConnector } = await import('../utils/browserConnectors');
      const connector = getTelegramConnector();

      expect(connector.canHandle('123456789')).toBe(true);
      expect(connector.canHandle('987654321')).toBe(true);
    });

    it('should not handle other URLs', async () => {
      const { getTelegramConnector } = await import('../utils/browserConnectors');
      const connector = getTelegramConnector();

      expect(connector.canHandle('https://google.com')).toBe(false);
      expect(connector.canHandle('https://github.com')).toBe(false);
    });
  });
});

// ============= Integration Tests =============

describe('Telegram Integration', () => {
  it('should have all required type definitions', async () => {
    const types = await import('../types/telegram');

    // Connection types
    expect(types.TelegramConnectionStatus).toBeDefined();

    // Message types
    expect(types.TelegramMessage).toBeDefined();
    expect(types.TelegramChat).toBeDefined();
    expect(types.TelegramUser).toBeDefined();

    // Bot info
    expect(types.TelegramBotInfo).toBeDefined();

    // Store state
    expect(types.TelegramState).toBeDefined();

    // Default config
    expect(types.DEFAULT_TELEGRAM_CONFIG).toBeDefined();
  });
});
