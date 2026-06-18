/**
 * Session folder helpers
 *
 * The two-folder model splits the previous single "workDir" concept into:
 *
 *   1. Project Folder (`projectDir`) — the user's actual repo/project path.
 *      Tools run commands and read/write project files relative to this
 *      folder. This is the equivalent of the legacy `workDir` field, and
 *      old sessions that only have `workDir` continue to work through the
 *      {@link getSessionProjectDir} helper.
 *
 *   2. PiPi Output Folder (`pipiOutputDir`) — the app-owned output root.
 *      Stores `.pipi-shrimp/`, generated docs, memory, chat outputs, and
 *      AutoResearch artifacts. This folder is intentionally kept *out* of
 *      the user's project repo so the agent's work product does not pollute
 *      the project tree.
 *
 * All callers (chat store, prompt builder, headless runner, AutoResearch,
 * tools, memory services) should resolve folders through these helpers
 * rather than reaching into `session.workDir` directly. This makes the
 * legacy → new migration testable in one place and prevents drift between
 * the new and old code paths.
 */
import type { Session } from '../types/chat';
import { safeInvokeOrNull } from './safeInvoke';

/**
 * The Rust-side default PiPi Output Folder is computed by
 * `get_app_default_dir({ session_id })` and lives at
 * `{Documents|HOME}/PiPi-Shrimp/chats/{session_id}/`. We mirror the same
 * shape on the JS side so helpers stay pure (no Tauri invoke in the
 * default branch) — callers who want a real, on-disk path should use
 * `safeInvoke('get_app_default_dir', { sessionId })`. The fallback
 * string is only used when the JS side needs a stable placeholder (e.g.
 * unit tests, i18n tooltips, prompt previews).
 */
export const PIPI_OUTPUT_DIR_FALLBACK_PREFIX = 'PiPi-Shrimp/chats';

/**
 * Build a placeholder PiPi Output Folder path for a given session id.
 * Matches the path the Rust `get_app_default_dir` command produces, but
 * without touching the filesystem.
 */
export function getDefaultPipiOutputDirForSession(sessionId: string | null | undefined): string {
  const safeId = (sessionId ?? '').trim() || 'session';
  // Forward slashes; the Rust side joins with the platform's document_dir
  // and converts. Callers that need the real path must invoke
  // `get_app_default_dir` via Tauri; this helper is for *naming* only.
  return `${PIPI_OUTPUT_DIR_FALLBACK_PREFIX}/${safeId}`;
}

/**
 * Resolve the Project Folder for a session.
 *
 * Falls back to the legacy `workDir` field so old sessions that predate
 * the two-folder migration keep working. Returns `undefined` if neither
 * is set.
 */
export function getSessionProjectDir(session: Pick<Session, 'projectDir' | 'workDir'> | null | undefined): string | undefined {
  if (!session) return undefined;
  return session.projectDir ?? session.workDir ?? undefined;
}

/**
 * Resolve the PiPi Output Folder for a session.
 *
 * - Uses `session.pipiOutputDir` if set.
 * - Otherwise falls back to the per-session app-managed default path
 *   (`getDefaultPipiOutputDirForSession`). Callers that need the real
 *   on-disk path (and want the directory to exist) should use the
 *   `get_app_default_dir` Tauri command.
 */
export function getSessionPipiOutputDir(session: Pick<Session, 'id' | 'pipiOutputDir'> | null | undefined): string | undefined {
  if (!session) return undefined;
  if (session.pipiOutputDir) return session.pipiOutputDir;
  return getDefaultPipiOutputDirForSession(session.id);
}

/**
 * Resolve the real, on-disk PiPi Output Folder for a session.
 *
 * The JS-only `getSessionPipiOutputDir` helper returns a placeholder
 * (`PiPi-Shrimp/chats/<id>`) when `pipiOutputDir` is not persisted — that
 * string is for *naming* only (tooltips, prompt previews, unit tests).
 * It is NOT safe to feed into `create_directory`, `read_file`, `get_next_output_dir`
 * or any other filesystem call because nothing has actually joined it
 * with the platform's Documents folder yet.
 *
 * This helper performs the real resolution by invoking the Rust
 * `get_app_default_dir` command. It returns:
 *   - `session.pipiOutputDir` if it is already persisted (the user
 *     explicitly bound a folder), OR
 *   - the on-disk path returned by `get_app_default_dir({ sessionId })`,
 *     OR
 *   - `undefined` if neither is available (e.g. session is null or the
 *     Tauri runtime is not present in tests).
 *
 * Callers should pass `undefined` through (skip the operation) rather
 * than fall back to the placeholder for any real filesystem I/O.
 */
export async function resolveRealSessionPipiOutputDir(
  session: Pick<Session, 'id' | 'pipiOutputDir'> | null | undefined,
): Promise<string | undefined> {
  if (!session) return undefined;
  if (session.pipiOutputDir) return session.pipiOutputDir;
  try {
    const realPath = await safeInvokeOrNull<string>(
      'get_app_default_dir',
      { sessionId: session.id },
      { source: 'sessionFolders.resolveRealSessionPipiOutputDir' },
    );
    if (typeof realPath === 'string' && realPath.length > 0) {
      return realPath;
    }
  } catch {
    // safeInvokeOrNull already swallows Tauri runtime errors; treat any
    // unexpected exception as "no real path available" so callers can
    // skip the operation instead of writing into the placeholder.
  }
  return undefined;
}

/**
 * True when the session has a Project Folder bound (either via the new
 * `projectDir` field or the legacy `workDir`). Used to gate UI affordances
 * that only make sense for repo-bound sessions.
 */
export function hasSessionProjectDir(session: Pick<Session, 'projectDir' | 'workDir'> | null | undefined): boolean {
  return Boolean(getSessionProjectDir(session));
}

/**
 * True when the session has an explicit, persisted PiPi Output Folder
 * (the `pipiOutputDir` column is set). Distinct from
 * {@link hasSessionProjectDir}: even an "empty" session has a default
 * output dir; we only count it as "set" when the user (or auto-init)
 * persisted one.
 */
export function hasSessionPipiOutputDir(session: Pick<Session, 'pipiOutputDir'> | null | undefined): boolean {
  return Boolean(session?.pipiOutputDir);
}
