import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * WebFetchTool - 抓取网页内容
 *
 * Fetches a URL and returns structured content.
 * Based on Claude Code's WebFetchTool.
 */
export class WebFetchTool extends BaseTool<WebFetchInput, WebFetchOutput> {
  readonly name = 'WebFetch';
  readonly aliases = ['Fetch', 'FetchUrl', 'GetUrl'];
  readonly searchHint = 'fetch url web page content download';
  readonly maxResultSizeChars = 100000;
  readonly shouldDefer = true;

  readonly inputSchema = WebFetchInputSchema;
  readonly outputSchema = WebFetchOutputSchema;

  async execute(input: WebFetchInput, _context: ToolContext): Promise<ToolResult<WebFetchOutput>> {
    const startTime = Date.now();

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<RawFetchResult>('web_fetch', {
        url: input.url,
        prompt: input.prompt
      });

      return {
        success: true,
        data: {
          url: result.url || input.url,
          content: result.content || '',
          contentType: (result as any).content_type || 'text/html',
          bytes: (result as any).bytes || 0,
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

  async describe(): Promise<string> {
    return `Fetch and read the content of a URL. Returns HTML converted to Markdown.`;
  }

  isReadOnly(): boolean { return true; }
  isConcurrencySafe(): boolean { return false; }
}

interface RawFetchResult {
  url?: string;
  content?: string;
  contentType?: string;
  bytes?: number;
}

// ============== Schema ==============

export const WebFetchInputSchema = z.object({
  url: z.string().url().describe('URL to fetch'),
  prompt: z.string().describe('What to extract or summarize from the page')
});

export const WebFetchOutputSchema = z.object({
  url: z.string(),
  content: z.string(),
  contentType: z.string(),
  bytes: z.number(),
  durationMs: z.number()
});

export type WebFetchInput = z.infer<typeof WebFetchInputSchema>;
export type WebFetchOutput = z.infer<typeof WebFetchOutputSchema>;

export const webFetchTool = new WebFetchTool();
