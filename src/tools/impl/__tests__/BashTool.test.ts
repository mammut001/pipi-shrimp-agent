import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BashInputSchema, BashTool } from '../BashTool';
import type { ToolContext } from '../../base/Tool';

const mockInvoke = jest.mocked(invoke);
const tool = new BashTool();

describe('BashTool schema and safety policy', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('validates the command input and rejects a missing command', () => {
    expect(BashInputSchema.safeParse({ command: 'ls', timeout: 30 }).success).toBe(true);
    expect(BashInputSchema.safeParse({ timeout: 30 }).success).toBe(false);
  });

  it('classifies read-only and destructive commands for policy checks', () => {
    expect(tool.isReadOnly({ command: 'rg TODO src' })).toBe(true);
    expect(tool.isDestructive({ command: 'rm temp.txt' })).toBe(true);
    expect(tool.isConcurrencySafe({ command: 'rm -rf /' })).toBe(false);
  });

  it('blocks dangerous shell commands before invoking the native shell in sandbox mode', async () => {
    const context = { settings: { sandboxEnabled: true } } as ToolContext;

    const result = await tool.execute({ command: 'rm -rf /' }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Dangerous command blocked');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
