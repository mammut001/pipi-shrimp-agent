import { telegramSendMessage } from '@/services/telegramService';
import type { TelegramTask } from '@/types/telegramTask';
import { formatTelegramTaskRef } from '@/types/telegramTask';

const MAX_TELEGRAM_TEXT_LENGTH = 3600;

function truncateTelegramText(content: string): string {
  const normalized = content.trim();
  if (normalized.length <= MAX_TELEGRAM_TEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_TELEGRAM_TEXT_LENGTH)}…`;
}

function formatTaskState(task: TelegramTask): string {
  switch (task.status) {
    case 'queued':
    case 'acknowledged':
      return '排队中';
    case 'running':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'interrupted':
      return '已中断';
    case 'cancelled':
      return '已取消';
    case 'waiting_review':
      return '等待桌面确认';
    case 'waiting_input':
      return '等待补充输入';
    default:
      return task.status;
  }
}

export async function sendTelegramText(
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<void> {
  await telegramSendMessage(chatId, text, replyToMessageId ? { replyToMessageId } : undefined);
}

export function buildTelegramHelpText(isBound: boolean): string {
  if (!isBound) {
    return [
      '当前 chat 还没绑定。',
      '',
      '先发送 /start 完成首次 owner 绑定，然后可以使用：',
      '/task <需求描述>',
      '/status [taskId]',
      '/result [taskId]',
    ].join('\n');
  }

  return [
    '可用命令：',
    '/task <需求描述>  创建桌面任务',
    '/status [taskId]  查看最新任务或指定任务状态',
    '/result [taskId]  查看最新任务或指定任务结果',
  ].join('\n');
}

export function buildTelegramTaskStatusText(task: TelegramTask): string {
  const lines = [
    `任务 ${formatTelegramTaskRef(task.id)} 状态：${formatTaskState(task)}`,
    `创建时间：${new Date(task.createdAt).toLocaleString()}`,
  ];

  if (task.startedAt) {
    lines.push(`开始时间：${new Date(task.startedAt).toLocaleString()}`);
  }
  if (task.finishedAt) {
    lines.push(`结束时间：${new Date(task.finishedAt).toLocaleString()}`);
  }
  if (task.localSessionId) {
    lines.push(`桌面会话：${task.localSessionId.slice(0, 8)}`);
  }
  if (task.errorMessage) {
    lines.push('', `错误：${truncateTelegramText(task.errorMessage)}`);
  }

  return lines.join('\n');
}

export function buildTelegramTaskResultText(task: TelegramTask): string {
  if (task.status !== 'completed') {
    return buildTelegramTaskStatusText(task);
  }

  const lines = [
    `任务 ${formatTelegramTaskRef(task.id)} 已完成。`,
  ];

  if (task.localSessionId) {
    lines.push(`桌面会话：${task.localSessionId.slice(0, 8)}`);
  }

  lines.push('', truncateTelegramText(task.resultSummary || '任务已完成，但没有生成可回传的文本摘要。'));
  return lines.join('\n');
}

export async function sendTelegramTaskAcknowledged(task: TelegramTask): Promise<void> {
  await sendTelegramText(
    task.chatId,
    `任务 ${formatTelegramTaskRef(task.id)} 已创建，桌面端开始处理。`,
    task.sourceMessageId,
  );
}

export async function sendTelegramTaskWaitingReview(task: TelegramTask): Promise<void> {
  await sendTelegramText(
    task.chatId,
    `任务 ${formatTelegramTaskRef(task.id)} 已记录，但当前 chat 未启用自动执行。请回到桌面端处理。`,
    task.sourceMessageId,
  );
}

export async function sendTelegramTaskCompleted(task: TelegramTask): Promise<void> {
  await sendTelegramText(task.chatId, buildTelegramTaskResultText(task), task.sourceMessageId);
}

export async function sendTelegramTaskFailed(task: TelegramTask): Promise<void> {
  const lines = [
    `任务 ${formatTelegramTaskRef(task.id)} 执行失败。`,
  ];

  if (task.errorMessage) {
    lines.push('', truncateTelegramText(task.errorMessage));
  }

  await sendTelegramText(task.chatId, lines.join('\n'), task.sourceMessageId);
}