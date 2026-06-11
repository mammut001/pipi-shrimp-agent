import { describe, expect, it } from '@jest/globals';

import { executionModeGuardCheck, type HookContext } from '../preToolUseHooks';

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

  it('Plan mode blocks every tool, regardless of underlying PermissionMode', async () => {
    const result = await executionModeGuardCheck(
      ctx({ executionMode: 'plan', toolName: 'read_file' }),
    );
    expect(result.approved).toBe(false);
    expect(result.error).toMatch(/Plan mode/i);
  });

  it('Ask mode requires confirmation even for read-only tools', async () => {
    const result = await executionModeGuardCheck(
      ctx({ executionMode: 'ask', toolName: 'read_file' }),
    );
    expect(result.approved).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  it('Ask mode blocks shell and browser tools', async () => {
    const shell = await executionModeGuardCheck(
      ctx({ executionMode: 'ask', toolName: 'execute_command' }),
    );
    expect(shell.approved).toBe(false);
    expect(shell.error).toMatch(/Ask mode/i);

    const browser = await executionModeGuardCheck(
      ctx({ executionMode: 'ask', toolName: 'browser_click' }),
    );
    expect(browser.approved).toBe(false);
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

  it('Multitask mode behaves like Agent for tool allow-listing (limited honest fallback)', async () => {
    const shell = await executionModeGuardCheck(
      ctx({ executionMode: 'multitask', toolName: 'execute_command' }),
    );
    expect(shell.approved).toBe(true);

    const browser = await executionModeGuardCheck(
      ctx({ executionMode: 'multitask', toolName: 'browser_click' }),
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
});
