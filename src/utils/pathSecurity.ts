/**
 * Path security utilities — mirrors the Rust `path_security::is_within_dir`
 * helper so the same sibling-prefix-escape protection is enforced on the
 * frontend as on the backend.
 *
 * AUDIT-FIX [fix-1#1-ff] — `starts_with` based workdir checks were systemic
 * across the codebase (5+ call sites). They allow a sibling path that shares
 * the prefix to slip past (`/Users/alice/project2` passing for
 * `/Users/alice/project`). This helper enforces a strict directory
 * boundary by normalising the trailing separator of the parent before the
 * lexical comparison, matching the Rust implementation.
 *
 * Pure function — does not touch the filesystem. Pass already-canonical
 * paths when possible.
 */

const TRAILING_SEP_PATTERN = /[\\/]+$/;

/**
 * Returns true when `child` equals `parent` or is a strict descendant of it.
 *
 * @param child  Candidate path (may be relative or absolute, must be
 *               canonicalised when possible so `..` and symlinks are
 *               already resolved).
 * @param parent Directory `child` must lie inside.
 */
export function isWithinDir(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  if (child === parent) return true;
  const parentWithSep = ensureTrailingSeparator(parent);
  return child.startsWith(parentWithSep);
}

function ensureTrailingSeparator(p: string): string {
  if (TRAILING_SEP_PATTERN.test(p)) return p;
  // Pick a separator that exists in the path so Windows-style roots like
  // `C:\` stay intact; otherwise default to forward slash for Unix paths.
  const hasBackslash = p.includes('\\');
  return `${p}${hasBackslash ? '\\' : '/'}`;
}
