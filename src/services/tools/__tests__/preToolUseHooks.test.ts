import { describe, expect, it } from '@jest/globals';

import { executionModeGuardCheck, permissionModeCheck, type HookContext } from '../preToolUseHooks';

function ctx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    toolName: 'read_file',
    toolArgs: '{}',
    sessionId: 's1',
    permissionMode: 'standard',
    ...overrides,
  };
}

describe('preToolUseHooks.executionModeGuardCheck', () => {
  it('is a no-op when no execution mode is provided', async () => {
    const result = await executionModeGuardCheck(ctx());
    expect(result.approved).toBe(true);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  it('Plan mode allows read-only plan tools and blocks side-effecting tools', async () => {
    const read = await executionModeGuardCheck(
      ctx({ executionMode: 'plan', toolName: 'read_file' }),
    );
    expect(read.approved).toBe(true);

    const write = await executionModeGuardCheck(
      ctx({ executionMode: 'plan', toolName: 'write_file' }),
    );
    expect(write.approved).toBe(false);
    expect(write.error).toMatch(/Plan mode/i);
  });

  it('Debug mode allows writes but blocks shell and browser', async () => {
    const write = await executionModeGuardCheck(
      ctx({ executionMode: 'debug', toolName: 'write_file' }),
    );
    expect(write.approved).toBe(true);

    const shell = await executionModeGuardCheck(
      ctx({ executionMode: 'debug', toolName: 'execute_command' }),
    );
    expect(shell.approved).toBe(false);

    const browser = await executionModeGuardCheck(
      ctx({ executionMode: 'debug', toolName: 'browser_click' }),
    );
    expect(browser.approved).toBe(false);
  });

  it('Agent mode allows shell, blocks browser / ssh', async () => {
    const shell = await executionModeGuardCheck(
      ctx({ executionMode: 'agent', toolName: 'execute_command' }),
    );
    expect(shell.approved).toBe(true);

    const browser = await executionModeGuardCheck(
      ctx({ executionMode: 'agent', toolName: 'browser_click' }),
    );
    expect(browser.approved).toBe(false);
  });

  it('Bypass mode does not add an outer restriction (hooks stay responsible for risk gating)', async () => {
    const shell = await executionModeGuardCheck(
      ctx({ executionMode: 'bypass', toolName: 'execute_command' }),
    );
    expect(shell.approved).toBe(true);

    const browser = await executionModeGuardCheck(
      ctx({ executionMode: 'bypass', toolName: 'browser_click' }),
    );
    expect(browser.approved).toBe(true);
  });

  it('Ask mode blocks every tool, including read_file / write_file / execute_command / browser_navigate', async () => {
    for (const toolName of [
      'read_file',
      'write_file',
      'execute_command',
      'browser_navigate',
      'ssh_exec',
      'agent_tool',
    ]) {
      const result = await executionModeGuardCheck(
        ctx({ executionMode: 'ask', toolName }),
      );
      expect(result.approved).toBe(false);
      expect(result.error).toMatch(/Ask mode/i);
      expect(result.blockedBy).toBe('permission-mode');
    }
  });

  it('Ask mode blocks even when underlying permissionMode is bypass', async () => {
    // The 5-mode outer guard wins over the underlying permissionMode
    // when Ask mode is active — this is the chat-only guarantee.
    const result = await executionModeGuardCheck(
      ctx({ executionMode: 'ask', permissionMode: 'bypass', toolName: 'read_file' }),
    );
    expect(result.approved).toBe(false);
  });
});

describe('preToolUseHooks.permissionModeCheck', () => {
  it('allows Plan read tools when permissionMode is plan-only', async () => {
    const result = await permissionModeCheck(
      ctx({ executionMode: 'plan', permissionMode: 'plan-only', toolName: 'read_file' }),
    );
    expect(result.approved).toBe(true);
  });

  it('blocks Ask when permissionMode is plan-only', async () => {
    const result = await permissionModeCheck(
      ctx({ executionMode: 'ask', permissionMode: 'plan-only', toolName: 'read_file' }),
    );
    expect(result.approved).toBe(false);
    expect(result.error).toMatch(/Ask mode/i);
  });

  it('allows legacy plan-only rows without executionMode', async () => {
    const result = await permissionModeCheck(
      ctx({ permissionMode: 'plan-only', toolName: 'read_file' }),
    );
    expect(result.approved).toBe(true);
  });
});
