import type { TelegramMessage, TelegramUpdate } from '@/types/telegram';

const mockTelegramGetUpdates = jest.fn();
const mockHandleTelegramUpdate = jest.fn();
const mockLoadTelegramRuntimeState = jest.fn();
const mockSaveTelegramRuntimeState = jest.fn();
const mockStartTelegramTaskRuntime = jest.fn();
const mockStopTelegramTaskRuntime = jest.fn();
const mockAddMessage = jest.fn();
const mockUpdateLastUpdateId = jest.fn();

jest.mock('@/services/telegramService', () => ({
  telegramGetUpdates: (...args: unknown[]) => mockTelegramGetUpdates(...args),
}));

jest.mock('@/services/telegram/commandRouter', () => ({
  handleTelegramUpdate: (...args: unknown[]) => mockHandleTelegramUpdate(...args),
}));

jest.mock('@/services/telegram/taskService', () => ({
  loadTelegramRuntimeState: (...args: unknown[]) => mockLoadTelegramRuntimeState(...args),
  saveTelegramRuntimeState: (...args: unknown[]) => mockSaveTelegramRuntimeState(...args),
}));

jest.mock('@/services/telegram/taskOrchestrator', () => ({
  startTelegramTaskRuntime: (...args: unknown[]) => mockStartTelegramTaskRuntime(...args),
  stopTelegramTaskRuntime: (...args: unknown[]) => mockStopTelegramTaskRuntime(...args),
}));

jest.mock('@/store/telegramStore', () => ({
  useTelegramStore: {
    getState: () => ({
      addMessage: mockAddMessage,
      updateLastUpdateId: mockUpdateLastUpdateId,
    }),
  },
}));

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function buildMessage(messageId: number, text: string): TelegramMessage {
  return {
    messageId,
    chat: {
      id: 42,
      type: 'private',
      firstName: 'Owner',
    },
    date: 1,
    text,
  };
}

describe('Telegram poller', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as unknown as typeof setTimeout);
    jest.spyOn(global, 'clearTimeout').mockImplementation((() => undefined) as unknown as typeof clearTimeout);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockLoadTelegramRuntimeState.mockResolvedValue({
      lastUpdateId: 10,
      pollerStatus: 'idle',
    });
    mockSaveTelegramRuntimeState.mockResolvedValue(undefined);
    mockStartTelegramTaskRuntime.mockResolvedValue(undefined);
    mockStopTelegramTaskRuntime.mockResolvedValue(undefined);
    mockHandleTelegramUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sorts updates, skips duplicate updateIds, and persists the latest offset', async () => {
    const updates: TelegramUpdate[] = [
      { updateId: 12, message: buildMessage(102, '/task second') },
      { updateId: 11, message: buildMessage(101, '/help') },
      { updateId: 12, message: buildMessage(103, '/task duplicate') },
    ];
    mockTelegramGetUpdates.mockResolvedValue(updates);

    const { startTelegramPoller, stopTelegramPoller } = await import('../poller');
    await startTelegramPoller();
    await flushPromises();

    expect(mockStartTelegramTaskRuntime).toHaveBeenCalledTimes(1);
    expect(mockTelegramGetUpdates).toHaveBeenCalledWith(11, 20);
    expect(mockHandleTelegramUpdate).toHaveBeenCalledTimes(2);
    expect(mockHandleTelegramUpdate.mock.calls.map(([update]) => update.updateId)).toEqual([11, 12]);
    expect(mockAddMessage.mock.calls.map(([message]) => message.messageId)).toEqual([101, 102]);
    expect(mockUpdateLastUpdateId).toHaveBeenCalledWith(10);
    expect(mockUpdateLastUpdateId).toHaveBeenCalledWith(11);
    expect(mockUpdateLastUpdateId).toHaveBeenCalledWith(12);
    expect(mockSaveTelegramRuntimeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastUpdateId: 12,
        pollerStatus: 'idle',
        lastError: undefined,
      }),
    );

    await stopTelegramPoller();
  });

  it('persists poller errors without crashing the runtime', async () => {
    mockTelegramGetUpdates.mockRejectedValue(new Error('network down'));

    const { startTelegramPoller, stopTelegramPoller } = await import('../poller');
    await startTelegramPoller();
    await flushPromises();

    expect(mockSaveTelegramRuntimeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pollerStatus: 'error',
        lastError: 'network down',
      }),
    );

    await stopTelegramPoller();
    expect(mockStopTelegramTaskRuntime).toHaveBeenCalledTimes(1);
  });
});