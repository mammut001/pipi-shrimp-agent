export type TelegramBindingMode = 'task' | 'autoresearch';

export type TelegramTaskType =
  | 'standard'
  | 'autoresearch_control'
  | 'autoresearch_run';

export type TelegramTaskStatus =
  | 'queued'
  | 'acknowledged'
  | 'running'
  | 'waiting_review'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type TelegramBindingPermissionMode =
  | 'plan-only'
  | 'standard'
  | 'auto-edits'
  | 'bypass';

export interface TelegramBinding {
  chatId: number;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  displayName: string;
  isOwner: boolean;
  autoRun: boolean;
  allowedModes: TelegramBindingMode[];
  defaultProjectId?: string;
  defaultWorkDir?: string;
  defaultPermissionMode: TelegramBindingPermissionMode;
  defaultAutoResearchProfileId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TelegramTask {
  id: string;
  chatId: number;
  sourceMessageId: number;
  type: TelegramTaskType;
  status: TelegramTaskStatus;
  prompt: string;
  localSessionId?: string;
  resultSummary?: string;
  errorMessage?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
}

export interface TelegramRuntimeState {
  lastUpdateId: number;
  pollerStatus: 'idle' | 'polling' | 'error';
  lastPollAt?: number;
  lastError?: string;
}

export const DEFAULT_TELEGRAM_RUNTIME_STATE: TelegramRuntimeState = {
  lastUpdateId: 0,
  pollerStatus: 'idle',
};

export function formatTelegramTaskRef(taskId: string): string {
  return taskId.slice(0, 8);
}

export function matchesTelegramTaskReference(task: TelegramTask, reference: string): boolean {
  const normalizedReference = reference.trim().toLowerCase();
  if (!normalizedReference) {
    return false;
  }

  const normalizedTaskId = task.id.toLowerCase();
  return normalizedTaskId === normalizedReference || normalizedTaskId.startsWith(normalizedReference);
}