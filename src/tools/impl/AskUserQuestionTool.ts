import { z } from 'zod';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * AskUserQuestionTool - 向用户提问（通过结构化表单）
 *
 * Presents a structured questionnaire form to the user.
 * The form is intercepted by chatStore and rendered as a QuestionnaireCard.
 */
export class AskUserQuestionTool extends BaseTool<AskUserQuestionInput, AskUserQuestionOutput> {
  readonly name = 'AskUserQuestion';
  readonly aliases = ['AskUser', 'Question'];
  readonly searchHint = 'ask user question clarify input form questionnaire';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = false;
  readonly alwaysLoad = true;

  readonly inputSchema = AskUserQuestionInputSchema;
  readonly outputSchema = AskUserQuestionOutputSchema;

  async execute(input: AskUserQuestionInput, _context: ToolContext): Promise<ToolResult<AskUserQuestionOutput>> {
    // This tool is intercepted by chatStore before reaching here.
    // If it somehow reaches here, return a placeholder.
    return {
      success: true,
      data: {
        response: `[Awaiting user response to questionnaire: "${input.title}"]`,
      }
    };
  }

  async describe(): Promise<string> {
    return `Present a structured questionnaire form to the user to collect multiple pieces of information at once. Use this when you need several related inputs (e.g., resume details, project setup, profile information) instead of asking questions one by one in chat. The form will be displayed as an interactive UI. The user's responses will be returned as a JSON object keyed by field id.`;
  }

  isConcurrencySafe(): boolean { return false; }
  isReadOnly(): boolean { return true; }
}

// ============== Schema ==============

const QuestionnaireFieldSchema = z.object({
  id: z.string().describe('Unique key for this field (e.g., "education", "work_experience")'),
  label: z.string().describe('User-facing label or question for this field'),
  type: z.enum(['text', 'textarea', 'select', 'boolean']).describe('Input type: text for short answers, textarea for long answers, select for dropdown, boolean for yes/no'),
  required: z.boolean().describe('Whether this field must be filled out'),
  placeholder: z.string().optional().describe('Optional placeholder text for the input'),
  options: z.array(z.string()).optional().describe('Options for select type fields'),
});

export const AskUserQuestionInputSchema = z.object({
  title: z.string().describe('Title of the questionnaire form'),
  description: z.string().describe('Brief explanation of why this information is needed'),
  fields: z.array(QuestionnaireFieldSchema).describe('List of form fields to present to the user'),
});

export const AskUserQuestionOutputSchema = z.object({
  response: z.string().describe('The user\'s response as a JSON object'),
});

export type AskUserQuestionInput = z.infer<typeof AskUserQuestionInputSchema>;
export type AskUserQuestionOutput = z.infer<typeof AskUserQuestionOutputSchema>;

export const askUserQuestionTool = new AskUserQuestionTool();
