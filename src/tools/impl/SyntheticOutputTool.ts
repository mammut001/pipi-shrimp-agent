import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * SyntheticOutputTool - 生成结构化输出
 *
 * Creates synthetic / structured tool output for testing or protocol compliance.
 * Based on Claude Code's SyntheticOutputTool.
 */
export class SyntheticOutputTool extends BaseTool<SyntheticOutputInput, SyntheticOutputOutput> {
  readonly name = 'SyntheticOutput';
  readonly aliases = ['MockOutput', 'FakeResult'];
  readonly searchHint = 'synthetic output mock result test placeholder';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = true;

  readonly inputSchema = SyntheticOutputInputSchema;
  readonly outputSchema = SyntheticOutputOutputSchema;

  async execute(input: SyntheticOutputInput, _context: ToolContext): Promise<ToolResult<SyntheticOutputOutput>> {
    return {
      success: true,
      data: {
        toolName: input.toolName,
        output: input.output,
        isError: input.isError ?? false
      }
    };
  }

  async describe(): Promise<string> {
    return `Generate a synthetic tool result. Used for testing and protocol compliance.`;
  }

  isConcurrencySafe(): boolean { return true; }
  isReadOnly(): boolean { return true; }
}

// ============== Schema ==============

export const SyntheticOutputInputSchema = z.object({
  toolName: z.string().describe('Name of the tool this output is simulating'),
  output: z.unknown().describe('Synthetic output data'),
  isError: z.boolean()
});

export const SyntheticOutputOutputSchema = z.object({
  toolName: z.string(),
  output: z.unknown(),
  isError: z.boolean()
});

export type SyntheticOutputInput = z.infer<typeof SyntheticOutputInputSchema>;
export type SyntheticOutputOutput = z.infer<typeof SyntheticOutputOutputSchema>;

export const syntheticOutputTool = new SyntheticOutputTool();
