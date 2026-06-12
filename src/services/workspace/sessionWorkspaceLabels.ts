/**
 * Session workspace labels
 *
 * Pure helpers that distinguish "Workspace Folder" (the session's workDir,
 * where the agent can run tools and write project files) from "Context
 * Files" (files attached to a single chat for reference).
 *
 * Behaviour, not just wording, is enforced here: we only show "inside
 * workspace" / "external reference" badges based on path math, and we
 * render relative paths whenever we can so the UI does not leak the
 * user's full home directory.
 */

const PATH_SEPARATORS = /[\\/]/;

function normalizeSlashes(input: string): string {
  return input.replace(/\\/g, '/');
}

function trimTrailingSeparator(input: string): string {
  return input.replace(/[\\/]+$/, '');
}

function splitSegments(input: string): string[] {
  return normalizeSlashes(trimTrailingSeparator(input))
    .split(PATH_SEPARATORS)
    .filter((segment) => segment.length > 0);
}

/**
 * Returns the final segment of a path, or the original string if there is
 * no separator. Used for compact folder/file chips.
 */
export function getWorkspaceDisplayName(path: string | null | undefined, fallback = ''): string {
  if (!path) return fallback;
  const segments = splitSegments(path);
  if (segments.length === 0) return path;
  return segments[segments.length - 1] ?? fallback;
}

/**
 * Treat two paths as equal if they point at the same file/folder on disk,
 * ignoring trailing separators and the slash style. Returns false for
 * empty inputs.
 */
export function isSamePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = trimTrailingSeparator(normalizeSlashes(a)).toLowerCase();
  const right = trimTrailingSeparator(normalizeSlashes(b)).toLowerCase();
  if (left === right) return true;
  // Windows is case-insensitive; the lowercase above already covers that.
  return left === right;
}

/**
 * Check whether `filePath` lives inside `workspacePath`. Both paths are
 * normalized to forward slashes and stripped of trailing separators before
 * comparison, so the helper is robust to "C:\\foo" vs "C:/foo" vs "C:/foo/".
 */
export function isContextFileInsideWorkspace(
  filePath: string | null | undefined,
  workspacePath: string | null | undefined,
): boolean {
  if (!filePath || !workspacePath) return false;
  const fileSegments = splitSegments(filePath);
  const workspaceSegments = splitSegments(workspacePath);
  if (workspaceSegments.length === 0 || fileSegments.length === 0) return false;
  // Path equality is not "inside": a file path that exactly matches the
  // workspace path is the workspace itself, not a descendant. We require
  // a strict prefix of equal-length workspace segments plus at least one
  // additional segment for the file name.
  if (fileSegments.length <= workspaceSegments.length) return false;

  for (let i = 0; i < workspaceSegments.length; i += 1) {
    if (fileSegments[i].toLowerCase() !== workspaceSegments[i].toLowerCase()) {
      return false;
    }
  }
  return true;
}

/**
 * Return `filePath` as a workspace-relative path when it lives inside the
 * workspace, or the original (absolute) path otherwise. Empty / missing
 * inputs are returned as-is so the caller can decide how to render them.
 */
export function formatContextFilePath(
  filePath: string | null | undefined,
  workspacePath: string | null | undefined,
): string {
  if (!filePath) return '';
  if (!workspacePath) return filePath;
  if (!isContextFileInsideWorkspace(filePath, workspacePath)) return filePath;

  const fileSegments = splitSegments(filePath);
  const workspaceSegments = splitSegments(workspacePath);
  const relative = fileSegments.slice(workspaceSegments.length);
  if (relative.length === 0) return '.';
  return relative.join('/');
}

/**
 * Convenience: returns the parent directory of `filePath` (one level up),
 * or `''` if the path has no parent (e.g. a single segment or a Windows
 * drive root like "C:\").
 *
 * Used by the "Set parent folder as workspace?" affordance to avoid sending
 * the dragged file's directory straight to the folder picker without
 * confirming it.
 */
export function getParentDirectory(filePath: string | null | undefined): string {
  if (!filePath) return '';
  const segments = splitSegments(filePath);
  if (segments.length <= 1) return '';
  // join with forward slashes — fine because the result is fed into the
  // folder picker dialog, which understands either separator.
  return segments.slice(0, -1).join('/');
}
