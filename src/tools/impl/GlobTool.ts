import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * 文件搜索工具 (glob pattern)
 */
export class GlobTool extends BaseTool<GlobInput, GlobOutput> {
  readonly name = 'Glob';
  readonly aliases = ['GlobTool', 'FindFiles', 'file_glob'];
  readonly searchHint = 'glob find files pattern search';
  readonly maxResultSizeChars = 20000;
  readonly shouldDefer = false;
  readonly alwaysLoad = true;

  readonly inputSchema = GlobInputSchema;
  readonly outputSchema = GlobOutputSchema;

  async execute(input: GlobInput, context: ToolContext): Promise<ToolResult<GlobOutput>> {
    try {
      const startTime = Date.now();

      // glob_search returns a JSON string of file paths
      const raw = await invoke<string>('glob_search', {
        pattern: input.pattern,
        path: input.path || context.cwd || '.',
        workDir: context.cwd || undefined
      });

      let filenames: string[] = [];
      try {
        filenames = JSON.parse(raw);
      } catch {
        filenames = [];
      }

      const LIMIT = 100;
      const truncated = filenames.length >= LIMIT;
      const limited = filenames.slice(0, LIMIT);

      return {
        success: true,
        data: {
          filenames: limited,
          numFiles: limited.length,
          truncated,
          durationMs: Date.now() - startTime
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async describe(_input?: GlobInput): Promise<string> {
    return `Find files matching a glob pattern. Supports **, *, ?, etc.`;
  }

  isReadOnly(): boolean {
    return true;
  }

  isConcurrencySafe(): boolean {
    return true;
  }
}

// ============== Schema 定义 ==============

export const GlobInputSchema = z.object({
  pattern: z.string().describe('Glob pattern to match files (e.g., **/*.ts)'),
  path: z.string().optional().describe('Base path to search from')
});

export const GlobOutputSchema = z.object({
  filenames: z.array(z.string()),
  numFiles: z.number(),
  truncated: z.boolean(),
  durationMs: z.number()
});

export type GlobInput = z.infer<typeof GlobInputSchema>;
export type GlobOutput = z.infer<typeof GlobOutputSchema>;



// 导出单例
export const globTool = new GlobTool();
