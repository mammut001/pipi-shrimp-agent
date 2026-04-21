import { useTelegramStore } from '@/store/telegramStore';
import { telegramGetUpdates } from '@/services/telegramService';
import type { TelegramRuntimeState } from '@/types/telegramTask';
import { DEFAULT_TELEGRAM_RUNTIME_STATE } from '@/types/telegramTask';

import { handleTelegramUpdate } from '@/services/telegram/commandRouter';
import {
  loadTelegramRuntimeState,
  saveTelegramRuntimeState,
} from '@/services/telegram/taskService';
import {
  startTelegramTaskRuntime,
  stopTelegramTaskRuntime,
} from '@/services/telegram/taskOrchestrator';

const POLL_INTERVAL_MS = 2500;

let pollerRunning = false;
let pollInFlight = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let runtimeState: TelegramRuntimeState = DEFAULT_TELEGRAM_RUNTIME_STATE;

async function persistRuntimeState(patch: Partial<TelegramRuntimeState>): Promise<void> {
  runtimeState = {
    ...runtimeState,
    ...patch,
  };
  await saveTelegramRuntimeState(runtimeState);
}

function scheduleNextPoll(): void {
  if (!pollerRunning) {
    return;
  }

  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  pollTimer = setTimeout(() => {
    void pollTelegramUpdates();
  }, POLL_INTERVAL_MS);
}

async function pollTelegramUpdates(): Promise<void> {
  if (!pollerRunning || pollInFlight) {
    return;
  }

  pollInFlight = true;

  try {
    await persistRuntimeState({
      pollerStatus: 'polling',
      lastPollAt: Date.now(),
      lastError: undefined,
    });

    const offset = runtimeState.lastUpdateId > 0 ? runtimeState.lastUpdateId + 1 : undefined;
    const updates = await telegramGetUpdates(offset, 20);
    const sortedUpdates = [...updates].sort((left, right) => left.updateId - right.updateId);
    const processedUpdateIds = new Set<number>();

    for (const update of sortedUpdates) {
      if (processedUpdateIds.has(update.updateId) || update.updateId <= runtimeState.lastUpdateId) {
        continue;
      }

      processedUpdateIds.add(update.updateId);

      if (update.message) {
        useTelegramStore.getState().addMessage(update.message);
        try {
          await handleTelegramUpdate(update);
        } catch (error) {
          console.error('[telegram/poller] Failed to handle update:', error);
        }
      }

      useTelegramStore.getState().updateLastUpdateId(update.updateId);
      await persistRuntimeState({
        lastUpdateId: update.updateId,
        pollerStatus: 'idle',
        lastPollAt: Date.now(),
        lastError: undefined,
      });
    }

    if (sortedUpdates.length === 0) {
      await persistRuntimeState({
        pollerStatus: 'idle',
        lastPollAt: Date.now(),
        lastError: undefined,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[telegram/poller] Poll failed:', errorMessage);
    await persistRuntimeState({
      pollerStatus: 'error',
      lastPollAt: Date.now(),
      lastError: errorMessage,
    });
  } finally {
    pollInFlight = false;
    scheduleNextPoll();
  }
}

export async function startTelegramPoller(): Promise<void> {
  if (pollerRunning) {
    return;
  }

  runtimeState = await loadTelegramRuntimeState();
  useTelegramStore.getState().updateLastUpdateId(runtimeState.lastUpdateId);

  pollerRunning = true;
  await startTelegramTaskRuntime();
  void pollTelegramUpdates();
}

export async function stopTelegramPoller(): Promise<void> {
  pollerRunning = false;
  stopTelegramTaskRuntime();

  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  await persistRuntimeState({
    pollerStatus: 'idle',
    lastError: undefined,
  });
}