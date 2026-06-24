import {
  DEFAULT_TELEGRAM_CONFIG,
  type TelegramConfig,
} from '@/types/telegram';
import type { TelegramBinding } from '@/types/telegramTask';

const mockListTelegramBindings = jest.fn();
const mockLocalStorage = {
  data: {} as Record<string, string>,
  getItem: jest.fn((key: string) => mockLocalStorage.data[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    mockLocalStorage.data[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete mockLocalStorage.data[key];
  }),
};

jest.mock('@/services/telegram/taskService', () => ({
  listTelegramBindings: (...args: unknown[]) => mockListTelegramBindings(...args),
}));

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

function buildOwnerBinding(chatId = 100): TelegramBinding {
  return {
    chatId,
    chatType: 'private',
    displayName: 'Owner',
    isOwner: true,
    autoRun: true,
    allowedModes: ['task'],
    defaultPermissionMode: 'standard',
    createdAt: 1,
    updatedAt: 1,
  };
}

function storeConnectorConfig(config: Partial<TelegramConfig>): void {
  mockLocalStorage.setItem(
    'pipi-shrimp-telegram-connector-config',
    JSON.stringify({ ...DEFAULT_TELEGRAM_CONFIG, ...config }),
  );
}

describe('Telegram chat authorization', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockLocalStorage.data = {};
    mockListTelegramBindings.mockResolvedValue([]);
  });

  describe('isTelegramChatAllowedByConfig', () => {
    it('allows any chat when allowedChats is wildcard', async () => {
      const { isTelegramChatAllowedByConfig } = await import('../chatAuthorization');

      expect(isTelegramChatAllowedByConfig(456, { ...DEFAULT_TELEGRAM_CONFIG, allowedChats: '*' })).toBe(true);
      expect(isTelegramChatAllowedByConfig(789, { ...DEFAULT_TELEGRAM_CONFIG, allowedChats: '*' }, 100)).toBe(true);
    });

    it('allows only listed chats when allowedChats is restrictive', async () => {
      const { isTelegramChatAllowedByConfig } = await import('../chatAuthorization');
      const config = { ...DEFAULT_TELEGRAM_CONFIG, allowedChats: [123] };

      expect(isTelegramChatAllowedByConfig(123, config)).toBe(true);
      expect(isTelegramChatAllowedByConfig(456, config)).toBe(false);
    });

    it('allows owner chat when allowedChats is empty', async () => {
      const { isTelegramChatAllowedByConfig } = await import('../chatAuthorization');
      const config = { ...DEFAULT_TELEGRAM_CONFIG, allowedChats: [] };

      expect(isTelegramChatAllowedByConfig(100, config, 100)).toBe(true);
      expect(isTelegramChatAllowedByConfig(456, config, 100)).toBe(false);
    });

    it('allows owner chat even when owner is not in allowedChats', async () => {
      const { isTelegramChatAllowedByConfig } = await import('../chatAuthorization');
      const config = { ...DEFAULT_TELEGRAM_CONFIG, allowedChats: [123] };

      expect(isTelegramChatAllowedByConfig(100, config, 100)).toBe(true);
      expect(isTelegramChatAllowedByConfig(456, config, 100)).toBe(false);
    });
  });

  describe('isTelegramInboundChatAuthorized', () => {
    it('allows listed chats without owner binding lookup', async () => {
      storeConnectorConfig({ allowedChats: [123] });

      const { isTelegramInboundChatAuthorized } = await import('../chatAuthorization');

      expect(await isTelegramInboundChatAuthorized(123)).toBe(true);
      expect(mockListTelegramBindings).not.toHaveBeenCalled();
    });

    it('rejects unauthorized chat after checking owner binding', async () => {
      storeConnectorConfig({ allowedChats: [123] });
      mockListTelegramBindings.mockResolvedValue([buildOwnerBinding(100)]);

      const { isTelegramInboundChatAuthorized } = await import('../chatAuthorization');

      expect(await isTelegramInboundChatAuthorized(456)).toBe(false);
      expect(mockListTelegramBindings).toHaveBeenCalled();
    });

    it('loads owner chat id when allowlist is restrictive', async () => {
      storeConnectorConfig({ allowedChats: [123] });
      mockListTelegramBindings.mockResolvedValue([buildOwnerBinding(100)]);

      const { isTelegramInboundChatAuthorized } = await import('../chatAuthorization');

      expect(await isTelegramInboundChatAuthorized(100)).toBe(true);
      expect(await isTelegramInboundChatAuthorized(456)).toBe(false);
      expect(mockListTelegramBindings).toHaveBeenCalled();
    });

    it('empty allowedChats denies all chats except owner', async () => {
      storeConnectorConfig({ allowedChats: [] });
      mockListTelegramBindings.mockResolvedValue([buildOwnerBinding(100)]);

      const { isTelegramInboundChatAuthorized } = await import('../chatAuthorization');

      expect(await isTelegramInboundChatAuthorized(100)).toBe(true);
      expect(await isTelegramInboundChatAuthorized(123)).toBe(false);
    });
  });

  describe('connectorConfig persistence', () => {
    it('persists allowed chat ids for router enforcement', async () => {
      const { persistTelegramAllowedChatIds, getTelegramConnectorConfig } = await import('../connectorConfig');

      persistTelegramAllowedChatIds([123, 456]);

      expect(getTelegramConnectorConfig().allowedChats).toEqual([123, 456]);
    });
  });

  describe('denial copy', () => {
    it('does not leak configured chat ids or paths', async () => {
      const { TELEGRAM_UNAUTHORIZED_CHAT_MESSAGE } = await import('../chatAuthorization');

      expect(TELEGRAM_UNAUTHORIZED_CHAT_MESSAGE).toBe('此聊天未授权使用该机器人。');
      expect(TELEGRAM_UNAUTHORIZED_CHAT_MESSAGE).not.toMatch(/\d{3,}/);
      expect(TELEGRAM_UNAUTHORIZED_CHAT_MESSAGE).not.toMatch(/[/\\]/);
    });
  });
});