/**
 * PreToolUse Hooks
 *
 * Runs before every tool execution. Each hook can:
 * - Approve (continue to next hook)
 * - Reject (block execution with error)
 * - Modify arguments (pass modified args forward)
 *
 * Hook execution order:
 * 1. dangerousCommandCheck — hard constraint, cannot be bypassed
 * 2. pathValidationCheck — ensures paths are within workDir
 * 3. permissionModeCheck — plan-only blocks all tools
 * 4. autoEditsRestriction — auto-edits limits which tools are auto-approved
 */

import { checkToolCallForDangerPatterns } from './dangerousPatterns';
import { validateToolCallPaths } from './pathValidation';

export type PermissionMode = 'standard' | 'auto-edits' | 'bypass' | 'plan-only';

export interface HookContext {
  toolName: string;
  toolArgs: string;
  workDir?: string;
  permissionMode: PermissionMode;
  sessionId: string;
}

export interface HookResult {
  approved: boolean;
  modifiedArgs?: string;
  error?: string;
  blockedBy?: 'dangerous-command' | 'path-validation' | 'hook' | 'permission-mode';
  severity?: 'critical' | 'high' | 'medium';
}

/**
 * Hook 1: Dangerous command check.
 * Hard constraint — blocks regardless of permission mode.
 */
export async function dangerousCommandCheck(ctx: HookContext): Promise<HookResult> {
  const match = checkToolCallForDangerPatterns(ctx.toolName, ctx.toolArgs);
  if (match) {
    return {
      approved: false,
      error: `Blocked: ${match.description}`,
      blockedBy: 'dangerous-command',
      severity: match.severity,
    };
  }
  return { approved: true };
}

/**
 * Hook 2: Path validation check.
 * Ensures paths are within workDir and don't access system directories.
 */
export async function pathValidationCheck(ctx: HookContext): Promise<HookResult> {
  const result = validateToolCallPaths(ctx.toolName, ctx.toolArgs, ctx.workDir);
  if (!result.isValid) {
    return {
      approved: false,
      error: result.error,
      blockedBy: 'path-validation',
    };
  }
  return { approved: true };
}

/**
 * Hook 3: Permission mode check.
 * plan-only mode blocks all tool execution.
 */
export async function permissionModeCheck(ctx: HookContext): Promise<HookResult> {
  if (ctx.permissionMode === 'plan-only') {
    return {
      approved: false,
      error: 'Tool execution is not allowed in plan-only mode. The AI should provide a plan instead.',
      blockedBy: 'permission-mode',
    };
  }
  return { approved: true };
}

/**
 * Hook 4: Auto-edits mode restriction.
 * In auto-edits mode, only read-only and file-edit tools are auto-approved.
 * Destructive operations still require user confirmation.
 */
export async function autoEditsRestriction(ctx: HookContext): Promise<HookResult> {
  if (ctx.permissionMode !== 'auto-edits') {
    return { approved: true };
  }

  const autoApprovedTools = [
    'read_file', 'list_files', 'path_exists', 'search_files',
    'write_file', 'create_directory',
  ];

  if (!autoApprovedTools.includes(ctx.toolName)) {
    return {
      approved: false,
      error: `Tool "${ctx.toolName}" requires user confirmation in auto-edits mode`,
      blockedBy: 'permission-mode',
    };
  }

  return { approved: true };
}

/**
 * Run all PreToolUse hooks in order.
 * Returns the first blocking result, or { approved: true } if all pass.
 */
export async function runPreToolUseHooks(ctx: HookContext): Promise<HookResult> {
  const hooks = [
    dangerousCommandCheck,
    pathValidationCheck,
    permissionModeCheck,
    autoEditsRestriction,
  ];

  for (const hook of hooks) {
    const result = await hook(ctx);
    if (!result.approved) {
      return result;
    }
  }

  return { approved: true };
}
