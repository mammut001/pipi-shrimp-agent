import type { TelegramMessage, TelegramUpdate } from '@/types/telegram';
import { extractCommand } from '@/types/telegram';
import { useTelegramStore } from '@/store/telegramStore';
import { formatTelegramTaskRef } from '@/types/telegramTask';

import {
  ensureTelegramBindingForStart,
  requireTelegramBindingForMode,
} from '@/services/telegram/bindings';
import {
  buildTelegramHelpText,
  buildTelegramTaskResultText,
  buildTelegramTaskStatusText,
  sendTelegramText,
} from '@/services/telegram/resultNotifier';
import {
  enqueueTelegramTaskFromMessage,
  getTelegramTaskForReference,
} from '@/services/telegram/taskOrchestrator';
import { getTelegramBinding } from '@/services/telegram/taskService';

function normalizeTelegramCommand(command: string, botUsername?: string): string | null {
  const normalizedCommand = command.trim().toLowerCase();
  if (!normalizedCommand.startsWith('/')) {
    return null;
  }

  const [baseCommand, mention] = normalizedCommand.split('@');
  if (!mention) {
    return baseCommand;
  }

  if (!botUsername) {
    return null;
  }

  return mention === botUsername.toLowerCase() ? baseCommand : null;
}

async function handleStart(message: TelegramMessage): Promise<void> {
  const result = await ensureTelegramBindingForStart(message);
  if (!result.binding) {
    await sendTelegramText(message.chat.id, result.reason || '绑定失败。', message.messageId);
    return;
  }

  const intro = result.created
    ? `首次 owner 绑定已完成。\n\n${buildTelegramHelpText(true)}`
    : buildTelegramHelpText(true);
  await sendTelegramText(message.chat.id, intro, message.messageId);
}

async function handleHelp(message: TelegramMessage): Promise<void> {
  const binding = await getTelegramBinding(message.chat.id);
  await sendTelegramText(message.chat.id, buildTelegramHelpText(Boolean(binding)), message.messageId);
}

async function handleTask(message: TelegramMessage, args: string): Promise<void> {
  const { binding, reason } = await requireTelegramBindingForMode(message.chat.id, 'task');
  if (!binding) {
    await sendTelegramText(message.chat.id, reason || '当前 chat 没有权限运行任务。', message.messageId);
    return;
  }

  const prompt = args.trim();
  if (!prompt) {
    await sendTelegramText(message.chat.id, '用法：/task <需求描述>', message.messageId);
    return;
  }

  const result = await enqueueTelegramTaskFromMessage(message, prompt, binding);
  if (!result.created) {
    await sendTelegramText(
      message.chat.id,
      `任务 ${formatTelegramTaskRef(result.task.id)} 已存在。\n${buildTelegramTaskStatusText(result.task)}`,
      message.messageId,
    );
  }
}

async function handleStatus(message: TelegramMessage, args: string): Promise<void> {
  const { binding, reason } = await requireTelegramBindingForMode(message.chat.id, 'task');
  if (!binding) {
    await sendTelegramText(message.chat.id, reason || '当前 chat 没有权限查看任务状态。', message.messageId);
    return;
  }

  const task = await getTelegramTaskForReference(message.chat.id, args.trim());
  if (!task) {
    await sendTelegramText(message.chat.id, '当前 chat 还没有可查询的任务。', message.messageId);
    return;
  }

  await sendTelegramText(message.chat.id, buildTelegramTaskStatusText(task), message.messageId);
}

async function handleResult(message: TelegramMessage, args: string): Promise<void> {
  const { binding, reason } = await requireTelegramBindingForMode(message.chat.id, 'task');
  if (!binding) {
    await sendTelegramText(message.chat.id, reason || '当前 chat 没有权限查看任务结果。', message.messageId);
    return;
  }

  const task = await getTelegramTaskForReference(message.chat.id, args.trim());
  if (!task) {
    await sendTelegramText(message.chat.id, '当前 chat 还没有可查询的任务。', message.messageId);
    return;
  }

  await sendTelegramText(message.chat.id, buildTelegramTaskResultText(task), message.messageId);
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) {
    return;
  }

  const parsedCommand = extractCommand(message);
  if (!parsedCommand) {
    return;
  }

  const botUsername = useTelegramStore.getState().botInfo?.username;
  const normalizedCommand = normalizeTelegramCommand(parsedCommand.command, botUsername);
  if (!normalizedCommand) {
    return;
  }

  switch (normalizedCommand) {
    case '/start':
      await handleStart(message);
      return;
    case '/help':
      await handleHelp(message);
      return;
    case '/task':
      await handleTask(message, parsedCommand.args);
      return;
    case '/status':
      await handleStatus(message, parsedCommand.args);
      return;
    case '/result':
      await handleResult(message, parsedCommand.args);
      return;
    case '/cancel':
      await sendTelegramText(message.chat.id, '当前 MVP 还没有接入 /cancel。', message.messageId);
      return;
    default:
      if (normalizedCommand.startsWith('/ar')) {
        await sendTelegramText(message.chat.id, 'AutoResearch 的 Telegram 控制面还在下一阶段接入。', message.messageId);
      }
  }
}