/**
 * sessionFolders — two-folder model helpers
 *
 * Covers:
 * - getSessionProjectDir: prefers `projectDir`, falls back to `workDir`.
 * - getSessionPipiOutputDir: prefers `pipiOutputDir`, falls back to the
 *   deterministic app-managed default.
 * - Roundtrip-style guard: passing only a legacy `workDir` still
 *   resolves to a Project Folder so old sessions keep working.
 */

import {
  PIPI_OUTPUT_DIR_FALLBACK_PREFIX,
  getDefaultPipiOutputDirForSession,
  getSessionPipiOutputDir,
  getSessionProjectDir,
  hasSessionPipiOutputDir,
  hasSessionProjectDir,
} from '../sessionFolders';
import type { Session } from '../../types/chat';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-abc',
    title: 'Test',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Session;
}

describe('sessionFolders', () => {
  describe('getSessionProjectDir', () => {
    it('prefers the new `projectDir` field when set', () => {
      const session = makeSession({ projectDir: '/repo/new', workDir: '/repo/legacy' });
      expect(getSessionProjectDir(session)).toBe('/repo/new');
    });

    it('falls back to the legacy `workDir` for pre-v7 sessions', () => {
      const session = makeSession({ workDir: '/repo/legacy' });
      expect(getSessionProjectDir(session)).toBe('/repo/legacy');
    });

    it('returns undefined when neither field is set', () => {
      expect(getSessionProjectDir(makeSession())).toBeUndefined();
    });

    it('returns undefined for null / undefined session', () => {
      expect(getSessionProjectDir(null)).toBeUndefined();
      expect(getSessionProjectDir(undefined)).toBeUndefined();
    });

    it('handles a session that only has `projectDir`', () => {
      const session = makeSession({ projectDir: '/just/project' });
      expect(getSessionProjectDir(session)).toBe('/just/project');
    });
  });

  describe('getSessionPipiOutputDir', () => {
    it('returns the explicit `pipiOutputDir` when set', () => {
      const session = makeSession({ pipiOutputDir: '/custom/output' });
      expect(getSessionPipiOutputDir(session)).toBe('/custom/output');
    });

    it('falls back to the app-managed default path when unset', () => {
      const session = makeSession({ id: 'session-42' });
      const result = getSessionPipiOutputDir(session);
      expect(result).toBe(`${PIPI_OUTPUT_DIR_FALLBACK_PREFIX}/session-42`);
    });

    it('handles sessions with a null id by using the placeholder', () => {
      const session = { id: null } as unknown as Session;
      expect(getSessionPipiOutputDir(session)).toBe(`${PIPI_OUTPUT_DIR_FALLBACK_PREFIX}/session`);
    });

    it('returns undefined for null / undefined session', () => {
      expect(getSessionPipiOutputDir(null)).toBeUndefined();
      expect(getSessionPipiOutputDir(undefined)).toBeUndefined();
    });
  });

  describe('getDefaultPipiOutputDirForSession', () => {
    it('builds a stable per-session default', () => {
      expect(getDefaultPipiOutputDirForSession('s1')).toBe(`${PIPI_OUTPUT_DIR_FALLBACK_PREFIX}/s1`);
    });

    it('trims and falls back to a placeholder for empty / nullish ids', () => {
      expect(getDefaultPipiOutputDirForSession('   ')).toBe(`${PIPI_OUTPUT_DIR_FALLBACK_PREFIX}/session`);
      expect(getDefaultPipiOutputDirForSession(null)).toBe(`${PIPI_OUTPUT_DIR_FALLBACK_PREFIX}/session`);
      expect(getDefaultPipiOutputDirForSession(undefined)).toBe(`${PIPI_OUTPUT_DIR_FALLBACK_PREFIX}/session`);
    });
  });

  describe('hasSessionProjectDir / hasSessionPipiOutputDir', () => {
    it('returns true when the field is set, false otherwise', () => {
      expect(hasSessionProjectDir(makeSession({ projectDir: '/p' }))).toBe(true);
      expect(hasSessionProjectDir(makeSession({ workDir: '/p' }))).toBe(true);
      expect(hasSessionProjectDir(makeSession())).toBe(false);

      expect(hasSessionPipiOutputDir(makeSession({ pipiOutputDir: '/o' }))).toBe(true);
      expect(hasSessionPipiOutputDir(makeSession())).toBe(false);
    });

    it('treats empty strings as missing', () => {
      expect(hasSessionProjectDir(makeSession({ projectDir: '' }))).toBe(false);
      expect(hasSessionPipiOutputDir(makeSession({ pipiOutputDir: '' }))).toBe(false);
    });
  });

  describe('two-folder model integration', () => {
    it('a new session can have projectDir ≠ pipiOutputDir', () => {
      const session = makeSession({
        projectDir: '/home/user/awesome-project',
        pipiOutputDir: '/home/user/.local/share/PiPi-Shrimp/chats/s1',
      });
      expect(getSessionProjectDir(session)).toBe('/home/user/awesome-project');
      expect(getSessionPipiOutputDir(session)).toBe('/home/user/.local/share/PiPi-Shrimp/chats/s1');
    });

    it('a legacy workDir-only session still resolves to a Project Folder', () => {
      const session = makeSession({ workDir: '/home/user/awesome-project' });
      // No `projectDir` set, but `getSessionProjectDir` still returns a path
      // so the prompt / tool calls keep working.
      expect(getSessionProjectDir(session)).toBe('/home/user/awesome-project');
      // The PiPi Output Folder falls back to the app-managed default.
      expect(getSessionPipiOutputDir(session)).toBe(`${PIPI_OUTPUT_DIR_FALLBACK_PREFIX}/session-abc`);
    });
  });
});
