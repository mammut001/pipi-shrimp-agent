import { create } from 'zustand';

export type DiagnosticsTaskKind = 'chat' | 'workflow' | 'swarm' | 'telegram' | 'browser';
export type DiagnosticsTaskState = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DiagnosticsTask {
  id: string;
  kind: DiagnosticsTaskKind;
  state: DiagnosticsTaskState;
  source: string;
  createdAt: number;
  updatedAt: number;
  cancelable: boolean;
  title?: string;
  detail?: string;
  error?: string;
}

interface DiagnosticsTaskInput {
  id: string;
  kind: DiagnosticsTaskKind;
  source: string;
  createdAt?: number;
  state?: DiagnosticsTaskState;
  cancelable?: boolean;
  title?: string;
  detail?: string;
  error?: string;
}

interface DiagnosticsTaskStateUpdate {
  state: DiagnosticsTaskState;
  cancelable?: boolean;
  detail?: string;
  error?: string;
}

interface TaskRegistryState {
  tasks: DiagnosticsTask[];
  upsertTask: (input: DiagnosticsTaskInput) => void;
  updateTaskState: (taskId: string, update: DiagnosticsTaskStateUpdate) => void;
  setTaskCancelable: (taskId: string, cancelable: boolean) => void;
  clearTasks: () => void;
  cancelTask: (taskId: string) => Promise<boolean>;
}

const MAX_TASKS = 500;

const cancelHandlers = new Map<string, () => void | Promise<void>>();

function sortTasks(tasks: DiagnosticsTask[]): DiagnosticsTask[] {
  return [...tasks]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_TASKS);
}

function createTaskRecord(input: DiagnosticsTaskInput): DiagnosticsTask {
  const timestamp = input.createdAt ?? Date.now();
  return {
    id: input.id,
    kind: input.kind,
    state: input.state ?? 'created',
    source: input.source,
    createdAt: timestamp,
    updatedAt: timestamp,
    cancelable: Boolean(input.cancelable),
    title: input.title,
    detail: input.detail,
    error: input.error,
  };
}

export const useTaskRegistryStore = create<TaskRegistryState>((set) => ({
  tasks: [],

  upsertTask: (input) => {
    set((state) => {
      const existing = state.tasks.find((task) => task.id === input.id);
      if (!existing) {
        return {
          tasks: sortTasks([...state.tasks, createTaskRecord(input)]),
        };
      }

      return {
        tasks: sortTasks(state.tasks.map((task) => (
          task.id === input.id
            ? {
                ...task,
                kind: input.kind,
                source: input.source,
                state: input.state ?? task.state,
                cancelable: input.cancelable ?? task.cancelable,
                title: input.title ?? task.title,
                detail: input.detail ?? task.detail,
                error: input.error ?? task.error,
                updatedAt: Date.now(),
              }
            : task
        ))),
      };
    });
  },

  updateTaskState: (taskId, update) => {
    set((state) => ({
      tasks: sortTasks(state.tasks.map((task) => (
        task.id === taskId
          ? {
              ...task,
              state: update.state,
              cancelable: update.cancelable ?? task.cancelable,
              detail: update.detail ?? task.detail,
              error: update.error ?? task.error,
              updatedAt: Date.now(),
            }
          : task
      ))),
    }));

    if (update.state === 'completed' || update.state === 'failed' || update.state === 'cancelled') {
      cancelHandlers.delete(taskId);
    }
  },

  setTaskCancelable: (taskId, cancelable) => {
    set((state) => ({
      tasks: sortTasks(state.tasks.map((task) => (
        task.id === taskId
          ? {
              ...task,
              cancelable,
              updatedAt: Date.now(),
            }
          : task
      ))),
    }));

    if (!cancelable) {
      cancelHandlers.delete(taskId);
    }
  },

  clearTasks: () => {
    cancelHandlers.clear();
    set({ tasks: [] });
  },

  cancelTask: async (taskId) => {
    const handler = cancelHandlers.get(taskId);
    if (!handler) {
      return false;
    }

    await handler();
    set((state) => ({
      tasks: sortTasks(state.tasks.map((task) => (
        task.id === taskId
          ? {
              ...task,
              state: 'cancelled',
              cancelable: false,
              updatedAt: Date.now(),
            }
          : task
      ))),
    }));
    cancelHandlers.delete(taskId);
    return true;
  },
}));

export function registerDiagnosticsTask(input: DiagnosticsTaskInput): void {
  useTaskRegistryStore.getState().upsertTask(input);
}

export function updateDiagnosticsTask(taskId: string, update: DiagnosticsTaskStateUpdate): void {
  useTaskRegistryStore.getState().updateTaskState(taskId, update);
}

export function registerDiagnosticsTaskCancel(taskId: string, handler?: () => void | Promise<void>): void {
  if (!handler) {
    cancelHandlers.delete(taskId);
    useTaskRegistryStore.getState().setTaskCancelable(taskId, false);
    return;
  }

  cancelHandlers.set(taskId, handler);
  useTaskRegistryStore.getState().setTaskCancelable(taskId, true);
}
