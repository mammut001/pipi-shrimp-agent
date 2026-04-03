import { ToolRegistry } from './ToolRegistry';
import { ToolContext, ToolResult } from '../base/Tool';

/**
 * 工具执行器
 * 负责工具的执行、权限检查、输入验证
 */
export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private context: ToolContext
  ) {}

  /**
   * 执行单个工具
   */
  async execute(toolName: string, input: unknown): Promise<ToolResult> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`
      };
    }

    const startTime = Date.now();

    try {
      // 1. 解析输入
      let parsedInput: unknown;
      try {
        parsedInput = tool.inputSchema.parse(input);
      } catch (e) {
        return {
          success: false,
          error: `Invalid input: ${(e as Error).message}`,
          metadata: { durationMs: Date.now() - startTime }
        };
      }

      // 2. 验证输入
      if (tool.validateInput) {
        const validation = await tool.validateInput(parsedInput as any, this.context);
        if (!validation.valid) {
          return {
            success: false,
            error: validation.error || 'Validation failed',
            metadata: { durationMs: Date.now() - startTime }
          };
        }
      }

      // 3. 权限检查
      if (tool.checkPermissions) {
        const permission = await tool.checkPermissions(parsedInput as any, this.context);
        if (!permission.granted) {
          return {
            success: false,
            error: permission.reason || 'Permission denied',
            metadata: { durationMs: Date.now() - startTime }
          };
        }
      }

      // 4. 执行
      const result = await tool.execute(parsedInput as any, this.context);

      return {
        ...result,
        metadata: {
          ...result.metadata,
          durationMs: Date.now() - startTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        metadata: { durationMs: Date.now() - startTime }
      };
    }
  }

  /**
   * 并发执行多个工具
   */
  async executeConcurrent(
    tools: Array<{ name: string; input: unknown }>
  ): Promise<ToolResult[]> {
    // 过滤出支持并发的工具
    const safeTools = tools.filter(t => {
      const tool = this.registry.get(t.name);
      return tool?.isConcurrencySafe?.(t.input) ?? false;
    });

    const unsafeTools = tools.filter(t => {
      const tool = this.registry.get(t.name);
      return !(tool?.isConcurrencySafe?.(t.input) ?? false);
    });

    // 并发执行安全的工具
    const safeResults = await Promise.all(
      safeTools.map(t => this.execute(t.name, t.input))
    );

    // 顺序执行不安全的工具
    const unsafeResults: ToolResult[] = [];
    for (const t of unsafeTools) {
      unsafeResults.push(await this.execute(t.name, t.input));
    }

    return [...safeResults, ...unsafeResults];
  }

  /**
   * 创建带超时的执行
   */
  async executeWithTimeout(
    toolName: string,
    input: unknown,
    timeoutMs: number
  ): Promise<ToolResult> {
    const timeoutPromise = new Promise<ToolResult>((_, reject) => {
      setTimeout(() => reject(new Error('Tool execution timed out')), timeoutMs);
    });

    const executePromise = this.execute(toolName, input);

    return Promise.race([executePromise, timeoutPromise]).catch(error => ({
      success: false,
      error: error.message,
      metadata: { durationMs: timeoutMs }
    }));
  }
}
