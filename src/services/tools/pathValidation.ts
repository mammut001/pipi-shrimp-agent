/**
 * Path Validation
 *
 * Validates tool file access paths against security rules:
 * - No path traversal outside workDir
 * - No access to system directories
 * - No absolute paths to sensitive locations
 *
 * Based on Claude Code's pathValidation.ts
 */

import { isWithinDir } from '@/utils/pathSecurity';

export interface PathValidationResult {
  isValid: boolean;
  error?: string;
  resolvedPath?: string;
}

// System directories that should never be accessed by tools.
// AUDIT-FIX [R7-16]: Added Windows system directories (C:\Windows, C:\Program
// Files, etc.) and macOS /Applications. The TS path check was Unix-only;
// the Rust side already blocks these but the TS layer ran first for
// previews / chat-side rendering.
const BLOCKED_PREFIXES = [
  // Unix system dirs
  '/etc/', '/usr/', '/sys/', '/proc/', '/dev/', '/boot/', '/sbin/', '/bin/',
  '/var/log/', '/private/etc/', '/private/var/',
  // macOS system dirs
  '/Library/', '/System/', '/Applications/',
  // Windows system dirs — case-insensitive at the file-system level but
  // canonicalized to mixed-case here. Prefix-matched only when the input
  // already uses backslash or starts with C:\.
  'C:\\Windows\\', 'C:\\Program Files\\', 'C:\\Program Files (x86)\\',
  'C:\\ProgramData\\', 'C:\\Users\\Default\\', 'C:\\Boot\\',
];

// Sensitive files that should never be read
const BLOCKED_FILES = [
  '/etc/shadow', '/etc/passwd', '/etc/sudoers',
  '/etc/ssh/sshd_config', '/etc/hosts',
  // Windows equivalents. Lowercased because we compare lowercased.
  'c:\\windows\\system32\\config\\sam',
  'c:\\windows\\system32\\config\\security',
  'c:\\windows\\system32\\config\\system',
  'c:\\windows\\system32\\drivers\\etc\\hosts',
  'c:\\boot.ini', 'c:\\pagefile.sys', 'c:\\hiberfil.sys',
];

const WINDOWS_PATH = /^[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*$/;

/**
 * Normalize a path by resolving . and .. components.
 * Uses a simple algorithm to avoid importing path-browserify.
 */
function normalizePath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return (p.startsWith('/') ? '/' : '') + resolved.join('/');
}

function validatePathField(
  value: unknown,
  baseDir?: string,
): PathValidationResult {
  if (typeof value !== 'string') {
    return { isValid: true };
  }
  return validatePath(value, baseDir);
}

/**
 * Validate a single path against security rules.
 */
export function validatePath(
  inputPath: string,
  workDir?: string,
): PathValidationResult {
  if (!inputPath || inputPath.trim() === '') {
    return { isValid: false, error: 'Empty path' };
  }

  const trimmed = inputPath.trim();

  // Resolve relative paths against workDir
  let resolvedPath = trimmed;
  if (workDir && !trimmed.startsWith('/') && !WINDOWS_PATH.test(trimmed)) {
    resolvedPath = normalizePath(workDir + '/' + trimmed);
  } else if (trimmed.startsWith('/')) {
    resolvedPath = normalizePath(trimmed);
  }

  // Check for path traversal attempts
  if (trimmed.includes('..')) {
    if (workDir) {
      const normalizedWorkDir = normalizePath(workDir);
      if (!isWithinDir(resolvedPath, normalizedWorkDir)) {
        return { isValid: false, error: `Path traversal outside working directory: ${inputPath}` };
      }
    } else {
      return { isValid: false, error: `Path traversal not allowed without workDir: ${inputPath}` };
    }
  }

  // Check against blocked file list (exact match). Windows paths are
  // case-insensitive at the filesystem level so lower-case both sides for
  // the Windows-flavored entries.
  const isWindows = WINDOWS_PATH.test(resolvedPath);
  const compare = (a: string, b: string) => (isWindows ? a.toLowerCase() === b.toLowerCase() : a === b);
  const comparePrefix = (a: string, b: string) => (isWindows ? a.toLowerCase().startsWith(b.toLowerCase()) : a.startsWith(b));

  for (const blocked of BLOCKED_FILES) {
    if (compare(resolvedPath, blocked)) {
      return { isValid: false, error: `Access to sensitive file is not allowed: ${blocked}` };
    }
  }

  // Check against blocked directory prefixes
  for (const prefix of BLOCKED_PREFIXES) {
    if (comparePrefix(resolvedPath, prefix)) {
      return { isValid: false, error: `Access to system directory is not allowed: ${prefix}` };
    }
  }

  // If workDir is set, ensure path is within it (strict boundary — no sibling-prefix escape)
  if (workDir) {
    const normalizedWorkDir = normalizePath(workDir);
    if (!isWithinDir(resolvedPath, normalizedWorkDir)) {
      return { isValid: false, error: `Path ${resolvedPath} is outside working directory ${workDir}` };
    }
  }

  return { isValid: true, resolvedPath };
}

/**
 * Validate paths in tool call arguments.
 * Only applies to file-accessing tools.
 */
export function validateToolCallPaths(
  toolName: string,
  args: string,
  workDir?: string,
): PathValidationResult {
  const pathTools = [
    'read_file', 'write_file', 'list_files',
    'create_directory', 'path_exists', 'search_files',
  ];
  try {
    const parsed = JSON.parse(args);
    if (toolName === 'execute_command') {
      if (typeof parsed.cwd === 'string') {
        return validatePath(parsed.cwd, workDir);
      }
      if (!workDir) {
        return {
          isValid: false,
          error: 'execute_command requires an explicit cwd or bound workDir',
        };
      }
      return { isValid: true, resolvedPath: normalizePath(workDir) };
    }

    if (pathTools.includes(toolName)) {
      return validatePathField(parsed.path, workDir);
    }

    if (toolName === 'ssh_exec') {
      return validatePathField(parsed.remoteWorkDir, undefined);
    }

    if (toolName === 'ssh_read_file') {
      const remoteBase = typeof parsed.remoteWorkDir === 'string' ? parsed.remoteWorkDir : undefined;
      return validatePathField(parsed.remotePath, remoteBase);
    }

    if (toolName === 'ssh_upload_file') {
      if (typeof parsed.localPath === 'string') {
        const localPathResult = validatePath(parsed.localPath, workDir);
        if (!localPathResult.isValid) {
          return localPathResult;
        }
      }
      const remoteBase = typeof parsed.remoteWorkDir === 'string' ? parsed.remoteWorkDir : undefined;
      return validatePathField(parsed.remotePath, remoteBase);
    }
  } catch {
    // If args can't be parsed as JSON, let the tool handler deal with it
  }

  return { isValid: true };
}
