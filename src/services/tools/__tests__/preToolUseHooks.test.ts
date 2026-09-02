import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../../utils/permissions/classifierDecision', () => ({
  defaultClassifier: {
    classifyPermission: jest.fn(),
  },
}));

jest.mock('../../../utils/permissions/denialTracking', () => ({
  defaultDenialTracker: {
    shouldDenyBasedOnHistory: jest.fn(),
    recordDenial: jest.fn(),
  },
}));

jest.mock('../../../utils/permissions/bashClassifier', () => ({
  classifyBashCommand: jest.fn(),
}));

jest.mock('../../../utils/permissions/permissionLogging', () => ({
  defaultTelemetry: {
    logPermissionDecision: jest.fn(),
  },
}));

import { defaultClassifier } from '../../../utils/permissions/classifierDecision';
import { classifyBashCommand } from '../../../utils/permissions/bashClassifier';
import { defaultDenialTracker } from '../../../utils/permissions/denialTracking';
import {
  bashClassifierCheck,
  executionModeGuardCheck,
  mlClassifierCheck,
  permissionModeCheck,
  type HookContext,
} from '../preToolUseHooks';

function ctx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    toolName: 'read_file',
    toolArgs: '{}',
    sessionId: 's1',
    permissionMode: 'standard',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(defaultClassifier.classifyPermission).mockResolvedValue({
    approved: true,
    confidence: 0.9,
    riskLevel: 'low',
    reasoning: 'safe',
  });
  jest.mocked(defaultDenialTracker.shouldDenyBasedOnHistory).mockReturnValue({
    shouldDeny: false,
    reason: undefined,
  });
  jest.mocked(classifyBashCommand).mockReturnValue({
    requiresApproval: false,
    riskLevel: 'safe',
    reasoning: 'safe',
  });
});

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

  it('legacy Debug/Agent ids normalize to Plan and block writes', async () => {
    for (const executionMode of ['debug', 'agent'] as const) {
      const write = await executionModeGuardCheck(
        ctx({ executionMode, toolName: 'write_file' }),
      );
      expect(write.approved).toBe(false);

      const read = await executionModeGuardCheck(
        ctx({ executionMode, toolName: 'read_file' }),
      );
      expect(read.approved).toBe(true);
    }
  });

  it('Danger mode allows shell without an outer catalog block', async () => {
    const shell = await executionModeGuardCheck(
      ctx({ executionMode: 'danger', toolName: 'execute_command' }),
    );
    expect(shell.approved).toBe(true);

    const browser = await executionModeGuardCheck(
      ctx({ executionMode: 'danger', toolName: 'browser_click' }),
    );
    expect(browser.approved).toBe(true);
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

describe('preToolUseHooks bypass classifier behavior', () => {
  it('mlClassifierCheck auto-approves non-critical denials in bypass mode', async () => {
    jest.mocked(defaultClassifier.classifyPermission).mockResolvedValue({
      approved: false,
      confidence: 0.5,
      riskLevel: 'medium',
      reasoning: 'needs confirmation',
    });

    const result = await mlClassifierCheck(
      ctx({ permissionMode: 'bypass', toolName: 'read_file', toolArgs: '{"path":"README.md"}' }),
    );

    expect(result).toEqual({ approved: true });
  });

  it('bashClassifierCheck auto-approves non-critical approval requests in bypass mode', async () => {
    jest.mocked(classifyBashCommand).mockReturnValue({
      requiresApproval: true,
      riskLevel: 'high',
      reasoning: 'network access',
    });

    const result = await bashClassifierCheck(
      ctx({
        permissionMode: 'bypass',
        toolName: 'execute_command',
        toolArgs: '{"command":"curl https://example.com"}',
      }),
    );

    expect(result).toEqual({ approved: true });
  });
});
