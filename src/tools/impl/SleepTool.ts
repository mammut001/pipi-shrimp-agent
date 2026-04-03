import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * SleepTool - 暂停执行
 *
 * Pauses execution for a specified duration.
 * Based on Claude Code's SleepTool.
 */
export class SleepTool extends BaseTool<SleepInput, SleepOutput> {
  readonly name = 'Sleep';
  readonly aliases = ['Wait', 'Delay', 'Pause'];
  readonly searchHint = 'sleep wait delay pause seconds';
  readonly maxResultSizeChars = 1000;
  readonly shouldDefer = true;

  readonly inputSchema = SleepInputSchema;
  readonly outputSchema = SleepOutputSchema;

  async execute(input: SleepInput, context: ToolContext): Promise<ToolResult<SleepOutput>> {
    const ms = Math.min(input.seconds * 1000, 300_000); // Max 5 minutes

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      context.abortSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Sleep aborted'));
      }, { once: true });
    });

    return {
      success: true,
      data: {
        sleptSeconds: input.seconds,
        sleptMs: ms
      }
    };
  }

  async describe(): Promise<string> {
    return `Pause execution for the specified number of seconds (max 300).`;
  }

  isReadOnly(): boolean { return true; }
  isConcurrencySafe(): boolean { return true; }
}

// ============== Schema ==============

export const SleepInputSchema = z.object({
  seconds: z.number().positive().describe('Number of seconds to sleep (max 300)')
});

export const SleepOutputSchema = z.object({
  sleptSeconds: z.number(),
  sleptMs: z.number()
});

export type SleepInput = z.infer<typeof SleepInputSchema>;
export type SleepOutput = z.infer<typeof SleepOutputSchema>;

export const sleepTool = new SleepTool();
