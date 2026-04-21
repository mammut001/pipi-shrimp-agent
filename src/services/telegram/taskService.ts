import { invoke } from '@tauri-apps/api/core';

import type {
  TelegramBinding,
  TelegramRuntimeState,
  TelegramTask,
} from '@/types/telegramTask';
import { DEFAULT_TELEGRAM_RUNTIME_STATE } from '@/types/telegramTask';

const TELEGRAM_RUNTIME_STATE_KEY = 'telegram.runtime';

interface DbTelegramBinding {
  chat_id: number;
  chat_type: TelegramBinding['chatType'];
  display_name: string;
  is_owner: boolean;
  auto_run: boolean;
  allowed_modes_json: string;
  default_project_id: string | null;
  default_work_dir: string | null;
  default_permission_mode: TelegramBinding['defaultPermissionMode'];
  default_autoresearch_profile_id: string | null;
  created_at: number;
  updated_at: number;
}

interface DbTelegramTask {
  id: string;
  chat_id: number;
  source_message_id: number;
  type: TelegramTask['type'];
  status: TelegramTask['status'];
  prompt: string;
  local_session_id: string | null;
  result_summary: string | null;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn('[telegramTaskService] Failed to parse JSON:', error);
    return fallback;
  }
}

function dbToBinding(binding: DbTelegramBinding): TelegramBinding {
  return {
    chatId: binding.chat_id,
    chatType: binding.chat_type,
    displayName: binding.display_name,
    isOwner: binding.is_owner,
    autoRun: binding.auto_run,
    allowedModes: safeJsonParse(binding.allowed_modes_json, []),
    defaultProjectId: binding.default_project_id || undefined,
    defaultWorkDir: binding.default_work_dir || undefined,
    defaultPermissionMode: binding.default_permission_mode,
    defaultAutoResearchProfileId: binding.default_autoresearch_profile_id || undefined,
    createdAt: binding.created_at,
    updatedAt: binding.updated_at,
  };
}

function bindingToDb(binding: TelegramBinding): DbTelegramBinding {
  return {
    chat_id: binding.chatId,
    chat_type: binding.chatType,
    display_name: binding.displayName,
    is_owner: binding.isOwner,
    auto_run: binding.autoRun,
    allowed_modes_json: JSON.stringify(binding.allowedModes),
    default_project_id: binding.defaultProjectId || null,
    default_work_dir: binding.defaultWorkDir || null,
    default_permission_mode: binding.defaultPermissionMode,
    default_autoresearch_profile_id: binding.defaultAutoResearchProfileId || null,
    created_at: binding.createdAt,
    updated_at: binding.updatedAt,
  };
}

function dbToTask(task: DbTelegramTask): TelegramTask {
  return {
    id: task.id,
    chatId: task.chat_id,
    sourceMessageId: task.source_message_id,
    type: task.type,
    status: task.status,
    prompt: task.prompt,
    localSessionId: task.local_session_id || undefined,
    resultSummary: task.result_summary || undefined,
    errorMessage: task.error_message || undefined,
    createdAt: task.created_at,
    startedAt: task.started_at || undefined,
    finishedAt: task.finished_at || undefined,
    updatedAt: task.updated_at,
  };
}

function taskToDb(task: TelegramTask): DbTelegramTask {
  return {
    id: task.id,
    chat_id: task.chatId,
    source_message_id: task.sourceMessageId,
    type: task.type,
    status: task.status,
    prompt: task.prompt,
    local_session_id: task.localSessionId || null,
    result_summary: task.resultSummary || null,
    error_message: task.errorMessage || null,
    created_at: task.createdAt,
    started_at: task.startedAt || null,
    finished_at: task.finishedAt || null,
    updated_at: task.updatedAt,
  };
}

export async function saveTelegramBinding(binding: TelegramBinding): Promise<void> {
  await invoke('db_save_telegram_binding', { binding: bindingToDb(binding) });
}

export async function getTelegramBinding(chatId: number): Promise<TelegramBinding | null> {
  const result = await invoke<DbTelegramBinding | null>('db_get_telegram_binding', { chatId });
  return result ? dbToBinding(result) : null;
}

export async function listTelegramBindings(): Promise<TelegramBinding[]> {
  const result = await invoke<DbTelegramBinding[]>('db_list_telegram_bindings');
  return result.map(dbToBinding);
}

export async function saveTelegramTask(task: TelegramTask): Promise<void> {
  await invoke('db_save_telegram_task', { task: taskToDb(task) });
}

export async function getTelegramTask(taskId: string): Promise<TelegramTask | null> {
  const result = await invoke<DbTelegramTask | null>('db_get_telegram_task', { taskId });
  return result ? dbToTask(result) : null;
}

export async function findTelegramTaskBySource(chatId: number, sourceMessageId: number): Promise<TelegramTask | null> {
  const result = await invoke<DbTelegramTask | null>('db_find_telegram_task_by_source', {
    chatId,
    sourceMessageId,
  });
  return result ? dbToTask(result) : null;
}

export async function listTelegramTasksForChat(chatId: number, limit?: number): Promise<TelegramTask[]> {
  const result = await invoke<DbTelegramTask[]>('db_list_telegram_tasks_for_chat', {
    chatId,
    limit,
  });
  return result.map(dbToTask);
}

export async function listTelegramTasksByStatuses(statuses: TelegramTask['status'][], limit?: number): Promise<TelegramTask[]> {
  const result = await invoke<DbTelegramTask[]>('db_list_telegram_tasks_by_statuses', {
    statuses,
    limit,
  });
  return result.map(dbToTask);
}

export async function loadTelegramRuntimeState(): Promise<TelegramRuntimeState> {
  const value = await invoke<string | null>('db_get_telegram_runtime_state', {
    key: TELEGRAM_RUNTIME_STATE_KEY,
  });

  if (!value) {
    return DEFAULT_TELEGRAM_RUNTIME_STATE;
  }

  return {
    ...DEFAULT_TELEGRAM_RUNTIME_STATE,
    ...safeJsonParse<TelegramRuntimeState>(value, DEFAULT_TELEGRAM_RUNTIME_STATE),
  };
}

export async function saveTelegramRuntimeState(runtimeState: TelegramRuntimeState): Promise<void> {
  await invoke('db_set_telegram_runtime_state', {
    key: TELEGRAM_RUNTIME_STATE_KEY,
    value: JSON.stringify(runtimeState),
  });
}