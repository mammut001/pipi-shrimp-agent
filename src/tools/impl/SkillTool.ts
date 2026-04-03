import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * SkillTool - 执行预定义的 Skill
 *
 * Skills are reusable prompt templates or scripts stored in src/skills/.
 * Based on Claude Code's SkillTool.
 */
export class SkillTool extends BaseTool<SkillInput, SkillOutput> {
  readonly name = 'Skill';
  readonly aliases = ['RunSkill', 'skill'];
  readonly searchHint = 'skill run execute slash command';
  readonly maxResultSizeChars = 50000;
  readonly shouldDefer = true;

  readonly inputSchema = SkillInputSchema;
  readonly outputSchema = SkillOutputSchema;

  async execute(input: SkillInput, context: ToolContext): Promise<ToolResult<SkillOutput>> {
    try {
      const result = await invoke<RawSkillResult>('execute_skill', {
        skillName: input.skill,
        args: input.args || '',
        workDir: context.cwd || undefined
      });

      return {
        success: result.success,
        data: {
          success: result.success,
          commandName: input.skill,
          status: result.status || 'inline',
          output: result.output || '',
          error: result.error
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
    return `Execute a predefined skill. Skills are reusable prompt templates stored in the skills directory.`;
  }
}

interface RawSkillResult {
  success: boolean;
  status?: 'forked' | 'inline';
  output?: string;
  error?: string;
}

// ============== Schema ==============

export const SkillInputSchema = z.object({
  skill: z.string().describe('Name of the skill to execute'),
  args: z.string().optional().describe('Arguments to pass to the skill')
});

export const SkillOutputSchema = z.object({
  success: z.boolean(),
  commandName: z.string(),
  status: z.enum(['forked', 'inline']),
  output: z.string(),
  error: z.string().optional()
});

export type SkillInput = z.infer<typeof SkillInputSchema>;
export type SkillOutput = z.infer<typeof SkillOutputSchema>;

export const skillTool = new SkillTool();
