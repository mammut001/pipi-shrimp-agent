import type { TelegramUpdate } from '@/types/telegram';
import type { TelegramBinding, TelegramTask } from '@/types/telegramTask';

const telegramStoreState = {
  botInfo: {
    username: 'PipiBot',
  },
};

const mockEnsureTelegramBindingForStart = jest.fn();
const mockRequireTelegramBindingForMode = jest.fn();
const mockBuildTelegramHelpText = jest.fn();
const mockBuildTelegramTaskResultText = jest.fn();
const mockBuildTelegramTaskStatusText = jest.fn();
const mockSendTelegramText = jest.fn();
const mockEnqueueTelegramTaskFromMessage = jest.fn();
const mockGetTelegramTaskForReference = jest.fn();
const mockGetTelegramBinding = jest.fn();

jest.mock('@/store/telegramStore', () => ({
  useTelegramStore: {
    getState: () => telegramStoreState,
  },
}));

jest.mock('@/services/telegram/bindings', () => ({
  ensureTelegramBindingForStart: (...args: unknown[]) => mockEnsureTelegramBindingForStart(...args),
  requireTelegramBindingForMode: (...args: unknown[]) => mockRequireTelegramBindingForMode(...args),
}));

jest.mock('@/services/telegram/resultNotifier', () => ({
  buildTelegramHelpText: (...args: unknown[]) => mockBuildTelegramHelpText(...args),
  buildTelegramTaskResultText: (...args: unknown[]) => mockBuildTelegramTaskResultText(...args),
  buildTelegramTaskStatusText: (...args: unknown[]) => mockBuildTelegramTaskStatusText(...args),
  sendTelegramText: (...args: unknown[]) => mockSendTelegramText(...args),
}));

jest.mock('@/services/telegram/taskOrchestrator', () => ({
  enqueueTelegramTaskFromMessage: (...args: unknown[]) => mockEnqueueTelegramTaskFromMessage(...args),
  getTelegramTaskForReference: (...args: unknown[]) => mockGetTelegramTaskForReference(...args),
}));

jest.mock('@/services/telegram/taskService', () => ({
  getTelegramBinding: (...args: unknown[]) => mockGetTelegramBinding(...args),
}));

function buildBinding(overrides: Partial<TelegramBinding> = {}): TelegramBinding {
  return {
    chatId: 42,
    chatType: 'private',
    displayName: 'Owner Chat',
    isOwner: true,
    autoRun: true,
    allowedModes: ['task'],
    defaultPermissionMode: 'standard',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildTask(overrides: Partial<TelegramTask> = {}): TelegramTask {
  return {
    id: 'task-12345678',
    chatId: 42,
    sourceMessageId: 99,
    type: 'standard',
    status: 'acknowledged',
    prompt: 'Summarize the repo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildUpdate(text: string): TelegramUpdate {
  return {
    updateId: 100,
    message: {
      messageId: 99,
      chat: {
        id: 42,
        type: 'private',
        firstName: 'Owner',
      },
      date: 1,
      text,
    },
  };
}

describe('handleTelegramUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    telegramStoreState.botInfo.username = 'PipiBot';
    mockBuildTelegramHelpText.mockReturnValue('help');
    mockBuildTelegramTaskResultText.mockReturnValue('result');
    mockBuildTelegramTaskStatusText.mockReturnValue('status');
  });

  it('routes /task commands into the task queue', async () => {
    const binding = buildBinding();
    const task = buildTask();
    mockRequireTelegramBindingForMode.mockResolvedValue({ binding, created: false });
    mockEnqueueTelegramTaskFromMessage.mockResolvedValue({ task, created: true });

    const { handleTelegramUpdate } = await import('../commandRouter');
    await handleTelegramUpdate(buildUpdate('/task review the latest changes'));

    expect(mockRequireTelegramBindingForMode).toHaveBeenCalledWith(42, 'task');
    expect(mockEnqueueTelegramTaskFromMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 99,
        chat: expect.objectContaining({ id: 42 }),
      }),
      'review the latest changes',
      binding,
    );
    expect(mockSendTelegramText).not.toHaveBeenCalled();
  });

  it('returns the existing task status for duplicate /task messages', async () => {
    const binding = buildBinding();
    const task = buildTask({ status: 'running' });
    mockRequireTelegramBindingForMode.mockResolvedValue({ binding, created: false });
    mockEnqueueTelegramTaskFromMessage.mockResolvedValue({ task, created: false });
    mockBuildTelegramTaskStatusText.mockReturnValue('任务状态正文');

    const { handleTelegramUpdate } = await import('../commandRouter');
    await handleTelegramUpdate(buildUpdate('/task review the latest changes'));

    expect(mockSendTelegramText).toHaveBeenCalledWith(
      42,
      expect.stringContaining('已存在'),
      99,
    );
    expect(mockSendTelegramText).toHaveBeenCalledWith(
      42,
      expect.stringContaining('任务状态正文'),
      99,
    );
  });

  it('ignores commands addressed to another bot username', async () => {
    const { handleTelegramUpdate } = await import('../commandRouter');
    await handleTelegramUpdate(buildUpdate('/task@OtherBot should be ignored'));

    expect(mockRequireTelegramBindingForMode).not.toHaveBeenCalled();
    expect(mockEnqueueTelegramTaskFromMessage).not.toHaveBeenCalled();
    expect(mockSendTelegramText).not.toHaveBeenCalled();
  });

  it('returns a placeholder response for /ar commands', async () => {
    const { handleTelegramUpdate } = await import('../commandRouter');
    await handleTelegramUpdate(buildUpdate('/ar status'));

    expect(mockSendTelegramText).toHaveBeenCalledWith(
      42,
      'AutoResearch 的 Telegram 控制面还在下一阶段接入。',
      99,
    );
  });
});