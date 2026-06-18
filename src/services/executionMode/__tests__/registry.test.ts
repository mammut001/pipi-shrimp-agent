import { describe, expect, it } from '@jest/globals';

import {
  EXECUTION_MODES,
  getDefaultExecutionMode,
  getExecutionMode,
  isDefaultMode,
  isExecutionModeId,
  isToolAllowedForMode,
  listExecutionModes,
  modeRequiresWarning,
  resolvePermissionMode,
} from '../index';
import type { ExecutionModeId } from '../registry';

describe('executionMode/registry', () => {
  it('exposes exactly the five documented modes in expected order', () => {
    const ids = EXECUTION_MODES.map((m) => m.id);
    expect(ids).toEqual(['ask', 'plan', 'debug', 'agent', 'bypass']);
  });

  it('marks Ask as the default and Bypass as the only mode that requires a warning', () => {
    expect(getDefaultExecutionMode().id).toBe('ask');
    expect(isDefaultMode('ask')).toBe(true);
    expect(isDefaultMode('agent')).toBe(false);
    expect(isDefaultMode('bypass')).toBe(false);

    expect(modeRequiresWarning('bypass')).toBe(true);
    expect(modeRequiresWarning('ask')).toBe(false);
    expect(modeRequiresWarning('plan')).toBe(false);
    expect(modeRequiresWarning('debug')).toBe(false);
    expect(modeRequiresWarning('agent')).toBe(false);
  });

  it('flags Bypass as advanced and others as primary', () => {
    const bypass = getExecutionMode('bypass');
    expect(bypass.isAdvanced).toBe(true);

    const others = EXECUTION_MODES.filter((m) => m.id !== 'bypass');
    for (const mode of others) {
      expect(mode.isAdvanced).toBe(false);
    }
  });

  it('classifies risk levels so Bypass is the only dangerous mode', () => {
    const byRisk = new Map<string, string[]>();
    for (const mode of EXECUTION_MODES) {
      const list = byRisk.get(mode.riskLevel) ?? [];
      list.push(mode.id);
      byRisk.set(mode.riskLevel, list);
    }
    expect(byRisk.get('dangerous')).toEqual(['bypass']);
    // Ask and Plan are both safe (chat-only / read-only plan output).
    expect(byRisk.get('safe')).toEqual(['ask', 'plan']);
  });

  it('maps each 5-mode id to a 4-mode PermissionMode', () => {
    // Ask and Plan both map to plan-only — Ask is chat-only, Plan is
    // read-only plan output. The downstream hook layer then blocks
    // tool execution based on the explicit 6-mode id, not the
    // 4-mode PermissionMode.
    expect(resolvePermissionMode('ask')).toBe('plan-only');
    expect(resolvePermissionMode('plan')).toBe('plan-only');
    expect(resolvePermissionMode('debug')).toBe('auto-edits');
    expect(resolvePermissionMode('agent')).toBe('auto-edits');
    expect(resolvePermissionMode('bypass')).toBe('bypass');
  });

  it('isExecutionModeId accepts the five known ids and rejects the rest', () => {
    for (const id of ['ask', 'plan', 'debug', 'agent', 'bypass']) {
      expect(isExecutionModeId(id)).toBe(true);
    }
    expect(isExecutionModeId('standard')).toBe(false);
    expect(isExecutionModeId('AUTO-EDITS')).toBe(false);
    expect(isExecutionModeId('multitask')).toBe(false);
    expect(isExecutionModeId('')).toBe(false);
    expect(isExecutionModeId(null)).toBe(false);
    expect(isExecutionModeId(undefined)).toBe(false);
    expect(isExecutionModeId(42)).toBe(false);
  });

  it('falls back to the default mode when given an unknown id', () => {
    const fallback = getExecutionMode('not-a-mode');
    expect(fallback.id).toBe('ask');

    const empty = getExecutionMode(null);
    expect(empty.id).toBe('ask');

    const undef = getExecutionMode(undefined);
    expect(undef.id).toBe('ask');
  });
});

describe('executionMode/guards: tool allow-list per mode', () => {
  it('Ask mode blocks every tool (chat-only)', () => {
    expect(isToolAllowedForMode('ask', 'read_file')).toBe(false);
    expect(isToolAllowedForMode('ask', 'write_file')).toBe(false);
    expect(isToolAllowedForMode('ask', 'execute_command')).toBe(false);
    expect(isToolAllowedForMode('ask', 'list_files')).toBe(false);
    expect(isToolAllowedForMode('ask', 'browser_click')).toBe(false);
    expect(isToolAllowedForMode('ask', 'ssh_exec')).toBe(false);
  });

  it('Plan mode blocks every tool', () => {
    expect(isToolAllowedForMode('plan', 'read_file')).toBe(false);
    expect(isToolAllowedForMode('plan', 'write_file')).toBe(false);
    expect(isToolAllowedForMode('plan', 'execute_command')).toBe(false);
    expect(isToolAllowedForMode('plan', 'list_files')).toBe(false);
  });

  it('Debug mode allows read + write but blocks shell / browser / ssh', () => {
    expect(isToolAllowedForMode('debug', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('debug', 'write_file')).toBe(true);
    expect(isToolAllowedForMode('debug', 'execute_command')).toBe(false);
    expect(isToolAllowedForMode('debug', 'browser_click')).toBe(false);
    expect(isToolAllowedForMode('debug', 'ssh_exec')).toBe(false);
  });

  it('Agent mode allows shell but not browser / ssh', () => {
    expect(isToolAllowedForMode('agent', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('agent', 'get_current_workspace')).toBe(true);
    expect(isToolAllowedForMode('agent', 'write_file')).toBe(true);
    expect(isToolAllowedForMode('agent', 'execute_command')).toBe(true);
    expect(isToolAllowedForMode('agent', 'run_in_terminal')).toBe(true);
    expect(isToolAllowedForMode('agent', 'browser_click')).toBe(false);
    expect(isToolAllowedForMode('agent', 'ssh_exec')).toBe(false);
  });

  it('Bypass mode allows everything under the registry allow-list', () => {
    expect(isToolAllowedForMode('bypass', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'write_file')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'execute_command')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'browser_click')).toBe(true);
    expect(isToolAllowedForMode('bypass', 'ssh_exec')).toBe(true);
  });
});

describe('executionMode/registry: back-compat with 4-mode PermissionMode', () => {
  it('does not include the legacy 4-mode ids in the registry', () => {
    const ids: ExecutionModeId[] = EXECUTION_MODES.map((m) => m.id);
    // 4-mode-only ids (none of these are reused in the 4-mode registry).
    expect(ids).not.toContain('standard');
    expect(ids).not.toContain('auto-edits');
    expect(ids).not.toContain('plan-only');
    // The 4-mode registry does expose 'bypass' as a mode id, but it is
    // a registry concept (with a warning gate) and not the raw 4-mode
    // 'bypass' permission. The mapping happens in resolvePermissionMode.
    expect(ids).toContain('bypass');
  });

  it('still exposes the 4-mode mapping via resolvePermissionMode for hook compatibility', () => {
    // preToolUseHooks reads `permissionMode`, not the 4-mode id, and
    // supports exactly these 4 values. Each 4-mode must round-trip into
    // a known 4-mode value.
    const allowed = new Set(['standard', 'auto-edits', 'bypass', 'plan-only']);
    for (const mode of listExecutionModes()) {
      expect(allowed.has(resolvePermissionMode(mode.id))).toBe(true);
    }
  });
});
