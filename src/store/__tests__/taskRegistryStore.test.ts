import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  registerDiagnosticsTask,
  registerDiagnosticsTaskCancel,
  updateDiagnosticsTask,
  useTaskRegistryStore,
} from '../taskRegistryStore';

describe('taskRegistryStore', () => {
  beforeEach(() => {
    useTaskRegistryStore.getState().clearTasks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    useTaskRegistryStore.getState().clearTasks();
  });

  it('cancels a registered task and clears the cancelable flag', async () => {
    const cancelHandler = jest.fn(async () => undefined);

    registerDiagnosticsTask({
      id: 'chat-task-1',
      kind: 'chat',
      source: 'session:test',
      state: 'created',
      cancelable: false,
    });
    registerDiagnosticsTaskCancel('chat-task-1', cancelHandler);
    updateDiagnosticsTask('chat-task-1', {
      state: 'running',
      cancelable: true,
    });

    const cancelled = await useTaskRegistryStore.getState().cancelTask('chat-task-1');
    const task = useTaskRegistryStore.getState().tasks.find((candidate) => candidate.id === 'chat-task-1');

    expect(cancelled).toBe(true);
    expect(cancelHandler).toHaveBeenCalledTimes(1);
    expect(task).toMatchObject({
      id: 'chat-task-1',
      state: 'cancelled',
      cancelable: false,
    });
  });

  it('keeps the most recently updated task at the top of the list', () => {
    registerDiagnosticsTask({
      id: 'older-task',
      kind: 'workflow',
      source: 'instance:1',
      createdAt: 10,
      state: 'created',
    });
    registerDiagnosticsTask({
      id: 'newer-task',
      kind: 'browser',
      source: 'https://example.com',
      createdAt: 20,
      state: 'created',
    });

    updateDiagnosticsTask('older-task', {
      state: 'running',
      cancelable: false,
    });

    expect(useTaskRegistryStore.getState().tasks.map((task) => task.id)).toEqual([
      'older-task',
      'newer-task',
    ]);
  });
});
