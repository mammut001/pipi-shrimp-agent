import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * 文本搜索工具 (grep)
 */
export class GrepTool extends BaseTool<GrepInput, GrepOutput> {
  readonly name = 'Grep';
  readonly aliases = ['Search', 'grep', 'rg', 'SearchTool'];
  readonly searchHint = 'grep search text find pattern';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = false;
  readonly alwaysLoad = true;

  readonly inputSchema = GrepInputSchema;
  readonly outputSchema = GrepOutputSchema;

  async execute(input: GrepInput, context: ToolContext): Promise<ToolResult<GrepOutput>> {
    try {
      // search_files returns JSON string of rg --json output
      const raw = await invoke<string>('search_files', {
        pattern: input.pattern,
        path: input.path || context.cwd || '.',
        extensions: input.glob ? [input.glob.replace(/^\*\./, '')] : undefined,
        workDir: context.cwd || undefined
      });

      let rgResults: RgMatch[] = [];
      try {
        rgResults = JSON.parse(raw);
      } catch {
        rgResults = [];
      }

      // Parse rg --json match objects
      const head = input.head_limit ?? 250;
      const offset = input.offset ?? 0;

      const matches: GrepMatch[] = rgResults
        .slice(offset, offset + head)
        .map(r => ({
          file: r.data?.path?.text || '',
          line: r.data?.line_number || 0,
          content: r.data?.lines?.text?.replace(/\n$/, '') || ''
        }))
        .filter(m => m.file);

      const fileSet = new Set(matches.map(m => m.file));

      return {
        success: true,
        data: {
          matches,
          numMatches: matches.length,
          numFiles: fileSet.size,
          truncated: rgResults.length > head
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async describe(_input?: GrepInput): Promise<string> {
    return `Search for text patterns in files. Supports regex, context lines, and various output modes.`;
  }

  isReadOnly(): boolean {
    return true;
  }

  isConcurrencySafe(): boolean {
    return true;
  }
}

// ============== Schema 定义 ==============

export const GrepInputSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path: z.string().optional().describe('Path to search in'),
  glob: z.string().optional().describe('Filter files by glob pattern'),
  output_mode: z.enum(['content', 'files_with_matches', 'count']),
  '-B': z.number().optional().describe('Lines before match'),
  '-A': z.number().optional().describe('Lines after match'),
  '-C': z.number().optional().describe('Context lines around match'),
  '-n': z.boolean().optional().describe('Show line numbers'),
  '-i': z.boolean().optional().describe('Case insensitive'),
  head_limit: z.number().optional().describe('Maximum number of matches'),
  offset: z.number().optional().describe('Offset for pagination')
});

export const GrepOutputSchema = z.object({
  matches: z.array(z.object({
    file: z.string(),
    line: z.number(),
    content: z.string(),
    context: z.array(z.string()).optional()
  })),
  numMatches: z.number(),
  numFiles: z.number(),
  truncated: z.boolean()
});

export type GrepInput = z.infer<typeof GrepInputSchema>;
export type GrepOutput = z.infer<typeof GrepOutputSchema>;

type GrepMatch = z.infer<typeof GrepOutputSchema>['matches'][number];

// rg --json match shape
interface RgMatch {
  type?: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

// 导出单例
export const grepTool = new GrepTool();
