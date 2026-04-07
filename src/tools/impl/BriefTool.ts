import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * BriefTool - 向用户发送状态消息
 *
 * Sends a brief status update to the user without expecting a response.
 * Based on Claude Code's BriefTool.
 */
export class BriefTool extends BaseTool<BriefInput, BriefOutput> {
  readonly name = 'Brief';
  readonly aliases = ['Status', 'Notify', 'SendStatus'];
  readonly searchHint = 'brief status message notify user update';
  readonly maxResultSizeChars = 5000;
  readonly shouldDefer = false;
  readonly alwaysLoad = true;

  readonly inputSchema = BriefInputSchema;
  readonly outputSchema = BriefOutputSchema;

  async execute(input: BriefInput, _context: ToolContext): Promise<ToolResult<BriefOutput>> {
    const status = input.status ?? 'normal';
    // In a Tauri context, this would emit an event to the UI to display the brief
    return {
      success: true,
      data: {
        success: true,
        message: input.message,
        status
      }
    };
  }

  async describe(): Promise<string> {
    return `Send a brief status message to the user. Use to report progress on long tasks.`;
  }

  isConcurrencySafe(): boolean { return true; }
  isReadOnly(): boolean { return true; }
}

// ============== Schema ==============

export const BriefInputSchema = z.object({
  message: z.string().describe('Status message to send to the user'),
  status: z.enum(['normal', 'warning', 'error', 'success'])
});

export const BriefOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  status: z.enum(['normal', 'warning', 'error', 'success'])
});

export type BriefInput = z.infer<typeof BriefInputSchema>;
export type BriefOutput = z.infer<typeof BriefOutputSchema>;

export const briefTool = new BriefTool();
