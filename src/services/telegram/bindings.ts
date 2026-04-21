import { useChatStore } from '@/store';
import type { TelegramMessage } from '@/types/telegram';
import { formatChatName } from '@/types/telegram';
import type { TelegramBinding, TelegramBindingMode } from '@/types/telegramTask';

import {
  getTelegramBinding,
  listTelegramBindings,
  saveTelegramBinding,
} from '@/services/telegram/taskService';

interface TelegramBindingResolution {
  binding: TelegramBinding | null;
  created: boolean;
  reason?: string;
}

function buildBootstrapBinding(message: TelegramMessage): TelegramBinding {
  const now = Date.now();
  const currentSession = useChatStore.getState().currentSession();

  return {
    chatId: message.chat.id,
    chatType: message.chat.type,
    displayName: formatChatName(message.chat),
    isOwner: true,
    autoRun: true,
    allowedModes: ['task'],
    defaultProjectId: currentSession?.projectId,
    defaultWorkDir: currentSession?.workDir,
    defaultPermissionMode: currentSession?.permissionMode === 'plan-only'
      ? 'plan-only'
      : 'standard',
    createdAt: now,
    updatedAt: now,
  };
}

export function describeTelegramSender(message: TelegramMessage): string {
  const displayName = formatChatName(message.chat);
  const username = message.from?.username ? `@${message.from.username}` : '';
  return username ? `${displayName} (${username})` : displayName;
}

export async function ensureTelegramBindingForStart(
  message: TelegramMessage,
): Promise<TelegramBindingResolution> {
  const existingBinding = await getTelegramBinding(message.chat.id);
  if (existingBinding) {
    return { binding: existingBinding, created: false };
  }

  if (message.chat.type !== 'private') {
    return {
      binding: null,
      created: false,
      reason: '当前版本只支持 owner 私聊绑定。',
    };
  }

  const bindings = await listTelegramBindings();
  if (bindings.some((binding) => binding.isOwner)) {
    return {
      binding: null,
      created: false,
      reason: '这个 chat 还没有被授权。当前 MVP 只允许第一个 owner 私聊自动绑定。',
    };
  }

  const binding = buildBootstrapBinding(message);
  await saveTelegramBinding(binding);
  return { binding, created: true };
}

export async function requireTelegramBindingForMode(
  chatId: number,
  mode: TelegramBindingMode,
): Promise<TelegramBindingResolution> {
  const binding = await getTelegramBinding(chatId);
  if (!binding) {
    return {
      binding: null,
      created: false,
      reason: '当前 chat 尚未绑定。请先发送 /start 完成首次绑定。',
    };
  }

  if (!binding.allowedModes.includes(mode)) {
    return {
      binding: null,
      created: false,
      reason: '当前 chat 没有启用这个命令域。',
    };
  }

  if (mode === 'autoresearch' && !binding.isOwner) {
    return {
      binding: null,
      created: false,
      reason: 'AutoResearch 只能由 owner chat 触发。',
    };
  }

  if (mode === 'task' && binding.chatType !== 'private') {
    return {
      binding: null,
      created: false,
      reason: '当前版本只支持私聊触发 /task。',
    };
  }

  return { binding, created: false };
}