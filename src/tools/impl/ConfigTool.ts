import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { BaseTool, ToolContext, ToolResult } from '../base/Tool';

/**
 * ConfigTool - 读写应用配置
 *
 * Get and set configuration values from the settings store.
 * Based on Claude Code's ConfigTool.
 */
export class ConfigTool extends BaseTool<ConfigInput, ConfigOutput> {
  readonly name = 'Config';
  readonly aliases = ['Settings', 'GetConfig', 'SetConfig'];
  readonly searchHint = 'config settings preference get set';
  readonly maxResultSizeChars = 10000;
  readonly shouldDefer = true;

  readonly inputSchema = ConfigInputSchema;
  readonly outputSchema = ConfigOutputSchema;

  async execute(input: ConfigInput, _context: ToolContext): Promise<ToolResult<ConfigOutput>> {
    try {
      if (input.value !== undefined) {
        // Set config value
        await invoke<void>('set_config', {
          key: input.setting,
          value: input.value
        });
        return {
          success: true,
          data: {
            setting: input.setting,
            value: input.value,
            newValue: input.value,
            success: true
          }
        };
      } else {
        // Get config value
        const value = await invoke<unknown>('get_config', {
          key: input.setting
        });
        return {
          success: true,
          data: {
            setting: input.setting,
            value,
            success: true
          }
        };
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async describe(): Promise<string> {
    return `Get or set application configuration values.`;
  }
}

// ============== Schema ==============

export const ConfigInputSchema = z.object({
  setting: z.string().describe('Configuration key to get or set'),
  value: z.unknown().optional().describe('Value to set (omit to read)')
});

export const ConfigOutputSchema = z.object({
  setting: z.string(),
  value: z.unknown(),
  newValue: z.unknown().optional(),
  success: z.boolean()
});

export type ConfigInput = z.infer<typeof ConfigInputSchema>;
export type ConfigOutput = z.infer<typeof ConfigOutputSchema>;

export const configTool = new ConfigTool();
