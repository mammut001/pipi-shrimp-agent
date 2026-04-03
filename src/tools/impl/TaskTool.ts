import { z } from 'zod';
import { BaseTool, ToolResult } from '../base/Tool';

/**
 * 任务状态
 */
export type TaskStatus = 'created' | 'pending' | 'running' | 'done' | 'failed' | 'stopped';

/**
 * 任务结构
 */
export interface Task {
  id: string;
  subject: string;
  description?: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  owner?: string;
  blockedBy?: string[];
  blocks?: string[];
  metadata?: Record<string, unknown>;
  output?: string;
  agentId?: string;
}

/**
 * 任务存储
 */
class TaskStore {
  private tasks: Map<string, Task> = new Map();

  create(subject: string, description?: string, metadata?: Record<string, unknown>): Task {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const task: Task = {
      id,
      subject,
      description,
      status: 'created',
      createdAt: now,
      updatedAt: now,
      metadata
    };
    this.tasks.set(id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(filter?: { status?: TaskStatus; owner?: string }): Task[] {
    let tasks = Array.from(this.tasks.values());
    if (filter?.status) {
      tasks = tasks.filter(t => t.status === filter.status);
    }
    if (filter?.owner) {
      tasks = tasks.filter(t => t.owner === filter.owner);
    }
    return tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  update(id: string, updates: Partial<Task>): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const updated = { ...task, ...updates, updatedAt: new Date() };
    this.tasks.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.tasks.delete(id);
  }
}

export const taskStore = new TaskStore();

// ============== Schemas (defined BEFORE classes) ==============

export const TaskCreateInputSchema = z.object({
  subject: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
export const TaskCreateOutputSchema = z.object({
  taskId: z.string(),
  subject: z.string()
});
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;
export type TaskCreateOutput = z.infer<typeof TaskCreateOutputSchema>;

export const TaskGetInputSchema = z.object({ taskId: z.string() });
export const TaskGetOutputSchema = z.object({ task: z.any().nullable() });
export type TaskGetInput = z.infer<typeof TaskGetInputSchema>;
export type TaskGetOutput = z.infer<typeof TaskGetOutputSchema>;

export const TaskListInputSchema = z.object({
  filter: z.object({
    status: z.enum(['created', 'pending', 'running', 'done', 'failed']).optional(),
    owner: z.string().optional()
  }).optional()
});
export const TaskListOutputSchema = z.object({ tasks: z.array(z.any()) });
export type TaskListInput = z.infer<typeof TaskListInputSchema>;
export type TaskListOutput = z.infer<typeof TaskListOutputSchema>;

export const TaskUpdateInputSchema = z.object({
  taskId: z.string(),
  subject: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'stopped']).optional(),
  addBlocks: z.array(z.string()).optional(),
  addBlockedBy: z.array(z.string()).optional()
});
export const TaskUpdateOutputSchema = z.object({
  success: z.boolean(),
  taskId: z.string(),
  updatedFields: z.array(z.string())
});
export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>;
export type TaskUpdateOutput = z.infer<typeof TaskUpdateOutputSchema>;

export const TaskStopInputSchema = z.object({ taskId: z.string() });
export const TaskStopOutputSchema = z.object({
  success: z.boolean(),
  message: z.string()
});
export type TaskStopInput = z.infer<typeof TaskStopInputSchema>;
export type TaskStopOutput = z.infer<typeof TaskStopOutputSchema>;

export const TaskOutputInputSchema = z.object({
  taskId: z.string(),
  stream: z.boolean().optional()
});
export const TaskOutputOutputSchema = z.object({
  output: z.string(),
  done: z.boolean()
});
export type TaskOutputInput = z.infer<typeof TaskOutputInputSchema>;
export type TaskOutputOutput = z.infer<typeof TaskOutputOutputSchema>;

// ============== Tool Implementations ==============

/**
 * TaskCreateTool - 创建任务
 */
export class TaskCreateTool extends BaseTool<TaskCreateInput, TaskCreateOutput> {
  readonly name = 'TaskCreate';
  readonly searchHint = 'create task new task';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = true;

  readonly inputSchema = TaskCreateInputSchema;
  readonly outputSchema = TaskCreateOutputSchema;

  async execute(input: TaskCreateInput): Promise<ToolResult<TaskCreateOutput>> {
    const task = taskStore.create(input.subject, input.description, input.metadata);
    return {
      success: true,
      data: { taskId: task.id, subject: task.subject }
    };
  }
}

/**
 * TaskGetTool - 获取任务
 */
export class TaskGetTool extends BaseTool<TaskGetInput, TaskGetOutput> {
  readonly name = 'TaskGet';
  readonly searchHint = 'get task retrieve task status';
  readonly maxResultSizeChars = 10000;

  readonly inputSchema = TaskGetInputSchema;
  readonly outputSchema = TaskGetOutputSchema;

  async execute(input: TaskGetInput): Promise<ToolResult<TaskGetOutput>> {
    const task = taskStore.get(input.taskId);
    return { success: true, data: { task: task || null } };
  }
}

/**
 * TaskListTool - 列出任务
 */
export class TaskListTool extends BaseTool<TaskListInput, TaskListOutput> {
  readonly name = 'TaskList';
  readonly searchHint = 'list tasks show tasks';
  readonly maxResultSizeChars = 50000;

  readonly inputSchema = TaskListInputSchema;
  readonly outputSchema = TaskListOutputSchema;

  async execute(input: TaskListInput): Promise<ToolResult<TaskListOutput>> {
    const tasks = taskStore.list(input.filter);
    return { success: true, data: { tasks } };
  }
}

/**
 * TaskUpdateTool - 更新任务
 */
export class TaskUpdateTool extends BaseTool<TaskUpdateInput, TaskUpdateOutput> {
  readonly name = 'TaskUpdate';
  readonly searchHint = 'update task change task status';
  readonly maxResultSizeChars = 10000;

  readonly inputSchema = TaskUpdateInputSchema;
  readonly outputSchema = TaskUpdateOutputSchema;

  async execute(input: TaskUpdateInput): Promise<ToolResult<TaskUpdateOutput>> {
    const task = taskStore.update(input.taskId, {
      ...(input.subject && { subject: input.subject }),
      ...(input.description && { description: input.description }),
      ...(input.status && { status: input.status }),
      ...(input.addBlocks && { blocks: input.addBlocks }),
      ...(input.addBlockedBy && { blockedBy: input.addBlockedBy })
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    return {
      success: true,
      data: {
        success: true,
        taskId: task.id,
        updatedFields: Object.keys(input).filter(k => k !== 'taskId')
      }
    };
  }
}

/**
 * TaskStopTool - 停止任务
 */
export class TaskStopTool extends BaseTool<TaskStopInput, TaskStopOutput> {
  readonly name = 'TaskStop';
  readonly searchHint = 'stop task cancel task';
  readonly maxResultSizeChars = 10000;

  readonly inputSchema = TaskStopInputSchema;
  readonly outputSchema = TaskStopOutputSchema;

  async execute(input: TaskStopInput): Promise<ToolResult<TaskStopOutput>> {
    const task = taskStore.update(input.taskId, { status: 'stopped' });
    return {
      success: !!task,
      data: {
        success: !!task,
        message: task ? 'Task stopped' : 'Task not found'
      }
    };
  }
}

/**
 * TaskOutputTool - 获取任务输出
 */
export class TaskOutputTool extends BaseTool<TaskOutputInput, TaskOutputOutput> {
  readonly name = 'TaskOutput';
  readonly searchHint = 'task output result task done';
  readonly maxResultSizeChars = 100000;

  readonly inputSchema = TaskOutputInputSchema;
  readonly outputSchema = TaskOutputOutputSchema;

  async execute(input: TaskOutputInput): Promise<ToolResult<TaskOutputOutput>> {
    const task = taskStore.get(input.taskId);
    return {
      success: true,
      data: {
        output: task?.output || '',
        done: task?.status === 'done' || task?.status === 'failed' || task?.status === 'stopped'
      }
    };
  }
}

/** Grouped container (not registered directly — use individual tools) */
export class TaskTool {
  create = new TaskCreateTool();
  get = new TaskGetTool();
  list = new TaskListTool();
  update = new TaskUpdateTool();
  stop = new TaskStopTool();
  output = new TaskOutputTool();
}

export const taskTool = new TaskTool();


/**
 * 任务状态
 */
export type TaskStatus = 'created' | 'pending' | 'running' | 'done' | 'failed' | 'stopped';

/**
 * 任务结构
 */
export interface Task {
  id: string;
  subject: string;
  description?: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  owner?: string;
  blockedBy?: string[];
  blocks?: string[];
  metadata?: Record<string, unknown>;
  output?: string;
  agentId?: string;
}

/**
 * 任务存储
 */
class TaskStore {
  private tasks: Map<string, Task> = new Map();

  create(subject: string, description?: string, metadata?: Record<string, unknown>): Task {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const task: Task = {
      id,
      subject,
      description,
      status: 'created',
      createdAt: now,
      updatedAt: now,
      metadata
    };
    this.tasks.set(id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(filter?: { status?: TaskStatus; owner?: string }): Task[] {
    let tasks = Array.from(this.tasks.values());
    if (filter?.status) {
      tasks = tasks.filter(t => t.status === filter.status);
    }
    if (filter?.owner) {
      tasks = tasks.filter(t => t.owner === filter.owner);
    }
    return tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  update(id: string, updates: Partial<Task>): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const updated = {
      ...task,
      ...updates,
      updatedAt: new Date()
    };
    this.tasks.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.tasks.delete(id);
  }
}

export const taskStore = new TaskStore();

// ============== Tool Implementations ==============

/**
 * TaskCreateTool - 创建任务
 */
export class TaskCreateTool extends BaseTool<TaskCreateInput, TaskCreateOutput> {
  readonly name = 'TaskCreate';
  readonly searchHint = 'create task new task';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = true;

  readonly inputSchema = TaskCreateInputSchema;
  readonly outputSchema = TaskCreateOutputSchema;

  async execute(input: TaskCreateInput): Promise<ToolResult<TaskCreateOutput>> {
    const task = taskStore.create(input.subject, input.description, input.metadata);
    return {
      success: true,
      data: {
        taskId: task.id,
        subject: task.subject
      }
    };
  }
}

/**
 * TaskGetTool - 获取任务
 */
export class TaskGetTool extends BaseTool<TaskGetInput, TaskGetOutput> {
  readonly name = 'TaskGet';
  readonly searchHint = 'get task retrieve task status';
  readonly maxResultSizeChars = 10000;

  readonly inputSchema = TaskGetInputSchema;
  readonly outputSchema = TaskGetOutputSchema;

  async execute(input: TaskGetInput): Promise<ToolResult<TaskGetOutput>> {
    const task = taskStore.get(input.taskId);
    return {
      success: true,
      data: { task: task || null }
    };
  }
}

/**
 * TaskListTool - 列出任务
 */
export class TaskListTool extends BaseTool<TaskListInput, TaskListOutput> {
  readonly name = 'TaskList';
  readonly searchHint = 'list tasks show tasks';
  readonly maxResultSizeChars = 50000;

  readonly inputSchema = TaskListInputSchema;
  readonly outputSchema = TaskListOutputSchema;

  async execute(input: TaskListInput): Promise<ToolResult<TaskListOutput>> {
    const tasks = taskStore.list(input.filter);
    return {
      success: true,
      data: { tasks }
    };
  }
}

/**
 * TaskUpdateTool - 更新任务
 */
export class TaskUpdateTool extends BaseTool<TaskUpdateInput, TaskUpdateOutput> {
  readonly name = 'TaskUpdate';
  readonly searchHint = 'update task change task status';
  readonly maxResultSizeChars = 10000;

  readonly inputSchema = TaskUpdateInputSchema;
  readonly outputSchema = TaskUpdateOutputSchema;

  async execute(input: TaskUpdateInput): Promise<ToolResult<TaskUpdateOutput>> {
    const task = taskStore.update(input.taskId, {
      ...(input.subject && { subject: input.subject }),
      ...(input.description && { description: input.description }),
      ...(input.status && { status: input.status }),
      ...(input.addBlocks && { blocks: input.addBlocks }),
      ...(input.addBlockedBy && { blockedBy: input.addBlockedBy })
    });

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    return {
      success: true,
      data: {
        success: true,
        taskId: task.id,
        updatedFields: Object.keys(input).filter(k => k !== 'taskId')
      }
    };
  }
}

/**
 * TaskStopTool - 停止任务
 */
export class TaskStopTool extends BaseTool<TaskStopInput, TaskStopOutput> {
  readonly name = 'TaskStop';
  readonly searchHint = 'stop task cancel task';
  readonly maxResultSizeChars = 10000;

  readonly inputSchema = TaskStopInputSchema;
  readonly outputSchema = TaskStopOutputSchema;

  async execute(input: TaskStopInput): Promise<ToolResult<TaskStopOutput>> {
    const task = taskStore.update(input.taskId, { status: 'stopped' });
    return {
      success: !!task,
      data: {
        success: !!task,
        message: task ? 'Task stopped' : 'Task not found'
      }
    };
  }
}

/**
 * TaskOutputTool - 获取任务输出
 */
export class TaskOutputTool extends BaseTool<TaskOutputInput, TaskOutputOutput> {
  readonly name = 'TaskOutput';
  readonly searchHint = 'task output result task done';
  readonly maxResultSizeChars = 100000;

  readonly inputSchema = TaskOutputInputSchema;
  readonly outputSchema = TaskOutputOutputSchema;

  async execute(input: TaskOutputInput): Promise<ToolResult<TaskOutputOutput>> {
    const task = taskStore.get(input.taskId);
    return {
      success: true,
      data: {
        output: task?.output || '',
        done: task?.status === 'done' || task?.status === 'failed' || task?.status === 'stopped'
      }
    };
  }
}

// ============== Schema 定义 ==============

export const TaskCreateInputSchema = z.object({
  subject: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const TaskCreateOutputSchema = z.object({
  taskId: z.string(),
  subject: z.string()
});

export const TaskGetInputSchema = z.object({ taskId: z.string() });
export const TaskGetOutputSchema = z.object({ task: z.any().nullable() });

export const TaskListInputSchema = z.object({
  filter: z.object({
    status: z.enum(['created', 'pending', 'running', 'done', 'failed']).optional(),
    owner: z.string().optional()
  }).optional()
});

export const TaskListOutputSchema = z.object({ tasks: z.array(z.any()) });

export const TaskUpdateInputSchema = z.object({
  taskId: z.string(),
  subject: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'stopped']).optional(),
  addBlocks: z.array(z.string()).optional(),
  addBlockedBy: z.array(z.string()).optional()
});

export const TaskUpdateOutputSchema = z.object({
  success: z.boolean(),
  taskId: z.string(),
  updatedFields: z.array(z.string())
});

export const TaskStopInputSchema = z.object({ taskId: z.string() });
export const TaskStopOutputSchema = z.object({
  success: z.boolean(),
  message: z.string()
});

export const TaskOutputInputSchema = z.object({
  taskId: z.string(),
  stream: z.boolean().optional()
});
export const TaskOutputOutputSchema = z.object({
  output: z.string(),
  done: z.boolean()
});

export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;
export type TaskCreateOutput = z.infer<typeof TaskCreateOutputSchema>;

// 统一导出 TaskTool (包含所有子工具)
export class TaskTool {
  create = new TaskCreateTool();
  get = new TaskGetTool();
  list = new TaskListTool();
  update = new TaskUpdateTool();
  stop = new TaskStopTool();
  output = new TaskOutputTool();
}

export const taskTool = new TaskTool();
