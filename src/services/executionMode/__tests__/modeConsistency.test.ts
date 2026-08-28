import { describe, expect, it } from '@jest/globals';

import {
  EXECUTION_MODES,
  getAllowedToolsForMode,
  getExecutionMode,
  hydrateSessionModes,
  normalizeExecutionModeId,
  resolvePermissionMode,
  resolveSessionExecutionModeId,
} from '../index';
import { dbToSession, sessionToDb } from '@/utils/chatHelpers';
import enUS from '@/i18n/locales/en-US';
import zhCN from '@/i18n/locales/zh-CN';

describe('three-mode consistency', () => {
  it('keeps the product registry small and ordered', () => {
    expect(EXECUTION_MODES.map((mode) => mode.id)).toEqual(['ask', 'plan', 'danger']);
    expect(EXECUTION_MODES.filter((mode) => mode.isDefault).map((mode) => mode.id)).toEqual(['ask']);
    expect(EXECUTION_MODES.filter((mode) => mode.requiresWarning).map((mode) => mode.id)).toEqual(['danger']);
  });

  it('keeps every profile fully harnessed', () => {
    for (const profile of EXECUTION_MODES) {
      expect(profile.systemPromptSuffix.trim()).not.toBe('');
      expect(profile.systemPromptSuffix).toMatch(/HARNESS/);
      expect(enUS[profile.labelKey]).toBeTruthy();
      expect(enUS[profile.descriptionKey]).toBeTruthy();
      expect(zhCN[profile.labelKey]).toBeTruthy();
      expect(zhCN[profile.descriptionKey]).toBeTruthy();
    }
  });

  it('keeps permission mapping aligned with the hook layer', () => {
    expect(resolvePermissionMode('ask')).toBe('plan-only');
    expect(resolvePermissionMode('plan')).toBe('plan-only');
    expect(resolvePermissionMode('danger')).toBe('auto-edits');
  });

  it('keeps model-facing tool catalogs aligned with mode intent', () => {
    expect(getAllowedToolsForMode('ask')).toEqual([]);
    expect(getAllowedToolsForMode('plan')).toEqual(expect.arrayContaining(['read_file', 'list_files', 'search_files']));
    expect(getAllowedToolsForMode('plan')).not.toEqual(expect.arrayContaining(['write_file', 'delete_file', 'execute_command']));
    expect(getAllowedToolsForMode('danger')).toBeUndefined();
  });
});

describe('legacy mode compatibility', () => {
  it('maps old execution ids into the new product modes', () => {
    expect(normalizeExecutionModeId('debug')).toBe('plan');
    expect(normalizeExecutionModeId('agent')).toBe('plan');
    expect(normalizeExecutionModeId('bypass')).toBe('danger');
  });

  it('does not let stale permission data escalate a corrupt execution id', () => {
    expect(resolveSessionExecutionModeId({ executionMode: 'unknown', permissionMode: 'bypass' })).toBe('ask');
  });

  it('hydrates historical ids into active ids before persistence', () => {
    expect(hydrateSessionModes({ executionMode: 'debug', permissionMode: 'auto-edits' })).toMatchObject({
      executionMode: 'plan',
      permissionMode: 'plan-only',
    });
    expect(hydrateSessionModes({ executionMode: 'agent', permissionMode: 'auto-edits' })).toMatchObject({
      executionMode: 'plan',
      permissionMode: 'plan-only',
    });
    expect(hydrateSessionModes({ executionMode: 'bypass', permissionMode: 'bypass' })).toMatchObject({
      executionMode: 'danger',
      permissionMode: 'auto-edits',
    });
  });
});

describe('database roundtrip', () => {
  it('roundtrips each active mode with its derived permission mode', () => {
    for (const profile of EXECUTION_MODES) {
      const session = dbToSession(
        {
          id: `mode-${profile.id}`,
          title: profile.id,
          created_at: 1,
          updated_at: 2,
          cwd: null,
          project_id: null,
          model: null,
          work_dir: null,
          project_dir: null,
          pipi_output_dir: null,
          working_files: null,
          permission_mode: profile.permissionMode,
          execution_mode: profile.id,
        },
        [],
      );

      expect(session.executionMode).toBe(profile.id);
      expect(session.permissionMode).toBe(profile.permissionMode);

      const serialized = sessionToDb(session);
      expect(serialized.execution_mode).toBe(profile.id);
      expect(serialized.permission_mode).toBe(profile.permissionMode);
    }
  });

  it('normalizes historical database rows on hydration', () => {
    const legacyAgent = dbToSession(
      {
        id: 'legacy-agent',
        title: 'legacy',
        created_at: 1,
        updated_at: 1,
        cwd: null,
        project_id: null,
        model: null,
        work_dir: null,
        project_dir: null,
        pipi_output_dir: null,
        working_files: null,
        permission_mode: 'auto-edits',
        execution_mode: 'agent',
      },
      [],
    );
    expect(legacyAgent.executionMode).toBe('plan');
    expect(legacyAgent.permissionMode).toBe('plan-only');

    const legacyBypass = dbToSession(
      {
        id: 'legacy-bypass',
        title: 'legacy',
        created_at: 1,
        updated_at: 1,
        cwd: null,
        project_id: null,
        model: null,
        work_dir: null,
        project_dir: null,
        pipi_output_dir: null,
        working_files: null,
        permission_mode: 'bypass',
        execution_mode: 'bypass',
      },
      [],
    );
    expect(legacyBypass.executionMode).toBe('danger');
    expect(legacyBypass.permissionMode).toBe('auto-edits');
  });

  it('never serializes a legacy id after explicit hydration', () => {
    const normalized = hydrateSessionModes({ executionMode: 'agent', permissionMode: 'auto-edits' });
    expect(getExecutionMode(normalized.executionMode).id).toBe('plan');
  });
});
