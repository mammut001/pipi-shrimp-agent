import { invoke } from '@tauri-apps/api/core';

import { useChatStore } from '@/store';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import { buildHeadlessSystemPrompt } from '@/services/headless/systemPrompt';
import type { TelegramMessage } from '@/types/telegram';
import type { TelegramBinding, TelegramTask } from '@/types/telegramTask';
import { formatTelegramTaskRef, matchesTelegramTaskReference } from '@/types/telegramTask';

import {
  sendTelegramTaskAcknowledged,
  sendTelegramTaskCompleted,
  sendTelegramTaskFailed,
  sendTelegramTaskWaitingReview,
} from '@/services/telegram/resultNotifier';
import {
  appendTelegramTaskError,
  appendTelegramTaskResult,
  createTelegramTaskSession,
  updateTelegramTaskSessionWorkDir,
} from '@/services/telegram/sessionMirror';
import {
  findTelegramTaskBySource,
  getTelegramBinding,
  listTelegramTasksByStatuses,
  listTelegramTasksForChat,
  saveTelegramTask,
} from '@/services/telegram/taskService';

const QUEUED_TASK_STATUSES: TelegramTask['status'][] = ['queued', 'acknowledged'];
const RUNNING_TASK_STATUSES: TelegramTask['status'][] = ['running'];

const activeTaskIds = new Set<string>();
let drainPromise: Promise<void> | null = null;
let runtimeStarted = false;
let stopRequested = false;

async function initializeWorkDir(path: string): Promise<string> {
  await invoke('create_directory', { path });
  try {
    await invoke('init_pipi_shrimp', { workDir: path });
  } catch (error) {
    console.debug('[telegram/taskOrchestrator] init_pipi_shrimp skipped:', error);
  }
  return path;
}

async function resolveTelegramTaskWorkDir(
  sessionId: string,
  binding: TelegramBinding,
): Promise<string | null> {
  const currentSession = useChatStore.getState().currentSession();
  const candidatePaths = [
    binding.defaultWorkDir,
    currentSession?.workDir,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of new Set(candidatePaths)) {
    try {
      return await initializeWorkDir(candidate);
    } catch (error) {
      console.warn(`[telegram/task ${formatTelegramTaskRef(sessionId)}] Failed to use candidate workDir:`, error);
    }
  }

  try {
    const defaultDir = await invoke<string>('get_app_default_dir', { sessionId });
    return await initializeWorkDir(defaultDir);
  } catch (error) {
    console.error('[telegram/taskOrchestrator] Failed to resolve fallback workDir:', error);
    return null;
  }
}

async function markRunningTasksInterrupted(): Promise<void> {
  const runningTasks = await listTelegramTasksByStatuses(RUNNING_TASK_STATUSES, 100);
  if (runningTasks.length === 0) {
    return;
  }

  const now = Date.now();
  await Promise.all(
    runningTasks.map((task) => saveTelegramTask({
      ...task,
      status: 'interrupted',
      errorMessage: '桌面端在任务执行过程中断开了。请重新发送 /task。',
      finishedAt: now,
      updatedAt: now,
    })),
  );
}

async function executeTelegramTask(task: TelegramTask): Promise<void> {
  if (activeTaskIds.has(task.id)) {
    return;
  }

  activeTaskIds.add(task.id);
  let liveTask = task;

  try {
    const binding = await getTelegramBinding(task.chatId);
    if (!binding) {
      throw new Error('找不到 Telegram 绑定，无法执行这个任务。');
    }

    const session = await createTelegramTaskSession(task, binding);
    let currentWorkDir = session.workDir;

    if (!currentWorkDir) {
      currentWorkDir = (await resolveTelegramTaskWorkDir(session.id, binding)) ?? undefined;
      if (currentWorkDir) {
        await updateTelegramTaskSessionWorkDir(session.id, currentWorkDir);
      }
    }

    liveTask = {
      ...task,
      status: 'running',
      localSessionId: session.id,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveTelegramTask(liveTask);

    const systemPrompt = await buildHeadlessSystemPrompt({
      workDir: currentWorkDir,
      workingFiles: session.workingFiles,
      originalQuery: task.prompt,
    });

    const result = await runHeadlessAgentTurn({
      sessionId: session.id,
      initialMessages: [
        {
          role: 'user',
          content: task.prompt,
        },
      ],
      systemPrompt,
      workDir: currentWorkDir,
      resolveWorkDir: async () => resolveTelegramTaskWorkDir(session.id, binding),
      onWorkDirResolved: async (workDir) => {
        currentWorkDir = workDir;
        await updateTelegramTaskSessionWorkDir(session.id, workDir);
      },
      onStatus: (message) => {
        console.info(`[telegram/task ${formatTelegramTaskRef(task.id)}] ${message}`);
      },
    });

    const summary = result.finalText.trim() || '任务已完成，但没有生成可回传的文本摘要。';
    await appendTelegramTaskResult(session.id, summary);

    liveTask = {
      ...liveTask,
      status: 'completed',
      resultSummary: summary,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveTelegramTask(liveTask);
    await sendTelegramTaskCompleted(liveTask);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (liveTask.localSessionId) {
      await appendTelegramTaskError(liveTask.localSessionId, errorMessage);
    }

    liveTask = {
      ...liveTask,
      status: 'failed',
      errorMessage,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveTelegramTask(liveTask);
    await sendTelegramTaskFailed(liveTask);
  } finally {
    activeTaskIds.delete(task.id);
  }
}

async function drainTelegramTaskQueue(): Promise<void> {
  if (drainPromise) {
    return drainPromise;
  }

  drainPromise = (async () => {
    while (!stopRequested) {
      const [nextTask] = await listTelegramTasksByStatuses(QUEUED_TASK_STATUSES, 1);
      if (!nextTask) {
        break;
      }

      await executeTelegramTask(nextTask);
    }
  })().finally(() => {
    drainPromise = null;
  });

  return drainPromise;
}

export async function startTelegramTaskRuntime(): Promise<void> {
  stopRequested = false;
  if (!runtimeStarted) {
    runtimeStarted = true;
    await markRunningTasksInterrupted();
  }

  void drainTelegramTaskQueue();
}

export function stopTelegramTaskRuntime(): void {
  stopRequested = true;
}

export async function enqueueTelegramTaskFromMessage(
  message: TelegramMessage,
  prompt: string,
  binding: TelegramBinding,
): Promise<{ task: TelegramTask; created: boolean }> {
  const existingTask = await findTelegramTaskBySource(message.chat.id, message.messageId);
  if (existingTask) {
    return {
      task: existingTask,
      created: false,
    };
  }

  const now = Date.now();
  const task: TelegramTask = {
    id: crypto.randomUUID(),
    chatId: message.chat.id,
    sourceMessageId: message.messageId,
    type: 'standard',
    status: binding.autoRun ? 'acknowledged' : 'waiting_review',
    prompt,
    createdAt: now,
    updatedAt: now,
  };

  await saveTelegramTask(task);

  if (binding.autoRun) {
    await sendTelegramTaskAcknowledged(task);
    void drainTelegramTaskQueue();
  } else {
    await sendTelegramTaskWaitingReview(task);
  }

  return {
    task,
    created: true,
  };
}

export async function getTelegramTaskForReference(
  chatId: number,
  reference?: string,
): Promise<TelegramTask | null> {
  const tasks = await listTelegramTasksForChat(chatId, 50);
  if (tasks.length === 0) {
    return null;
  }

  if (!reference?.trim()) {
    return tasks[0] || null;
  }

  return tasks.find((task) => matchesTelegramTaskReference(task, reference)) || null;
}