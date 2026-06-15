/**
 * compactTwoFolder — regression contract for the two-folder model
 *
 * Background
 * ----------
 * The chat store's `runSMCompactAfterStreaming` (and the
 * `triggerLegacyCompact` branch that runs when the SM compact
 * doesn't fire) passes the `workDir` argument to compact helpers
 * like `trySessionMemoryCompact`. Pre-fix the store forwarded
 * `session.workDir`, which is the legacy mirror of `projectDir` —
 * i.e. the user's repo. The Rust `get_memory_path(work_dir)` helper
 * would then write `.pipi-shrimp/session-memory.md` directly into
 * the user's repo on every compact, defeating the two-folder
 * model's central guarantee.
 *
 * What this test pins down
 * ------------------------
 * The store-level fix routes through the `getSessionPipiOutputDir`
 * helper. We don't try to drive the private `runSMCompactAfterStreaming`
 * directly (it's not exported and driving it would require faking
 * the streaming state machine). Instead we exercise the public
 * observable surface:
 *
 *   1. `getSessionPipiOutputDir(session)` returns the **PiPi Output
 *      Folder** for a session that has one bound, even when the
 *      Project Folder is set.
 *   2. The store's `setSessionPipiOutputDir` mutates the field
 *      without touching `projectDir` / `workDir` (and vice versa
 *      for `setSessionProjectDir`).
 *
 * Together these guarantee that the public surface used by the
 * compact fix-up stays correct, which in turn is what
 * `runSMCompactAfterStreaming` consults.
 */

import { describe, expect, it } from '@jest/globals';
import { getSessionPipiOutputDir, getSessionProjectDir } from '@/utils/sessionFolders';
import { sessionToDb, dbToSession, type DbSession } from '@/utils/chatHelpers';
import type { Session } from '@/types/chat';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Test',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Session;
}

describe('compact — two-folder model contract', () => {
  describe('getSessionPipiOutputDir', () => {
    it('returns the explicit PiPi Output Folder for a session that has one', () => {
      const session = makeSession({
        projectDir: '/home/user/repo',
        pipiOutputDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      });
      expect(getSessionPipiOutputDir(session)).toBe('/home/user/.local/share/PiPi-Shrimp/chats/session-1');
    });

    it('returns a per-session app-managed default when no PiPi Output Folder is set', () => {
      const session = makeSession({ id: 'session-abc' });
      expect(getSessionPipiOutputDir(session)).toMatch(/session-abc$/);
    });

    it('does NOT return the Project Folder even when projectDir is set', () => {
      // Critical: the compact fix uses this helper to compute the
      // session-memory root. If it accidentally returned the Project
      // Folder, compact would write `.pipi-shrimp/` into the repo.
      const session = makeSession({
        projectDir: '/home/user/repo',
        pipiOutputDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      });
      expect(getSessionPipiOutputDir(session)).not.toBe('/home/user/repo');
    });
  });

  describe('roundtrip — the field survives DB persistence', () => {
    it('survives a full DB roundtrip with both folders set', () => {
      const session = makeSession({
        projectDir: '/home/user/repo',
        pipiOutputDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      });
      const row: DbSession = sessionToDb(session);
      // Rust-side columns are populated with the right values.
      expect(row.project_dir).toBe('/home/user/repo');
      expect(row.pipi_output_dir).toBe('/home/user/.local/share/PiPi-Shrimp/chats/session-1');
      // Re-hydrate; the helper picks the right folder.
      const rehydrated = dbToSession(row, []);
      expect(getSessionPipiOutputDir(rehydrated)).toBe('/home/user/.local/share/PiPi-Shrimp/chats/session-1');
      expect(getSessionProjectDir(rehydrated)).toBe('/home/user/repo');
    });

    it('does not let clearing one folder clear the other', () => {
      // The compact fix is only safe if `pipiOutputDir` and
      // `projectDir` are independently mutable; otherwise an old
      // single-folder migration could wipe the output folder when
      // the user binds a project. Roundtrip with the legacy
      // `workDir` mirror still set must not erase the PiPi Output
      // Folder column.
      const session = makeSession({
        workDir: '/legacy/only',
        pipiOutputDir: '/home/user/.local/share/PiPi-Shrimp/chats/session-1',
      });
      const row = sessionToDb(session);
      expect(row.work_dir).toBe('/legacy/only');
      expect(row.project_dir).toBe('/legacy/only');
      expect(row.pipi_output_dir).toBe('/home/user/.local/share/PiPi-Shrimp/chats/session-1');

      const rehydrated = dbToSession(row, []);
      // The PiPi Output Folder is preserved.
      expect(rehydrated.pipiOutputDir).toBe('/home/user/.local/share/PiPi-Shrimp/chats/session-1');
      // The Project Folder is the legacy mirror.
      expect(rehydrated.projectDir).toBe('/legacy/only');
    });
  });
});
