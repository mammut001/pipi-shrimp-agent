import { z } from 'zod';
import { toolRegistry } from '../core/ToolRegistry';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * 工具搜索工具
 * 允许通过自然语言查询找到合适的工具
 */
export class ToolSearchTool extends BaseTool<ToolSearchInput, ToolSearchOutput> {
  readonly name = 'ToolSearch';
  readonly aliases = ['FindTool', 'SearchTool', 'WhichTool'];
  readonly searchHint = 'find tool search which tool';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = true;  // 需要被 ToolSearch 发现

  readonly inputSchema = ToolSearchInputSchema;
  readonly outputSchema = ToolSearchOutputSchema;

  async execute(input: ToolSearchInput, _context: ToolContext): Promise<ToolResult<ToolSearchOutput>> {
    try {
      // 获取延迟加载的工具数量
      const deferredTools = toolRegistry.getDeferredTools();

      // 搜索匹配的工具
      const matches = toolRegistry.search(input.query, input.max_results);

      return {
        success: true,
        data: {
          matches: await Promise.all(matches.map(async tool => ({
            toolName: tool.name,
            description: await tool.describe(),
            relevance: 1.0
          }))),
          query: input.query,
          total_deferred_tools: deferredTools.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async describe(_input?: ToolSearchInput): Promise<string> {
    return `Search for available tools by keyword or description. Use this when you need to find the right tool for a task.`;
  }

  isConcurrencySafe(_input: ToolSearchInput): boolean {
    return true;
  }

  isReadOnly(_input: ToolSearchInput): boolean {
    return true;
  }
}

// ============== Schema 定义 ==============

export const ToolSearchInputSchema = z.object({
  query: z.string().describe('Search query to find tools'),
  max_results: z.number().int().positive().optional().default(5).describe('Maximum number of results')
});

export const ToolSearchOutputSchema = z.object({
  matches: z.array(z.object({
    toolName: z.string(),
    description: z.string(),
    relevance: z.number()
  })),
  query: z.string(),
  total_deferred_tools: z.number()
});

export type ToolSearchInput = z.infer<typeof ToolSearchInputSchema>;
export type ToolSearchOutput = z.infer<typeof ToolSearchOutputSchema>;

// 导出单例
export const toolSearchTool = new ToolSearchTool();
