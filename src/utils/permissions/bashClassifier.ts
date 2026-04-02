/**
 * Bash Command Classifier
 * Classifies shell commands for permission and safety analysis
 *
 * Based on Claude Code's bashClassifier.ts
 */

export interface BashCommandClassification {
  command: string;
  category: CommandCategory;
  riskLevel: 'safe' | 'moderate' | 'high' | 'critical';
  requiresApproval: boolean;
  reasoning: string;
  suggestedAction?: 'allow' | 'deny' | 'ask_user' | 'sandbox';
  metadata?: {
    hasSudo: boolean;
    hasPipes: boolean;
    hasRedirects: boolean;
    usesSystemDirs: boolean;
    isDestructive: boolean;
    isNetwork: boolean;
  };
}

export type CommandCategory =
  | 'read_only'
  | 'file_operation'
  | 'system_info'
  | 'package_management'
  | 'process_management'
  | 'network'
  | 'destructive'
  | 'unknown';

const DANGEROUS_COMMANDS = new Set([
  'rm', 'del', 'erase', 'shred', 'wipe',
  'fdisk', 'mkfs', 'format',
  'dd', 'mkisofs',
  'chmod', 'chown', 'chgrp',
  'kill', 'killall', 'pkill',
  'reboot', 'shutdown', 'halt',
  'passwd', 'usermod', 'userdel',
  'crontab', 'at', 'batch',
  'mount', 'umount', 'fsck',
  'iptables', 'ufw', 'firewall-cmd',
  'systemctl', 'service',
  'curl', 'wget', 'ssh', 'scp', // Network commands with potential for mischief
]);

const SAFE_COMMANDS = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail',
  'grep', 'find', 'which', 'type', 'file',
  'ps', 'top', 'htop', 'df', 'du', 'free',
  'date', 'cal', 'whoami', 'id', 'groups',
  'history', 'alias', 'set', 'env',
  'man', 'help', 'info', '--help', '-h',
]);

const SYSTEM_DIRS = [
  '/System', '/usr', '/etc', '/var', '/bin', '/sbin',
  '/lib', '/boot', '/sys', '/proc', '/dev',
  '/root', '/home',
];

/**
 * Classify a bash command for safety and permission analysis
 */
export function classifyBashCommand(command: string): BashCommandClassification {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return {
      command: trimmedCommand,
      category: 'unknown',
      riskLevel: 'safe',
      requiresApproval: false,
      reasoning: 'Empty command',
    };
  }

  // Parse command structure
  const parsed = parseCommand(trimmedCommand);

  // Determine category
  const category = determineCategory(parsed);

  // Calculate risk level
  const riskLevel = calculateRiskLevel(parsed, category);

  // Determine if approval is required
  const requiresApproval = shouldRequireApproval(riskLevel, parsed);

  // Generate reasoning
  const reasoning = generateReasoning(parsed, category, riskLevel);

  // Suggest action
  const suggestedAction = getSuggestedAction(riskLevel, parsed);

  return {
    command: trimmedCommand,
    category,
    riskLevel,
    requiresApproval,
    reasoning,
    suggestedAction,
    metadata: {
      hasSudo: parsed.hasSudo,
      hasPipes: parsed.hasPipes,
      hasRedirects: parsed.hasRedirects,
      usesSystemDirs: parsed.usesSystemDirs,
      isDestructive: parsed.isDestructive,
      isNetwork: parsed.isNetwork,
    },
  };
}

/**
 * Parse command into components
 */
function parseCommand(command: string): {
  baseCommand: string;
  args: string[];
  hasSudo: boolean;
  hasPipes: boolean;
  hasRedirects: boolean;
  usesSystemDirs: boolean;
  isDestructive: boolean;
  isNetwork: boolean;
  fullCommand: string;
} {
  const fullCommand = command;

  // Check for sudo
  const hasSudo = command.includes('sudo ');

  // Remove sudo for analysis
  const cleanCommand = command.replace(/^sudo\s+/, '');

  // Split by pipes and take first command
  const pipeParts = cleanCommand.split('|');
  const mainCommand = pipeParts[0].trim();
  const hasPipes = pipeParts.length > 1;

  // Check for redirects
  const hasRedirects = /[<>]/.test(mainCommand);

  // Split command into parts
  const parts = mainCommand.split(/\s+/);
  const baseCommand = parts[0];
  const args = parts.slice(1);

  // Check for system directory usage
  const usesSystemDirs = args.some(arg =>
    SYSTEM_DIRS.some(dir => arg.includes(dir))
  );

  // Check for destructive operations
  const isDestructive = DANGEROUS_COMMANDS.has(baseCommand) ||
    args.some(arg => arg.includes('-rf') || arg.includes('--force'));

  // Check for network operations
  const isNetwork = ['curl', 'wget', 'ssh', 'scp', 'ping', 'nc', 'telnet'].includes(baseCommand);

  return {
    baseCommand,
    args,
    hasSudo,
    hasPipes,
    hasRedirects,
    usesSystemDirs,
    isDestructive,
    isNetwork,
    fullCommand,
  };
}

/**
 * Determine command category
 */
function determineCategory(parsed: ReturnType<typeof parseCommand>): CommandCategory {
  const { baseCommand, isDestructive, isNetwork } = parsed;

  if (SAFE_COMMANDS.has(baseCommand)) {
    return 'read_only';
  }

  if (['cp', 'mv', 'touch', 'mkdir', 'ln'].includes(baseCommand)) {
    return 'file_operation';
  }

  if (['ps', 'top', 'kill', 'killall'].includes(baseCommand)) {
    return 'process_management';
  }

  if (['apt', 'yum', 'brew', 'npm', 'pip', 'gem'].includes(baseCommand)) {
    return 'package_management';
  }

  if (isNetwork) {
    return 'network';
  }

  if (isDestructive) {
    return 'destructive';
  }

  if (['uname', 'whoami', 'hostname', 'uptime', 'df', 'du'].includes(baseCommand)) {
    return 'system_info';
  }

  return 'unknown';
}

/**
 * Calculate risk level
 */
function calculateRiskLevel(
  parsed: ReturnType<typeof parseCommand>,
  category: CommandCategory
): 'safe' | 'moderate' | 'high' | 'critical' {
  const { hasSudo, usesSystemDirs, isDestructive, baseCommand } = parsed;

  // Critical risk
  if (hasSudo && isDestructive) {
    return 'critical';
  }

  if (DANGEROUS_COMMANDS.has(baseCommand) && (hasSudo || usesSystemDirs)) {
    return 'critical';
  }

  // High risk
  if (hasSudo || isDestructive) {
    return 'high';
  }

  if (usesSystemDirs && category === 'file_operation') {
    return 'high';
  }

  // Moderate risk
  if (category === 'network' || category === 'package_management') {
    return 'moderate';
  }

  if (usesSystemDirs) {
    return 'moderate';
  }

  // Safe
  if (category === 'read_only' || category === 'system_info') {
    return 'safe';
  }

  return 'moderate'; // Default
}

/**
 * Determine if command requires user approval
 */
function shouldRequireApproval(riskLevel: string, parsed: ReturnType<typeof parseCommand>): boolean {
  // Always require approval for high/critical risk
  if (riskLevel === 'high' || riskLevel === 'critical') {
    return true;
  }

  // Require approval for sudo commands
  if (parsed.hasSudo) {
    return true;
  }

  // Require approval for destructive operations
  if (parsed.isDestructive) {
    return true;
  }

  return false;
}

/**
 * Generate reasoning for the classification
 */
function generateReasoning(
  parsed: ReturnType<typeof parseCommand>,
  category: CommandCategory,
  riskLevel: string
): string {
  const reasons: string[] = [];

  if (parsed.hasSudo) {
    reasons.push('uses sudo (elevated privileges)');
  }

  if (parsed.isDestructive) {
    reasons.push('potentially destructive operation');
  }

  if (parsed.usesSystemDirs) {
    reasons.push('affects system directories');
  }

  if (parsed.hasPipes) {
    reasons.push('uses command pipelines');
  }

  if (parsed.isNetwork) {
    reasons.push('network operation');
  }

  reasons.push(`categorized as ${category}`);

  return `Command classified as ${riskLevel} risk: ${reasons.join(', ')}`;
}

/**
 * Suggest action based on risk level
 */
function getSuggestedAction(
  riskLevel: string,
  parsed: ReturnType<typeof parseCommand>
): 'allow' | 'deny' | 'ask_user' | 'sandbox' {
  if (riskLevel === 'critical') {
    return 'deny';
  }

  if (riskLevel === 'high') {
    return 'ask_user';
  }

  if (riskLevel === 'moderate') {
    return parsed.hasSudo ? 'ask_user' : 'allow';
  }

  return 'allow';
}

/**
 * Batch classify multiple commands
 */
export function classifyBashCommands(commands: string[]): BashCommandClassification[] {
  return commands.map(classifyBashCommand);
}

/**
 * Check if a command is safe for automatic execution
 */
export function isCommandSafe(command: string): boolean {
  const classification = classifyBashCommand(command);
  return classification.riskLevel === 'safe' && !classification.requiresApproval;
}