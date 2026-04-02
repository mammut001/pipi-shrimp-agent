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

export interface PathValidationResult {
  isValid: boolean;
  error?: string;
  resolvedPath?: string;
}

// System directories that should never be accessed by tools
const BLOCKED_PREFIXES = [
  '/etc/', '/usr/', '/sys/', '/proc/', '/dev/', '/boot/', '/sbin/', '/bin/',
  '/var/log/', '/Library/', '/System/', '/private/etc/', '/private/var/',
];

// Sensitive files that should never be read
const BLOCKED_FILES = [
  '/etc/shadow', '/etc/passwd', '/etc/sudoers',
  '/etc/ssh/sshd_config', '/etc/hosts',
];

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
  if (workDir && !trimmed.startsWith('/')) {
    resolvedPath = normalizePath(workDir + '/' + trimmed);
  } else if (trimmed.startsWith('/')) {
    resolvedPath = normalizePath(trimmed);
  }

  // Check for path traversal attempts
  if (trimmed.includes('..')) {
    if (workDir) {
      // Allow .. only if it resolves within workDir
      const normalizedWorkDir = normalizePath(workDir);
      if (!resolvedPath.startsWith(normalizedWorkDir + '/') && resolvedPath !== normalizedWorkDir) {
        return { isValid: false, error: `Path traversal outside working directory: ${inputPath}` };
      }
    } else {
      return { isValid: false, error: `Path traversal not allowed without workDir: ${inputPath}` };
    }
  }

  // Check against blocked file list (exact match)
  for (const blocked of BLOCKED_FILES) {
    if (resolvedPath === blocked) {
      return { isValid: false, error: `Access to sensitive file is not allowed: ${blocked}` };
    }
  }

  // Check against blocked directory prefixes
  for (const prefix of BLOCKED_PREFIXES) {
    if (resolvedPath.startsWith(prefix)) {
      return { isValid: false, error: `Access to system directory is not allowed: ${prefix}` };
    }
  }

  // If workDir is set, ensure path is within it
  if (workDir) {
    const normalizedWorkDir = normalizePath(workDir);
    if (!resolvedPath.startsWith(normalizedWorkDir + '/') && resolvedPath !== normalizedWorkDir) {
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
  if (!pathTools.includes(toolName)) {
    return { isValid: true };
  }

  try {
    const parsed = JSON.parse(args);
    const targetPath = parsed.path;
    if (targetPath && typeof targetPath === 'string') {
      return validatePath(targetPath, workDir);
    }
  } catch {
    // If args can't be parsed as JSON, let the tool handler deal with it
  }

  return { isValid: true };
}
