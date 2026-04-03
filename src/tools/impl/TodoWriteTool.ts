import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * TodoWriteTool - 管理 Todo 列表
 *
 * Based on Claude Code's TodoWriteTool
 */
export class TodoWriteTool extends BaseTool<TodoWriteInput, TodoWriteOutput> {
  readonly name = 'TodoWrite';
  readonly aliases = ['Todos', 'WriteTodos', 'UpdateTodos'];
  readonly searchHint = 'todo list tasks write update';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = false;
  readonly alwaysLoad = true;

  readonly inputSchema = TodoWriteInputSchema;
  readonly outputSchema = TodoWriteOutputSchema;

  async execute(input: TodoWriteInput, _context: ToolContext): Promise<ToolResult<TodoWriteOutput>> {
    // Store todos in-memory
    todoStore.write(input.todos);
    return {
      success: true,
      data: {
        success: true,
        updatedCount: input.todos.length
      }
    };
  }

  async describe(_input?: TodoWriteInput): Promise<string> {
    return `Write and manage a todo list. Updates replace the entire list. Use to track progress on multi-step tasks.`;
  }

  isConcurrencySafe(): boolean {
    return false;
  }
}

// Simple in-memory store for todos
class TodoStore {
  private todos: TodoItem[] = [];

  write(todos: TodoItem[]): void {
    this.todos = todos;
  }

  read(): TodoItem[] {
    return this.todos;
  }
}

export const todoStore = new TodoStore();

// ============== Schema ==============

export const TodoWriteInputSchema = z.object({
  todos: z.array(z.object({
    content: z.string().describe('Todo item text'),
    status: z.enum(['pending', 'in_progress', 'completed']).describe('Current status'),
    activeForm: z.string().optional().describe('Note about current progress')
  }))
});

export const TodoWriteOutputSchema = z.object({
  success: z.boolean(),
  updatedCount: z.number()
});

export type TodoItem = z.infer<typeof TodoWriteInputSchema>['todos'][number];
export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;
export type TodoWriteOutput = z.infer<typeof TodoWriteOutputSchema>;

export const todoWriteTool = new TodoWriteTool();
