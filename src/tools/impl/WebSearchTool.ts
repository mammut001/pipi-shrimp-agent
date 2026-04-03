import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * WebSearchTool - 网页搜索
 *
 * Uses an LLM with web search capability or a search API.
 * Based on Claude Code's WebSearchTool.
 */
export class WebSearchTool extends BaseTool<WebSearchInput, WebSearchOutput> {
  readonly name = 'WebSearch';
  readonly aliases = ['Search', 'SearchWeb'];
  readonly searchHint = 'web search internet google query';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = true;  // Must be discovered via ToolSearch

  private useCount = 0;

  private getMaxUses(context: ToolContext): number {
    return context.settings.maxSearchUses ?? 8;  // Default 8, configurable via ToolSettings
  }

  readonly inputSchema = WebSearchInputSchema;
  readonly outputSchema = WebSearchOutputSchema;

  async execute(input: WebSearchInput, context: ToolContext): Promise<ToolResult<WebSearchOutput>> {
    const maxUses = this.getMaxUses(context);

    // Enforce max uses
    if (this.useCount >= maxUses) {
      return { success: false, error: `WebSearch max uses exceeded (${maxUses})` };
    }
    this.useCount++;

    const startTime = Date.now();

    try {
      // Use the Tauri web command for search if available, otherwise fallback
      const { invoke } = await import('@tauri-apps/api/core');
      const results = await invoke<SearchResult[]>('web_search', {
        query: input.query,
        allowedDomains: input.allowed_domains,
        blockedDomains: input.blocked_domains
      });

      return {
        success: true,
        data: {
          query: input.query,
          results: results || [],
          durationSeconds: (Date.now() - startTime) / 1000
        }
      };
    } catch {
      // Fallback: return empty results rather than crashing
      return {
        success: true,
        data: {
          query: input.query,
          results: [],
          durationSeconds: (Date.now() - startTime) / 1000
        }
      };
    }
  }

  async describe(): Promise<string> {
    return `Search the web for information. Limited to 8 searches per session (configurable).`;
  }

  isConcurrencySafe(): boolean { return false; }
  isReadOnly(): boolean { return true; }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ============== Schema ==============

export const WebSearchInputSchema = z.object({
  query: z.string().min(2).describe('Search query (minimum 2 characters)'),
  allowed_domains: z.array(z.string()).optional().describe('Only return results from these domains'),
  blocked_domains: z.array(z.string()).optional().describe('Exclude results from these domains')
});

export const WebSearchOutputSchema = z.object({
  query: z.string(),
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string()
  })),
  durationSeconds: z.number()
});

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;
export type WebSearchOutput = z.infer<typeof WebSearchOutputSchema>;

export const webSearchTool = new WebSearchTool();
