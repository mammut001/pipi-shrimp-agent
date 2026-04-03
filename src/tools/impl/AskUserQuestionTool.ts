import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * AskUserQuestionTool - 向用户提问
 *
 * Prompts the user with a question and optional predefined choices.
 * Based on Claude Code's AskUserQuestionTool.
 *
 * Note: In a Tauri/React context, this publishes an event that the UI listens to.
 */
export class AskUserQuestionTool extends BaseTool<AskUserQuestionInput, AskUserQuestionOutput> {
  readonly name = 'AskUserQuestion';
  readonly aliases = ['AskUser', 'Question'];
  readonly searchHint = 'ask user question clarify input';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = false;
  readonly alwaysLoad = true;

  readonly inputSchema = AskUserQuestionInputSchema;
  readonly outputSchema = AskUserQuestionOutputSchema;

  async execute(input: AskUserQuestionInput, _context: ToolContext): Promise<ToolResult<AskUserQuestionOutput>> {
    // Emit an event/signal to the UI layer asking for user input.
    // The actual response will come back via the chat input.
    // For now, we return a placeholder that signals the UI to handle it.
    return {
      success: true,
      data: {
        response: `[Awaiting user response to: "${input.question}"]`,
        selectedOption: undefined
      }
    };
  }

  async describe(): Promise<string> {
    return `Ask the user a clarifying question. Use when you need more information to proceed.`;
  }

  isConcurrencySafe(): boolean { return false; }
  isReadOnly(): boolean { return true; }
}

// ============== Schema ==============

export const AskUserQuestionInputSchema = z.object({
  question: z.string().describe('Question to ask the user'),
  options: z.array(z.string()).optional().describe('Predefined answer options')
});

export const AskUserQuestionOutputSchema = z.object({
  response: z.string().describe('The user\'s response'),
  selectedOption: z.string().optional().describe('The selected option if options were provided')
});

export type AskUserQuestionInput = z.infer<typeof AskUserQuestionInputSchema>;
export type AskUserQuestionOutput = z.infer<typeof AskUserQuestionOutputSchema>;

export const askUserQuestionTool = new AskUserQuestionTool();
