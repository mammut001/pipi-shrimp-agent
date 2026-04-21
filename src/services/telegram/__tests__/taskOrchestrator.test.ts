import type { TelegramMessage } from '@/types/telegram';
import type { TelegramBinding, TelegramTask } from '@/types/telegramTask';

const mockInvoke = jest.fn();
const mockRunHeadlessAgentTurn = jest.fn();
const mockBuildHeadlessSystemPrompt = jest.fn();
const mockSendTelegramTaskAcknowledged = jest.fn();
const mockSendTelegramTaskCompleted = jest.fn();
const mockSendTelegramTaskFailed = jest.fn();
const mockSendTelegramTaskWaitingReview = jest.fn();
const mockAppendTelegramTaskError = jest.fn();
const mockAppendTelegramTaskResult = jest.fn();
const mockCreateTelegramTaskSession = jest.fn();
const mockUpdateTelegramTaskSessionWorkDir = jest.fn();
const mockFindTelegramTaskBySource = jest.fn();
const mockGetTelegramBinding = jest.fn();
const mockListTelegramTasksByStatuses = jest.fn();
const mockListTelegramTasksForChat = jest.fn();
const mockSaveTelegramTask = jest.fn();

const chatStoreState = {
  currentSession: () => ({
    id: 'current-session',
    projectId: 'project-1',
    workDir: '/current/workdir',
    model: 'gpt-test',
    permissionMode: 'bypass',
  }),
};

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@/store', () => ({
  useChatStore: {
    getState: () => chatStoreState,
  },
}));

jest.mock('@/services/headless/agentRunner', () => ({
  runHeadlessAgentTurn: (...args: unknown[]) => mockRunHeadlessAgentTurn(...args),
}));

jest.mock('@/services/headless/systemPrompt', () => ({
  buildHeadlessSystemPrompt: (...args: unknown[]) => mockBuildHeadlessSystemPrompt(...args),
}));

jest.mock('@/services/telegram/resultNotifier', () => ({
  sendTelegramTaskAcknowledged: (...args: unknown[]) => mockSendTelegramTaskAcknowledged(...args),
  sendTelegramTaskCompleted: (...args: unknown[]) => mockSendTelegramTaskCompleted(...args),
  sendTelegramTaskFailed: (...args: unknown[]) => mockSendTelegramTaskFailed(...args),
  sendTelegramTaskWaitingReview: (...args: unknown[]) => mockSendTelegramTaskWaitingReview(...args),
}));

jest.mock('@/services/telegram/sessionMirror', () => ({
  appendTelegramTaskError: (...args: unknown[]) => mockAppendTelegramTaskError(...args),
  appendTelegramTaskResult: (...args: unknown[]) => mockAppendTelegramTaskResult(...args),
  createTelegramTaskSession: (...args: unknown[]) => mockCreateTelegramTaskSession(...args),
  updateTelegramTaskSessionWorkDir: (...args: unknown[]) => mockUpdateTelegramTaskSessionWorkDir(...args),
}));

jest.mock('@/services/telegram/taskService', () => ({
  findTelegramTaskBySource: (...args: unknown[]) => mockFindTelegramTaskBySource(...args),
  getTelegramBinding: (...args: unknown[]) => mockGetTelegramBinding(...args),
  listTelegramTasksByStatuses: (...args: unknown[]) => mockListTelegramTasksByStatuses(...args),
  listTelegramTasksForChat: (...args: unknown[]) => mockListTelegramTasksForChat(...args),
  saveTelegramTask: (...args: unknown[]) => mockSaveTelegramTask(...args),
}));

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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

function buildMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    messageId: 77,
    chat: {
      id: 42,
      type: 'private',
      firstName: 'Owner',
    },
    date: 1,
    text: '/task summarize the repo',
    ...overrides,
  };
}

function buildTask(overrides: Partial<TelegramTask> = {}): TelegramTask {
  return {
    id: 'task-12345678',
    chatId: 42,
    sourceMessageId: 77,
    type: 'standard',
    status: 'acknowledged',
    prompt: 'summarize the repo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('Telegram task orchestrator', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockFindTelegramTaskBySource.mockResolvedValue(null);
    mockGetTelegramBinding.mockResolvedValue(buildBinding());
    mockListTelegramTasksByStatuses.mockResolvedValue([]);
    mockListTelegramTasksForChat.mockResolvedValue([]);
    mockSaveTelegramTask.mockResolvedValue(undefined);
    mockSendTelegramTaskAcknowledged.mockResolvedValue(undefined);
    mockSendTelegramTaskCompleted.mockResolvedValue(undefined);
    mockSendTelegramTaskFailed.mockResolvedValue(undefined);
    mockSendTelegramTaskWaitingReview.mockResolvedValue(undefined);
    mockAppendTelegramTaskError.mockResolvedValue(undefined);
    mockAppendTelegramTaskResult.mockResolvedValue(undefined);
    mockCreateTelegramTaskSession.mockResolvedValue({
      id: 'session-1',
      workDir: '/telegram/workdir',
      workingFiles: ['README.md'],
    });
    mockUpdateTelegramTaskSessionWorkDir.mockResolvedValue(undefined);
    mockBuildHeadlessSystemPrompt.mockResolvedValue('system prompt');
    mockRunHeadlessAgentTurn.mockResolvedValue({
      finalText: 'Execution summary',
      finalReasoning: '',
    });
    mockInvoke.mockResolvedValue('/fallback/workdir');
  });

  it('reuses an existing task for the same source message', async () => {
    const existingTask = buildTask({ status: 'running' });
    mockFindTelegramTaskBySource.mockResolvedValue(existingTask);

    const { enqueueTelegramTaskFromMessage } = await import('../taskOrchestrator');
    const result = await enqueueTelegramTaskFromMessage(buildMessage(), 'summarize the repo', buildBinding());

    expect(result).toEqual({ task: existingTask, created: false });
    expect(mockSaveTelegramTask).not.toHaveBeenCalled();
    expect(mockSendTelegramTaskAcknowledged).not.toHaveBeenCalled();
  });

  it('creates an acknowledged task and starts draining when autoRun is enabled', async () => {
    jest.spyOn(global.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');

    const { enqueueTelegramTaskFromMessage } = await import('../taskOrchestrator');
    const result = await enqueueTelegramTaskFromMessage(buildMessage(), 'summarize the repo', buildBinding());
    await flushPromises();

    expect(result.created).toBe(true);
    expect(mockSaveTelegramTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        status: 'acknowledged',
        prompt: 'summarize the repo',
      }),
    );
    expect(mockSendTelegramTaskAcknowledged).toHaveBeenCalledWith(
      expect.objectContaining({ id: '00000000-0000-4000-8000-000000000001' }),
    );
  });

  it('executes queued tasks and stores a completed summary', async () => {
    const queuedTask = buildTask({ id: 'task-run', status: 'queued' });
    mockListTelegramTasksByStatuses
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([queuedTask])
      .mockResolvedValueOnce([]);

    const { startTelegramTaskRuntime } = await import('../taskOrchestrator');
    await startTelegramTaskRuntime();
    await flushPromises();
    await flushPromises();

    expect(mockCreateTelegramTaskSession).toHaveBeenCalledWith(queuedTask, expect.any(Object));
    expect(mockBuildHeadlessSystemPrompt).toHaveBeenCalledWith({
      workDir: '/telegram/workdir',
      workingFiles: ['README.md'],
      originalQuery: 'summarize the repo',
    });
    expect(mockRunHeadlessAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        workDir: '/telegram/workdir',
        initialMessages: [
          {
            role: 'user',
            content: 'summarize the repo',
          },
        ],
      }),
    );
    expect(mockAppendTelegramTaskResult).toHaveBeenCalledWith('session-1', 'Execution summary');
    expect(mockSaveTelegramTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'task-run',
        status: 'running',
        localSessionId: 'session-1',
      }),
    );
    expect(mockSaveTelegramTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'task-run',
        status: 'completed',
        resultSummary: 'Execution summary',
      }),
    );
    expect(mockSendTelegramTaskCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-run',
        status: 'completed',
      }),
    );
  });

  it('marks in-flight tasks as interrupted when the runtime restarts', async () => {
    const runningTask = buildTask({ id: 'task-running', status: 'running' });
    mockListTelegramTasksByStatuses
      .mockResolvedValueOnce([runningTask])
      .mockResolvedValueOnce([]);

    const { startTelegramTaskRuntime } = await import('../taskOrchestrator');
    await startTelegramTaskRuntime();
    await flushPromises();

    expect(mockSaveTelegramTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-running',
        status: 'interrupted',
        errorMessage: '桌面端在任务执行过程中断开了。请重新发送 /task。',
      }),
    );
  });

  it('resolves task references by prefix and falls back to the latest task', async () => {
    const latestTask = buildTask({ id: 'abcdef12-task', createdAt: 3 });
    const olderTask = buildTask({ id: '12345678-task', createdAt: 2 });
    mockListTelegramTasksForChat.mockResolvedValue([latestTask, olderTask]);

    const { getTelegramTaskForReference } = await import('../taskOrchestrator');

    await expect(getTelegramTaskForReference(42)).resolves.toEqual(latestTask);
    await expect(getTelegramTaskForReference(42, '1234')).resolves.toEqual(olderTask);
    await expect(getTelegramTaskForReference(42, 'missing')).resolves.toBeNull();
  });
});