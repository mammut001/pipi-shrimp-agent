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
  resolveSessionExecutionModeId,
  executionModeFromPermissionMode,
  hydrateSessionModes,
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
    // tool execution based on the explicit 5-mode id, not the
    // PermissionMode.
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

  it('Plan mode allows read-only inspection + save_plan_doc only', () => {
    // Read-only inspection + save_plan_doc are allowed.
    expect(isToolAllowedForMode('plan', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('plan', 'list_files')).toBe(true);
    expect(isToolAllowedForMode('plan', 'search_files')).toBe(true);
    expect(isToolAllowedForMode('plan', 'save_plan_doc')).toBe(true);
    // Writes, edits, shell, browser, ssh, mcp and agent spawn are all
    // blocked — Plan mode must never produce side effects.
    expect(isToolAllowedForMode('plan', 'write_file')).toBe(false);
    expect(isToolAllowedForMode('plan', 'edit_file')).toBe(false);
    expect(isToolAllowedForMode('plan', 'create_directory')).toBe(false);
    expect(isToolAllowedForMode('plan', 'delete_file')).toBe(false);
    expect(isToolAllowedForMode('plan', 'execute_command')).toBe(false);
    expect(isToolAllowedForMode('plan', 'browser_click')).toBe(false);
    expect(isToolAllowedForMode('plan', 'ssh_exec')).toBe(false);
    expect(isToolAllowedForMode('plan', 'mcp__tool')).toBe(false);
    expect(isToolAllowedForMode('plan', 'agent_tool')).toBe(false);
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

describe('executionMode/registry: back-compat with legacy PermissionMode', () => {
  it('resolveSessionExecutionModeId prefers executionMode when present', () => {
    expect(resolveSessionExecutionModeId({ executionMode: 'ask', permissionMode: 'plan-only' })).toBe('ask');
    expect(resolveSessionExecutionModeId({ executionMode: 'agent', permissionMode: 'auto-edits' })).toBe('agent');
  });

  it('resolveSessionExecutionModeId maps legacy permissionMode rows', () => {
    expect(resolveSessionExecutionModeId({ permissionMode: 'plan-only' })).toBe('plan');
    expect(resolveSessionExecutionModeId({ permissionMode: 'bypass' })).toBe('bypass');
    expect(resolveSessionExecutionModeId({ permissionMode: 'auto-edits' })).toBe('agent');
    expect(resolveSessionExecutionModeId({ permissionMode: 'standard' })).toBe('agent');
    expect(resolveSessionExecutionModeId({})).toBe('ask');
    expect(resolveSessionExecutionModeId(undefined)).toBe('ask');
  });

  it('createSession persists the registry default Ask mode', async () => {
    const { createSession } = await import('@/types/chat');
    const session = createSession();
    expect(session.executionMode).toBe('ask');
    expect(session.permissionMode).toBe('plan-only');
  });

  it('hydrateSessionModes keeps Ask when executionMode is ask', () => {
    const hydrated = hydrateSessionModes({ executionMode: 'ask', permissionMode: 'plan-only' });
    expect(hydrated.executionMode).toBe('ask');
    expect(hydrated.permissionMode).toBe('plan-only');
  });

  it('hydrateSessionModes maps legacy bypass permission rows', () => {
    const hydrated = hydrateSessionModes({ permissionMode: 'bypass' });
    expect(hydrated.executionMode).toBe('bypass');
    expect(hydrated.permissionMode).toBe('bypass');
  });

  it('does not include the legacy PermissionMode ids in the registry', () => {
    const ids: ExecutionModeId[] = EXECUTION_MODES.map((m) => m.id);
    // PermissionMode-only ids (none of these are reused in the registry).
    expect(ids).not.toContain('standard');
    expect(ids).not.toContain('auto-edits');
    expect(ids).not.toContain('plan-only');
    // The PermissionMode does expose 'bypass' as a value, but it is
    // a registry concept (with a warning gate) and not the raw
    // 'bypass' permission. The mapping happens in resolvePermissionMode.
    expect(ids).toContain('bypass');
  });

  it('still exposes the PermissionMode mapping via resolvePermissionMode for hook compatibility', () => {
    // preToolUseHooks reads `permissionMode`, not the 5-mode id, and
    // supports exactly these 4 values. Each 5-mode must round-trip into
    // a known PermissionMode value.
    const allowed = new Set(['standard', 'auto-edits', 'bypass', 'plan-only']);
    for (const mode of listExecutionModes()) {
      expect(allowed.has(resolvePermissionMode(mode.id))).toBe(true);
    }
  });
});
