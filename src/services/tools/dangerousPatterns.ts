/**
 * Dangerous Command Patterns
 *
 * Hard-constraint blacklist that blocks dangerous shell commands
 * regardless of permission mode (even bypass cannot override).
 *
 * Based on Claude Code's dangerousPatterns.ts
 */

export interface DangerousPattern {
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
  description: string;
}

export const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // === Filesystem destruction ===
  {
    pattern: /\brm\s+(-rf?|--force)\s+\/\s*$/,
    severity: 'critical',
    description: 'Attempting to delete root filesystem',
  },
  {
    pattern: /\brm\s+(-rf?|--force)\s+~\s*$/,
    severity: 'critical',
    description: 'Attempting to delete home directory',
  },
  {
    pattern: /\bmkfs\b/,
    severity: 'critical',
    description: 'Filesystem creation command',
  },
  {
    pattern: /\bdd\s+if=\S+\s+of=\/dev\b/,
    severity: 'critical',
    description: 'Writing to block device',
  },
  {
    pattern: /\bshred\b/,
    severity: 'high',
    description: 'Secure file deletion',
  },

  // === System modification ===
  {
    pattern: /\bchmod\s+(-R\s+)?777\s+\/\s*$/,
    severity: 'critical',
    description: 'Making root filesystem world-writable',
  },
  {
    pattern: /\bchmod\s+(-R\s+)?777\s+~\s*$/,
    severity: 'high',
    description: 'Making home directory world-writable',
  },
  {
    pattern: /\bchown\s+(-R\s+)?root:root\s+\/\s*$/,
    severity: 'critical',
    description: 'Changing root ownership',
  },

  // === Network attacks ===
  {
    pattern: /\bnmap\b/,
    severity: 'high',
    description: 'Network scanning tool',
  },
  {
    pattern: /\bnc\s+-[el]/,
    severity: 'high',
    description: 'Netcat listener',
  },
  {
    pattern: /\bcurl\s+.*\|\s*(bash|sh|zsh)\b/i,
    severity: 'high',
    description: 'Piping remote script to shell',
  },
  {
    pattern: /\bwget\s+.*\|\s*(bash|sh|zsh)\b/i,
    severity: 'high',
    description: 'Piping remote script to shell',
  },

  // === Information disclosure ===
  {
    pattern: /\bcat\s+\/etc\/(shadow|passwd|sudoers)\b/,
    severity: 'high',
    description: 'Reading sensitive system files',
  },
  {
    pattern: /\bexport\s+.*=\s*['"]?\$?\{?\s*(AWS_SECRET|PRIVATE_KEY|TOKEN)/i,
    severity: 'high',
    description: 'Exporting sensitive credentials',
  },

  // === Process destruction ===
  {
    pattern: /\bkill\s+-9\s+1\b/,
    severity: 'critical',
    description: 'Killing init process',
  },
  {
    pattern: /\bpkill\s+-9\s+-u\s+root\b/,
    severity: 'critical',
    description: 'Killing all root processes',
  },
];

/**
 * Check if a command string matches any dangerous pattern.
 * Returns the matched pattern or null if the command is safe.
 */
export function checkDangerousCommand(command: string): DangerousPattern | null {
  for (const dp of DANGEROUS_PATTERNS) {
    if (dp.pattern.test(command)) {
      return dp;
    }
  }
  return null;
}

/**
 * Check if a tool call's arguments contain dangerous commands.
 * Only applies to tools that can execute shell commands.
 */
export function checkToolCallForDangerPatterns(
  toolName: string,
  args: string,
): DangerousPattern | null {
  const shellTools = ['bash', 'execute_command', 'run_command', 'shell', 'exec'];
  if (!shellTools.includes(toolName)) {
    return null;
  }

  try {
    const parsed = JSON.parse(args);
    const command = parsed.command || parsed.cmd || parsed.args || '';
    if (typeof command === 'string') {
      return checkDangerousCommand(command);
    }
  } catch {
    return checkDangerousCommand(args);
  }

  return null;
}
