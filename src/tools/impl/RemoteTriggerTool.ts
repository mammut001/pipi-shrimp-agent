import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';
import { isBlockedUrl } from '@/utils/urlSecurity';

/**
 * RemoteTriggerTool - 触发远程操作
 *
 * Sends a trigger to a remote webhook or API endpoint.
 * Based on Claude Code's RemoteTriggerTool.
 */
export class RemoteTriggerTool extends BaseTool<RemoteTriggerInput, RemoteTriggerOutput> {
  readonly name = 'RemoteTrigger';
  readonly aliases = ['Webhook', 'Trigger', 'CallWebhook'];
  readonly searchHint = 'remote trigger webhook api call http';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = true;

  readonly inputSchema = RemoteTriggerInputSchema;
  readonly outputSchema = RemoteTriggerOutputSchema;

  async execute(input: RemoteTriggerInput, _context: ToolContext): Promise<ToolResult<RemoteTriggerOutput>> {
    // SSRF protection: block private/internal URLs
    const blocked = isBlockedUrl(input.url);
    if (blocked) {
      return { success: false, error: blocked };
    }

    try {
      const response = await fetch(input.url, {
        method: input.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(input.headers || {})
        },
        body: input.body ? JSON.stringify(input.body) : undefined
      });

      const responseText = await response.text();
      let responseData: unknown;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      return {
        success: response.ok,
        data: {
          status: response.status,
          ok: response.ok,
          response: responseData
        },
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async describe(): Promise<string> {
    return `Trigger a remote HTTP endpoint or webhook. Use for integrations and automation.`;
  }

  isDestructive(): boolean { return true; }
}

// ============== Schema ==============

export const RemoteTriggerInputSchema = z.object({
  url: z.string().url().describe('URL to trigger'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers to include'),
  body: z.unknown().optional().describe('Request body (will be JSON-serialized)')
});

export const RemoteTriggerOutputSchema = z.object({
  status: z.number(),
  ok: z.boolean(),
  response: z.unknown()
});

export type RemoteTriggerInput = z.infer<typeof RemoteTriggerInputSchema>;
export type RemoteTriggerOutput = z.infer<typeof RemoteTriggerOutputSchema>;

export const remoteTriggerTool = new RemoteTriggerTool();
