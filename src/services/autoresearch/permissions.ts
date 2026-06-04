/**
 * AutoResearch Harness — Permission Profiles
 *
 * Inspired by Codex CLI sandbox/permission profiles. Three built-in
 * profiles provide progressively more capability:
 *
 *   - read_only:           catalog only, no shell, no file writes.
 *   - workspace_write:     read everything in workspace, write inside
 *                          iteration codeDir / runDir only.
 *   - danger_full_access:  no restrictions (still validated by Rust
 *                          dangerous-command blocklist in real Tauri runs).
 *
 * Profiles are enforced *in code* by the harness before the agent or
 * shell is invoked. They are also surfaced in prompts so the agent
 * understands what it is allowed to do.
 *
 * Adding a new profile is intentionally cheap: extend
 * `PROFILE_CATALOG` and any new check in `enforce*` helpers.
 */

import * as path from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PermissionProfileId = 'read_only' | 'workspace_write' | 'danger_full_access';

export type NetworkPolicy = 'deny' | 'allow_loopback' | 'allow';

export interface PermissionProfile {
  id: PermissionProfileId;
  label: string;
  description: string;
  /** Roots the harness may read from (in addition to the workspace). */
  allowedReadRoots: string[];
  /** Roots the harness may write to. Anything outside is rejected. */
  allowedWriteRoots: string[];
  /**
   * Path globs / literal prefixes that are forbidden in both read and write
   * paths. Common secret paths land here.
   */
  forbiddenPaths: string[];
  /** Network policy placeholder. Currently advisory in the harness layer. */
  networkPolicy: NetworkPolicy;
  /** Allow arbitrary shell commands? */
  allowShellCommands: boolean;
  /** Allow file writes through the harness? */
  allowFileWrites: boolean;
  /** Maximum number of files that may be changed in one iteration. */
  maxChangedFiles: number;
  /** Maximum diff size in bytes (unified diff). 0 = unlimited. */
  maxDiffBytes: number;
  /** Maximum shell command timeout in seconds. */
  maxCommandTimeoutSecs: number;
  /**
   * Hard block list of shell command patterns. Matched case-insensitively
   * against the raw command string. Deny always wins.
   */
  dangerousCommandPatterns: RegExp[];
  /**
   * Paths that may never be written to, regardless of allowedWriteRoots.
   * Used for things like .git/config and LICENSE.
   */
  writeDenyList: string[];
}

// ─── Common defaults ─────────────────────────────────────────────────────────

/**
 * Common shell patterns that are never safe inside the harness.
 * The list is intentionally conservative; it is enforced regardless of
 * the active profile.
 */
const COMMON_DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*f[a-z]*\s+|-[a-z]*r[a-z]*f[a-z]*\s+|--force\s+)/i,
  /\bmkfs(\.[a-z0-9]+)?\b/i,
  /\bdd\s+if=/i,
  /\bshred\b/i,
  /\b:\(\)\s*\{[^}]*\}\s*;\s*:/i, // fork bomb
  /\bchmod\s+(-R\s+)?777\b/i,
  /\bchown\s+-R\s+root\b/i,
  /\bsudo\b/i,
  /\bsu\s+-?\s*root\b/i,
  /\b(wget|curl)\b[^\n]*\|\s*(bash|sh)\b/i,
  /\b(sh|bash|ksh|zsh)\s+-c\b[^]*\brm\s+-rf\s+\//i,
  /\b(format|mkfs\.fat|mkfs\.ext[234]|mkfs\.ntfs|parted|fdisk)\b/i,
  /\b(crontab|at)\b\s+-r\b/i,
];

const COMMON_FORBIDDEN_READ_PATHS = [
  '.git/config',
  '.git/credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.ssh/id_rsa',
  '.ssh/id_ed25519',
  '.ssh/known_hosts',
  'secrets/',
  'credentials/',
];

const COMMON_WRITE_DENY_LIST = [
  '.git/config',
  '.git/hooks/',
  'LICENSE',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

// ─── Profile catalog ─────────────────────────────────────────────────────────

export const PROFILE_CATALOG: Record<PermissionProfileId, PermissionProfile> = {
  read_only: {
    id: 'read_only',
    label: 'Read-only',
    description:
      'Read the codebase, run no shell commands, write nothing. Suitable for AUDIT/READ_CONTEXT-only phases.',
    allowedReadRoots: ['<workspace>'],
    allowedWriteRoots: [],
    forbiddenPaths: COMMON_FORBIDDEN_READ_PATHS,
    networkPolicy: 'deny',
    allowShellCommands: false,
    allowFileWrites: false,
    maxChangedFiles: 0,
    maxDiffBytes: 0,
    maxCommandTimeoutSecs: 0,
    dangerousCommandPatterns: COMMON_DANGEROUS_COMMAND_PATTERNS,
    writeDenyList: COMMON_WRITE_DENY_LIST,
  },

  workspace_write: {
    id: 'workspace_write',
    label: 'Workspace write',
    description:
      'Read workspace freely, run shell commands, but only write inside the iteration codeDir / runDir. Default for self-improve mode.',
    allowedReadRoots: ['<workspace>'],
    allowedWriteRoots: ['<iter_code_dir>', '<iter_run_dir>', '<session_run_dir>'],
    forbiddenPaths: COMMON_FORBIDDEN_READ_PATHS,
    networkPolicy: 'allow_loopback',
    allowShellCommands: true,
    allowFileWrites: true,
    maxChangedFiles: 25,
    maxDiffBytes: 512 * 1024, // 512 KB
    maxCommandTimeoutSecs: 600,
    dangerousCommandPatterns: COMMON_DANGEROUS_COMMAND_PATTERNS,
    writeDenyList: COMMON_WRITE_DENY_LIST,
  },

  danger_full_access: {
    id: 'danger_full_access',
    label: 'Danger: full access',
    description:
      'No restrictions in the harness layer. Use only for trusted recovery flows. Rust-side blocklist still applies.',
    allowedReadRoots: ['<any>'],
    allowedWriteRoots: ['<any>'],
    forbiddenPaths: [],
    networkPolicy: 'allow',
    allowShellCommands: true,
    allowFileWrites: true,
    maxChangedFiles: 1000,
    maxDiffBytes: 0,
    maxCommandTimeoutSecs: 1800,
    dangerousCommandPatterns: [],
    writeDenyList: [],
  },
};

// ─── Profile resolution ──────────────────────────────────────────────────────

export function listPermissionProfiles(): PermissionProfile[] {
  return Object.values(PROFILE_CATALOG);
}

export function getPermissionProfile(id: string | undefined | null): PermissionProfile {
  if (id && id in PROFILE_CATALOG) {
    return PROFILE_CATALOG[id as PermissionProfileId];
  }
  return PROFILE_CATALOG.workspace_write;
}

// ─── Path resolution helpers ─────────────────────────────────────────────────

export interface ResolvedProfileRoots {
  workspaceRoot: string;
  iterCodeDir: string | null;
  iterRunDir: string | null;
  sessionRunDir: string | null;
}

function expandRootToken(value: string, roots: ResolvedProfileRoots): string {
  switch (value) {
    case '<any>':
      return path.sep;
    case '<workspace>':
      return roots.workspaceRoot;
    case '<iter_code_dir>':
      return roots.iterCodeDir ?? roots.workspaceRoot;
    case '<iter_run_dir>':
      return roots.iterRunDir ?? roots.workspaceRoot;
    case '<session_run_dir>':
      return roots.sessionRunDir ?? roots.workspaceRoot;
    default:
      return value;
  }
}

function isUnder(candidate: string, parent: string): boolean {
  const normalizedParent = normalizePath(parent);
  const normalizedCandidate = normalizePath(candidate);
  if (normalizedParent === '/' || normalizedParent === '') {
    return true;
  }
  return (
    normalizedCandidate === normalizedParent
    || normalizedCandidate.startsWith(`${normalizedParent}/`)
  );
}

// ─── Permission errors ───────────────────────────────────────────────────────

export class PermissionDeniedError extends Error {
  public readonly code: string;
  public readonly profile: PermissionProfileId;
  public readonly path: string | null;
  public readonly command: string | null;
  public readonly reason: string;

  constructor(input: {
    code: string;
    profile: PermissionProfileId;
    path?: string | null;
    command?: string | null;
    reason: string;
  }) {
    super(`[${input.code}] ${input.reason}`);
    this.name = 'PermissionDeniedError';
    this.code = input.code;
    this.profile = input.profile;
    this.path = input.path ?? null;
    this.command = input.command ?? null;
    this.reason = input.reason;
  }
}

// ─── Enforcement helpers ─────────────────────────────────────────────────────

export interface CheckReadPathInput {
  profile: PermissionProfile;
  roots: ResolvedProfileRoots;
  target: string;
}

export function checkReadPath(input: CheckReadPathInput): void {
  const { profile, roots, target } = input;
  const normalized = normalizePath(target);

  // Forbidden paths (always denied regardless of profile)
  for (const forbidden of profile.forbiddenPaths) {
    if (normalized === forbidden || normalized.endsWith(`/${forbidden}`)) {
      throw new PermissionDeniedError({
        code: 'FORBIDDEN_READ_PATH',
        profile: profile.id,
        path: normalized,
        reason: `Reading "${normalized}" is forbidden by the ${profile.id} profile.`,
      });
    }
  }

  // Under an allowed read root?
  const allowed = profile.allowedReadRoots.some((token) => {
    const expanded = expandRootToken(token, roots);
    if (expanded === path.sep) return true;
    return isUnder(normalized, expanded);
  });
  if (!allowed) {
    throw new PermissionDeniedError({
      code: 'READ_ROOT_DENIED',
      profile: profile.id,
      path: normalized,
      reason: `Reading "${normalized}" is not inside any allowed read root for ${profile.id}.`,
    });
  }
}

export interface CheckWritePathInput {
  profile: PermissionProfile;
  roots: ResolvedProfileRoots;
  target: string;
}

export function checkWritePath(input: CheckWritePathInput): void {
  const { profile, roots, target } = input;
  const normalized = normalizePath(target);

  if (!profile.allowFileWrites) {
    throw new PermissionDeniedError({
      code: 'FILE_WRITES_DISABLED',
      profile: profile.id,
      path: normalized,
      reason: `Profile ${profile.id} does not allow file writes.`,
    });
  }

  // Hard write deny list (e.g. .git/config)
  for (const denied of profile.writeDenyList) {
    if (normalized === denied || normalized.endsWith(`/${denied}`)) {
      throw new PermissionDeniedError({
        code: 'WRITE_DENY_LIST',
        profile: profile.id,
        path: normalized,
        reason: `Writing to "${normalized}" is denied by the ${profile.id} profile's write-deny list.`,
      });
    }
  }

  const allowed = profile.allowedWriteRoots.some((token) => {
    const expanded = expandRootToken(token, roots);
    if (expanded === path.sep) return true;
    return isUnder(normalized, expanded);
  });
  if (!allowed) {
    throw new PermissionDeniedError({
      code: 'WRITE_ROOT_DENIED',
      profile: profile.id,
      path: normalized,
      reason: `Writing "${normalized}" is not inside any allowed write root for ${profile.id}.`,
    });
  }
}

export interface CheckCommandInput {
  profile: PermissionProfile;
  command: string;
  requestedTimeoutSecs?: number;
}

export function checkCommand(input: CheckCommandInput): { allowed: true; timeoutSecs: number } {
  const { profile, command } = input;

  if (!profile.allowShellCommands) {
    throw new PermissionDeniedError({
      code: 'SHELL_DISABLED',
      profile: profile.id,
      command,
      reason: `Profile ${profile.id} does not allow shell commands.`,
    });
  }

  for (const pattern of profile.dangerousCommandPatterns) {
    if (pattern.test(command)) {
      throw new PermissionDeniedError({
        code: 'DANGEROUS_COMMAND',
        profile: profile.id,
        command,
        reason: `Command matches dangerous pattern ${pattern.toString()}.`,
      });
    }
  }

  const requested = input.requestedTimeoutSecs ?? profile.maxCommandTimeoutSecs;
  const timeoutSecs = Math.min(requested, profile.maxCommandTimeoutSecs);
  return { allowed: true, timeoutSecs };
}

export interface CheckDiffSizeInput {
  profile: PermissionProfile;
  diffBytes: number;
}

export function checkDiffSize(input: CheckDiffSizeInput): void {
  const { profile, diffBytes } = input;
  if (profile.maxDiffBytes > 0 && diffBytes > profile.maxDiffBytes) {
    throw new PermissionDeniedError({
      code: 'DIFF_TOO_LARGE',
      profile: profile.id,
      reason: `Diff size ${diffBytes} bytes exceeds profile limit ${profile.maxDiffBytes} bytes.`,
    });
  }
}

export interface CheckChangedFilesInput {
  profile: PermissionProfile;
  changedFiles: string[];
}

export function checkChangedFiles(input: CheckChangedFilesInput): void {
  const { profile, changedFiles } = input;
  if (changedFiles.length > profile.maxChangedFiles) {
    throw new PermissionDeniedError({
      code: 'TOO_MANY_CHANGED_FILES',
      profile: profile.id,
      reason: `Iteration changed ${changedFiles.length} files, exceeding profile limit of ${profile.maxChangedFiles}.`,
    });
  }
}

// ─── Command-level risk classifier (for logging) ─────────────────────────────

/**
 * Lightweight command risk classifier. Returns the highest risk level found.
 * Does NOT block; use checkCommand for blocking.
 */
export function classifyCommandRisk(command: string): 'low' | 'medium' | 'high' {
  const lower = command.toLowerCase();
  if (/\brm\s+-rf\s+\//i.test(lower) || /\bmkfs\b/i.test(lower) || /\bdd\s+if=/i.test(lower)) {
    return 'high';
  }
  if (/\brm\s+-rf\b/i.test(lower) || /\bchmod\s+777\b/i.test(lower) || /\bcurl\b[^\n]*\|\s*(bash|sh)\b/i.test(lower)) {
    return 'high';
  }
  if (/\bsudo\b/i.test(lower) || /\bsu\s+-?\s*root\b/i.test(lower)) {
    return 'medium';
  }
  if (/\brm\s+/.test(lower) || /\bchmod\s+/.test(lower) || /\bcurl\b/i.test(lower) || /\bwget\b/i.test(lower)) {
    return 'medium';
  }
  return 'low';
}
