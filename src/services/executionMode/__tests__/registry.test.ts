import { describe, expect, it } from '@jest/globals';

import {
  EXECUTION_MODES,
  getAllowedToolsForMode,
  getDefaultExecutionMode,
  getExecutionMode,
  hydrateSessionModes,
  isDefaultMode,
  isExecutionModeId,
  isToolAllowedForMode,
  modeRequiresWarning,
  normalizeExecutionModeId,
  resolvePermissionMode,
  resolveSessionExecutionModeId,
  executionModeFromPermissionMode,
} from '../index';

describe('executionMode three-mode registry', () => {
  it('exposes exactly Ask, Plan, Danger', () => {
    expect(EXECUTION_MODES.map((mode) => mode.id)).toEqual(['ask', 'plan', 'danger']);
  });

  it('keeps Ask as default and Danger as the only warning/dangerous mode', () => {
    expect(getDefaultExecutionMode().id).toBe('ask');
    expect(isDefaultMode('ask')).toBe(true);
    expect(isDefaultMode('plan')).toBe(false);
    expect(isDefaultMode('danger')).toBe(false);
    expect(modeRequiresWarning('danger')).toBe(true);
    expect(modeRequiresWarning('ask')).toBe(false);
    expect(modeRequiresWarning('plan')).toBe(false);
    expect(EXECUTION_MODES.filter((mode) => mode.riskLevel === 'dangerous').map((mode) => mode.id)).toEqual(['danger']);
  });

  it('attaches a real harness to all three modes', () => {
    for (const mode of EXECUTION_MODES) {
      expect(mode.systemPromptSuffix.trim().length).toBeGreaterThan(80);
      expect(mode.systemPromptSuffix).toContain('HARNESS');
    }
    expect(getExecutionMode('danger').systemPromptSuffix).toContain('double-check');
  });

  it('maps active modes to the legacy permission hook layer conservatively', () => {
    expect(resolvePermissionMode('ask')).toBe('plan-only');
    expect(resolvePermissionMode('plan')).toBe('plan-only');
    expect(resolvePermissionMode('danger')).toBe('auto-edits');
  });

  it('accepts historical ids only as migration aliases', () => {
    for (const id of ['ask', 'plan', 'danger', 'debug', 'agent', 'bypass']) {
      expect(isExecutionModeId(id)).toBe(true);
    }
    expect(normalizeExecutionModeId('debug')).toBe('plan');
    expect(normalizeExecutionModeId('agent')).toBe('plan');
    expect(normalizeExecutionModeId('bypass')).toBe('danger');
    expect(getExecutionMode('debug').id).toBe('plan');
    expect(getExecutionMode('agent').id).toBe('plan');
    expect(getExecutionMode('bypass').id).toBe('danger');
    expect(isExecutionModeId('garbage')).toBe(false);
  });

  it('fails unknown execution mode values closed to Ask', () => {
    expect(getExecutionMode('not-a-mode').id).toBe('ask');
    expect(getExecutionMode(null).id).toBe('ask');
    expect(getExecutionMode(undefined).id).toBe('ask');
  });
});

describe('executionMode tool harnesses', () => {
  it('Ask is chat-only', () => {
    expect(getAllowedToolsForMode('ask')).toEqual([]);
    expect(isToolAllowedForMode('ask', 'read_file')).toBe(false);
    expect(isToolAllowedForMode('ask', 'write_file')).toBe(false);
  });

  it('Plan is read-only', () => {
    expect(isToolAllowedForMode('plan', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('plan', 'list_files')).toBe(true);
    expect(isToolAllowedForMode('plan', 'search_files')).toBe(true);
    expect(isToolAllowedForMode('plan', 'write_file')).toBe(false);
    expect(isToolAllowedForMode('plan', 'delete_file')).toBe(false);
    expect(isToolAllowedForMode('plan', 'execute_command')).toBe(false);
    expect(isToolAllowedForMode('plan', 'browser_click')).toBe(false);
    expect(isToolAllowedForMode('plan', 'save_plan_doc')).toBe(false);
  });

  it('Danger exposes the full tool catalog while approval is handled separately', () => {
    expect(getAllowedToolsForMode('danger')).toBeUndefined();
    expect(isToolAllowedForMode('danger', 'read_file')).toBe(true);
    expect(isToolAllowedForMode('danger', 'write_file')).toBe(true);
    expect(isToolAllowedForMode('danger', 'delete_file')).toBe(true);
    expect(isToolAllowedForMode('danger', 'execute_command')).toBe(true);
    expect(isToolAllowedForMode('danger', 'browser_click')).toBe(true);
    expect(isToolAllowedForMode('danger', 'ssh_exec')).toBe(true);
  });
});

describe('executionMode persistence compatibility', () => {
  it('normalizes historical persisted execution ids without escalation', () => {
    expect(resolveSessionExecutionModeId({ executionMode: 'debug', permissionMode: 'auto-edits' })).toBe('plan');
    expect(resolveSessionExecutionModeId({ executionMode: 'agent', permissionMode: 'auto-edits' })).toBe('plan');
    expect(resolveSessionExecutionModeId({ executionMode: 'bypass', permissionMode: 'bypass' })).toBe('danger');
  });

  it('migrates rows that only have legacy permissionMode conservatively', () => {
    expect(executionModeFromPermissionMode('plan-only')).toBe('plan');
    expect(executionModeFromPermissionMode('auto-edits')).toBe('plan');
    expect(executionModeFromPermissionMode('standard')).toBe('plan');
    expect(executionModeFromPermissionMode('bypass')).toBe('danger');
    expect(executionModeFromPermissionMode(undefined)).toBe('ask');
  });

  it('lets explicit executionMode win and fails corrupt ids closed', () => {
    expect(resolveSessionExecutionModeId({ executionMode: 'ask', permissionMode: 'bypass' })).toBe('ask');
    expect(resolveSessionExecutionModeId({ executionMode: 'garbage', permissionMode: 'bypass' })).toBe('ask');
  });

  it('hydrates executionMode and permissionMode in lockstep', () => {
    expect(hydrateSessionModes({ executionMode: 'ask' })).toMatchObject({ executionMode: 'ask', permissionMode: 'plan-only' });
    expect(hydrateSessionModes({ executionMode: 'plan' })).toMatchObject({ executionMode: 'plan', permissionMode: 'plan-only' });
    expect(hydrateSessionModes({ executionMode: 'danger' })).toMatchObject({ executionMode: 'danger', permissionMode: 'auto-edits' });
    expect(hydrateSessionModes({ executionMode: 'agent' })).toMatchObject({ executionMode: 'plan', permissionMode: 'plan-only' });
  });
});
