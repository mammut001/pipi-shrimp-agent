import { dbToSession, sessionToDb, type DbMessage, type DbSession } from '../chatHelpers';
import type { Session } from '../../types/chat';
import { resolveSessionExecutionModeId } from '@/services/executionMode';

function makeDbSession(overrides: Partial<DbSession> = {}): DbSession {
  return {
    id: 'session-1',
    title: 'Test session',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    cwd: null,
    project_id: null,
    model: null,
    work_dir: null,
    working_files: null,
    permission_mode: null,
    project_dir: null,
    pipi_output_dir: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<DbMessage> = {}): DbMessage {
  return {
    id: 'm-1',
    session_id: 'session-1',
    role: 'user',
    content: 'hello',
    reasoning: null,
    attachments: null,
    artifacts: null,
    tool_calls: null,
    token_usage: null,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Test session',
    messages: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  } as Session;
}

describe('chatHelpers — two-folder model', () => {
  it('hydrates project/output folders without collapsing them', () => {
    const session = dbToSession(
      makeDbSession({
        work_dir: '/old/project',
        project_dir: '/new/project',
        pipi_output_dir: '/new/output',
      }),
      [],
    );
    expect(session.projectDir).toBe('/new/project');
    expect(session.workDir).toBe('/old/project');
    expect(session.pipiOutputDir).toBe('/new/output');
  });

  it('falls back to legacy work_dir when project_dir is missing', () => {
    const session = dbToSession(
      makeDbSession({ work_dir: '/legacy/only', project_dir: null }),
      [],
    );
    expect(session.projectDir).toBe('/legacy/only');
    expect(session.workDir).toBe('/legacy/only');
  });

  it('persists both folders for new sessions', () => {
    const row = sessionToDb(
      makeSession({ projectDir: '/repo/proj', pipiOutputDir: '/output/proj' }),
    );
    expect(row.project_dir).toBe('/repo/proj');
    expect(row.work_dir).toBe('/repo/proj');
    expect(row.pipi_output_dir).toBe('/output/proj');
  });

  it('roundtrips two-folder sessions without losing either folder', () => {
    const original = makeDbSession({
      work_dir: '/repo/proj',
      project_dir: '/repo/proj',
      pipi_output_dir: '/output/proj',
    });
    const roundtripped = sessionToDb(dbToSession(original, [makeMessage()]));
    expect(roundtripped.project_dir).toBe('/repo/proj');
    expect(roundtripped.work_dir).toBe('/repo/proj');
    expect(roundtripped.pipi_output_dir).toBe('/output/proj');
  });
});

describe('chatHelpers — three-mode hydration', () => {
  it('hydrates active Ask / Plan / Danger ids in lockstep with permission mode', () => {
    const ask = dbToSession(makeDbSession({ execution_mode: 'ask', permission_mode: 'plan-only' }), []);
    const plan = dbToSession(makeDbSession({ execution_mode: 'plan', permission_mode: 'plan-only' }), []);
    const danger = dbToSession(makeDbSession({ execution_mode: 'danger', permission_mode: 'auto-edits' }), []);

    expect(ask).toMatchObject({ executionMode: 'ask', permissionMode: 'plan-only' });
    expect(plan).toMatchObject({ executionMode: 'plan', permissionMode: 'plan-only' });
    expect(danger).toMatchObject({ executionMode: 'danger', permissionMode: 'auto-edits' });
  });

  it('migrates historical Agent/Debug to Plan and historical Bypass to Danger', () => {
    for (const id of ['agent', 'debug'] as const) {
      const session = dbToSession(
        makeDbSession({ execution_mode: id, permission_mode: 'auto-edits' }),
        [],
      );
      expect(session.executionMode).toBe('plan');
      expect(session.permissionMode).toBe('plan-only');
      expect(resolveSessionExecutionModeId(session)).toBe('plan');
    }

    const bypass = dbToSession(
      makeDbSession({ execution_mode: 'bypass', permission_mode: 'bypass' }),
      [],
    );
    expect(bypass.executionMode).toBe('danger');
    expect(bypass.permissionMode).toBe('auto-edits');
    expect(resolveSessionExecutionModeId(bypass)).toBe('danger');
  });

  it('migrates permission-only legacy rows conservatively', () => {
    const autoEdits = dbToSession(makeDbSession({ permission_mode: 'auto-edits' }), []);
    const bypass = dbToSession(makeDbSession({ permission_mode: 'bypass' }), []);
    expect(autoEdits).toMatchObject({ executionMode: 'plan', permissionMode: 'plan-only' });
    expect(bypass).toMatchObject({ executionMode: 'danger', permissionMode: 'auto-edits' });
  });

  it('fails a corrupt explicit execution_mode closed to Ask even if permission_mode says bypass', () => {
    const session = dbToSession(
      makeDbSession({ execution_mode: 'multitask', permission_mode: 'bypass' }),
      [],
    );
    expect(session).toMatchObject({ executionMode: 'ask', permissionMode: 'plan-only' });
  });

  it('persists active ids after hydration', () => {
    const dangerRow = sessionToDb(makeSession({ executionMode: 'danger', permissionMode: 'auto-edits' }));
    expect(dangerRow.execution_mode).toBe('danger');
    expect(dangerRow.permission_mode).toBe('auto-edits');

    const migrated = dbToSession(
      makeDbSession({ execution_mode: 'bypass', permission_mode: 'bypass' }),
      [],
    );
    const migratedRow = sessionToDb(migrated);
    expect(migratedRow.execution_mode).toBe('danger');
    expect(migratedRow.permission_mode).toBe('auto-edits');
  });
});
