import { z } from 'zod';

/**
 * 工具执行结果
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: ToolResultMetadata;
}

export interface ToolResultMetadata {
  durationMs?: number;
  cached?: boolean;
  truncated?: boolean;
}

/**
 * 工具执行上下文
 */
export interface ToolContext {
  abortSignal: AbortSignal;
  sessionId: string;
  messages: ToolMessage[];
  tools: Map<string, Tool>;
  cwd: string;
  settings: ToolSettings;
  permissions: PermissionContext;
}

export interface ToolSettings {
  maxTokens?: number;
  temperature?: number;
  maxResultSizeChars?: number;
  sandboxEnabled?: boolean;
  maxSearchUses?: number;  // Max uses for WebSearchTool per session
}

export interface PermissionContext {
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowedPaths?: string[];
  blockedPaths?: string[];
  dangerousCommandsAllowed?: boolean;
}

export interface ToolMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: unknown;
}

/**
 * 权限检查结果
 */
export interface PermissionResult {
  granted: boolean;
  reason?: string;
  requiresApproval?: boolean;
  approvedBy?: string;
}

/**
 * 输入验证结果
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

/**
 * 工具基类接口
 */
export interface Tool<Input = unknown, Output = unknown> {
  // 工具标识
  readonly name: string;
  readonly aliases?: string[];
  readonly searchHint?: string;

  // 资源限制
  readonly maxResultSizeChars: number;

  // 加载策略
  readonly shouldDefer?: boolean;
  readonly alwaysLoad?: boolean;

  // Schema
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema?: z.ZodType<Output>;

  // 核心方法
  execute(input: Input, context: ToolContext): Promise<ToolResult<Output>>;
  describe(input?: Input): Promise<string>;

  // 可选方法
  validateInput?(input: Input, context: ToolContext): Promise<ValidationResult>;
  checkPermissions?(input: Input, context: ToolContext): Promise<PermissionResult>;
  isConcurrencySafe?(input: Input): boolean;
  isReadOnly?(input: Input): boolean;
  isDestructive?(input: Input): boolean;

  // UI 渲染
  renderToolResult?(result: ToolResult<Output>): unknown;
  renderToolUse?(input: Input): unknown;
}

/**
 * 工具类基础实现
 */
export abstract class BaseTool<Input, Output> implements Tool<Input, Output> {
  abstract readonly name: string;
  abstract readonly inputSchema: z.ZodType<Input>;
  readonly maxResultSizeChars: number = 100000;

  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  aliases?: string[];
  searchHint?: string;
  outputSchema?: z.ZodType<Output>;

  abstract execute(input: Input, context: ToolContext): Promise<ToolResult<Output>>;

  async describe(_input?: Input): Promise<string> {
    return `Tool: ${this.name}`;
  }

  isConcurrencySafe(_input: Input): boolean {
    return false;
  }

  isReadOnly(_input: Input): boolean {
    return false;
  }

  isDestructive(_input: Input): boolean {
    return false;
  }
}
