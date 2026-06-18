/**
 * chatHelpers — Session / DB roundtrip helpers
 *
 * Two-folder model coverage:
 * - Legacy workDir-only sessions roundtrip through the database
 *   (projectDir falls back to workDir).
 * - New sessions with separate `projectDir` and `pipiOutputDir`
 *   roundtrip without losing either field.
 * - `dbToSession` populates `workDir` from `project_dir` for
 *   backward compat with pre-v7 callers.
 */

import { dbToSession, sessionToDb, type DbMessage, type DbSession } from '../chatHelpers';
import type { Session } from '../../types/chat';

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
  describe('dbToSession', () => {
    it('hydrates `projectDir` from `project_dir` and `workDir` from `work_dir`', () => {
      const session = dbToSession(
        makeDbSession({
          work_dir: '/repo/legacy',
          project_dir: '/repo/legacy',
          pipi_output_dir: '/output/legacy',
        }),
        [],
      );
      expect(session.projectDir).toBe('/repo/legacy');
      expect(session.workDir).toBe('/repo/legacy');
      expect(session.pipiOutputDir).toBe('/output/legacy');
    });

    it('falls back to `work_dir` when `project_dir` is null (pre-v7 rows)', () => {
      const session = dbToSession(
        makeDbSession({
          work_dir: '/legacy/only',
          project_dir: null,
          pipi_output_dir: null,
        }),
        [],
      );
      expect(session.projectDir).toBe('/legacy/only');
      expect(session.workDir).toBe('/legacy/only');
      expect(session.pipiOutputDir).toBeUndefined();
    });

    it('lets new `project_dir` win over `work_dir` (different folders)', () => {
      // Migration correctness: the v7 migration copies work_dir →
      // project_dir, but a later bind can move project_dir without
      // touching the legacy mirror. dbToSession must surface the
      // new value.
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

    it('produces an undefined projectDir for empty sessions', () => {
      const session = dbToSession(makeDbSession(), []);
      expect(session.projectDir).toBeUndefined();
      expect(session.workDir).toBeUndefined();
      expect(session.pipiOutputDir).toBeUndefined();
    });

    it('hydrates executionMode from execution_mode and syncs permissionMode', () => {
      const session = dbToSession(
        makeDbSession({
          execution_mode: 'bypass',
          permission_mode: 'bypass',
        }),
        [],
      );
      expect(session.executionMode).toBe('bypass');
      expect(session.permissionMode).toBe('bypass');
    });

    it('hydrates legacy bypass rows that only have permission_mode', () => {
      const session = dbToSession(
        makeDbSession({
          permission_mode: 'bypass',
        }),
        [],
      );
      expect(session.executionMode).toBe('bypass');
      expect(session.permissionMode).toBe('bypass');
    });

    it('defaults blank rows to Ask mode', () => {
      const session = dbToSession(makeDbSession(), []);
      expect(session.executionMode).toBe('ask');
      expect(session.permissionMode).toBe('plan-only');
    });

    // SAFETY REGRESSION — dbToSession used to pre-filter
    // `dbSession.execution_mode` through `isExecutionModeId` before
    // calling `hydrateSessionModes`. That silently nullified the
    // safety net in `resolveSessionExecutionModeId` which collapses a
    // present-but-invalid `executionMode` to Ask instead of falling
    // through to the legacy `permissionMode` column (which could be
    // Bypass). The fix is to pass the raw value through unchanged.
    it('invalid execution_mode string + permission_mode=bypass collapses to Ask (no Bypass inheritance)', () => {
      const session = dbToSession(
        makeDbSession({
          execution_mode: 'multitask',
          permission_mode: 'bypass',
        }),
        [],
      );
      expect(session.executionMode).toBe('ask');
      expect(session.permissionMode).toBe('plan-only');
    });

    it('null execution_mode + permission_mode=bypass still hydrates to Bypass (legacy row preserved)', () => {
      const session = dbToSession(
        makeDbSession({
          execution_mode: null,
          permission_mode: 'bypass',
        }),
        [],
      );
      expect(session.executionMode).toBe('bypass');
      expect(session.permissionMode).toBe('bypass');
    });

    it('null execution_mode + permission_mode=plan-only hydrates to Plan', () => {
      const session = dbToSession(
        makeDbSession({
          execution_mode: null,
          permission_mode: 'plan-only',
        }),
        [],
      );
      expect(session.executionMode).toBe('plan');
      expect(session.permissionMode).toBe('plan-only');
    });

    it('garbage execution_mode + null permission_mode still collapses to Ask', () => {
      const session = dbToSession(
        makeDbSession({
          execution_mode: 'totally-not-a-mode',
          permission_mode: null,
        }),
        [],
      );
      expect(session.executionMode).toBe('ask');
      expect(session.permissionMode).toBe('plan-only');
    });

    // dbToSession preserves `execution_mode` exactly so the
    // ChatInput-selected mode id flows through unchanged.
    it('execution_mode is preserved verbatim when it is a known id', () => {
      for (const id of ['ask', 'plan', 'debug', 'agent', 'bypass'] as const) {
        const session = dbToSession(
          makeDbSession({
            execution_mode: id,
            permission_mode: 'plan-only',
          }),
          [],
        );
        expect(session.executionMode).toBe(id);
      }
    });

    // ChatInput's dropdown selection is then handed to chatActions as
    // the same id. We assert the equality via the canonical resolver
    // so any drift between dropdown rendering and the engine would
    // surface here.
    it('ChatInput-selected execution mode id equals the resolver result on the loaded session', async () => {
      const { resolveSessionExecutionModeId } = await import(
        '@/services/executionMode'
      );
      for (const id of ['ask', 'plan', 'debug', 'agent', 'bypass'] as const) {
        const session = dbToSession(
          makeDbSession({
            execution_mode: id,
            permission_mode: 'plan-only',
          }),
          [],
        );
        // Both ChatInput (selectedExecutionModeId) and chatActions
        // (executionModeId) read from the same resolver.
        expect(resolveSessionExecutionModeId(session)).toBe(id);
        expect(resolveSessionExecutionModeId(session)).toBe(session.executionMode);
      }
    });
  });

  describe('sessionToDb', () => {
    it('persists both `projectDir` and `pipiOutputDir` for new sessions', () => {
      const row = sessionToDb(
        makeSession({
          projectDir: '/repo/proj',
          pipiOutputDir: '/output/proj',
        }),
      );
      expect(row.project_dir).toBe('/repo/proj');
      expect(row.pipi_output_dir).toBe('/output/proj');
      expect(row.execution_mode).toBeNull();
      // The legacy mirror stays in sync so a downgrade still works.
      expect(row.work_dir).toBe('/repo/proj');
    });

    it('mirrors `projectDir` into `work_dir` even when only the new field is set', () => {
      const row = sessionToDb(makeSession({ projectDir: '/just/project' }));
      expect(row.project_dir).toBe('/just/project');
      expect(row.work_dir).toBe('/just/project');
      expect(row.pipi_output_dir).toBeNull();
    });

    it('falls back to `workDir` when `projectDir` is missing (legacy sessions)', () => {
      const row = sessionToDb(makeSession({ workDir: '/legacy/only' }));
      expect(row.project_dir).toBe('/legacy/only');
      expect(row.work_dir).toBe('/legacy/only');
    });

    it('persists null for an empty session', () => {
      const row = sessionToDb(makeSession());
      expect(row.project_dir).toBeNull();
      expect(row.work_dir).toBeNull();
      expect(row.pipi_output_dir).toBeNull();
    });

    it('persists execution_mode for bypass sessions', () => {
      const row = sessionToDb(makeSession({
        executionMode: 'bypass',
        permissionMode: 'bypass',
      }));
      expect(row.execution_mode).toBe('bypass');
      expect(row.permission_mode).toBe('bypass');
    });
  });

  describe('roundtrip', () => {
    it('a legacy workDir-only session survives db → session → db', () => {
      const original = makeDbSession({
        work_dir: '/repo/legacy',
        project_dir: null,
        pipi_output_dir: null,
      });
      const session = dbToSession(original, [makeMessage()]);
      const roundtripped = sessionToDb(session);
      // After the first roundtrip, project_dir is now populated (via
      // the workDir fallback in sessionToDb). Both fields point at
      // the same folder — the contract new code can rely on.
      expect(roundtripped.project_dir).toBe('/repo/legacy');
      expect(roundtripped.work_dir).toBe('/repo/legacy');
      expect(roundtripped.pipi_output_dir).toBeNull();
    });

    it('a two-folder session survives db → session → db without losing fields', () => {
      const original = makeDbSession({
        work_dir: '/repo/proj',
        project_dir: '/repo/proj',
        pipi_output_dir: '/output/proj',
      });
      const session = dbToSession(original, [makeMessage()]);
      const roundtripped = sessionToDb(session);
      expect(roundtripped.project_dir).toBe('/repo/proj');
      expect(roundtripped.pipi_output_dir).toBe('/output/proj');
      expect(roundtripped.work_dir).toBe('/repo/proj');
    });
  });
});
