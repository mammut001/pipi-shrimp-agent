import { isChatAllowed, type TelegramConfig } from '@/types/telegram';

import { getTelegramConnectorConfig } from '@/services/telegram/connectorConfig';
import { listTelegramBindings } from '@/services/telegram/taskService';

export const TELEGRAM_UNAUTHORIZED_CHAT_MESSAGE = '此聊天未授权使用该机器人。';

export async function getTelegramOwnerChatId(): Promise<number | null> {
  const bindings = await listTelegramBindings();
  const ownerBinding = bindings.find((binding) => binding.isOwner);
  return ownerBinding?.chatId ?? null;
}

export function isTelegramChatAllowedByConfig(
  chatId: number,
  config: TelegramConfig = getTelegramConnectorConfig(),
  ownerChatId: number | null = null,
): boolean {
  if (config.allowedChats === '*') {
    return true;
  }

  if (ownerChatId !== null && chatId === ownerChatId) {
    return true;
  }

  return isChatAllowed(chatId, config);
}

export async function isTelegramInboundChatAuthorized(chatId: number): Promise<boolean> {
  const config = getTelegramConnectorConfig();
  if (config.allowedChats === '*') {
    return true;
  }

  if (isChatAllowed(chatId, config)) {
    return true;
  }

  const ownerChatId = await getTelegramOwnerChatId();
  return ownerChatId !== null && chatId === ownerChatId;
}