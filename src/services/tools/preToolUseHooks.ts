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
import { defaultClassifier, type PermissionRequest } from '../../utils/permissions/classifierDecision';
import { classifyBashCommand } from '../../utils/permissions/bashClassifier';
import { defaultTelemetry } from '../../utils/permissions/permissionLogging';
import { defaultDenialTracker } from '../../utils/permissions/denialTracking';

export type PermissionMode = 'standard' | 'auto-edits' | 'bypass' | 'plan-only';

export interface HookContext {
  toolName: string;
  toolArgs: string;
  workDir?: string;
  permissionMode: PermissionMode;
  sessionId: string;
  conversationHistory?: string[];
  previousToolCalls?: Array<{ toolName: string; approved: boolean }>;
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
 * Hook 5: ML-based permission classifier.
 * Uses machine learning model to assess risk and make intelligent decisions.
 */
export async function mlClassifierCheck(ctx: HookContext): Promise<HookResult> {
  try {
    // Parse arguments
    let parsedArgs: Record<string, any> = {};
    try {
      parsedArgs = JSON.parse(ctx.toolArgs);
    } catch {
      // If not JSON, treat as string
      parsedArgs = { command: ctx.toolArgs };
    }

    const request: PermissionRequest = {
      toolName: ctx.toolName,
      arguments: parsedArgs,
      context: {
        previousRequests: ctx.previousToolCalls?.map(call => ({
          toolName: call.toolName,
          arguments: {}, // Simplified
        })),
        userIntent: ctx.conversationHistory?.slice(-1)[0],
        conversationHistory: ctx.conversationHistory,
      },
    };

    const decision = await defaultClassifier.classifyPermission(request);

    // Log the decision
    defaultTelemetry.logPermissionDecision(
      ctx.sessionId,
      ctx.toolName,
      parsedArgs,
      decision
    );

    // Check denial history
    const denialCheck = defaultDenialTracker.shouldDenyBasedOnHistory(request);
    if (denialCheck.shouldDeny) {
      defaultDenialTracker.recordDenial(
        ctx.sessionId,
        request,
        decision,
        denialCheck.reason || 'suspicious_pattern'
      );
      return {
        approved: false,
        error: `Blocked by denial tracking: ${denialCheck.reason}`,
        blockedBy: 'hook',
        severity: 'high',
      };
    }

    // Handle decision
    if (!decision.approved) {
      defaultDenialTracker.recordDenial(
        ctx.sessionId,
        request,
        decision,
        decision.riskLevel === 'critical' ? 'critical_risk' : 'high_risk'
      );
      return {
        approved: false,
        error: decision.reasoning,
        blockedBy: 'hook',
        severity: decision.riskLevel === 'critical' ? 'critical' : 'high',
      };
    }

    return { approved: true };
  } catch (error) {
    console.warn('ML classifier check failed:', error);
    // Fail open - allow if classifier fails
    return { approved: true };
  }
}

/**
 * Hook 6: Bash command classification for terminal commands.
 * Analyzes shell commands for safety and risk assessment.
 */
export async function bashClassifierCheck(ctx: HookContext): Promise<HookResult> {
  if (ctx.toolName !== 'run_in_terminal') {
    return { approved: true };
  }

  try {
    // Extract command from arguments
    let command = '';
    try {
      const args = JSON.parse(ctx.toolArgs);
      command = args.command || args.cmd || ctx.toolArgs;
    } catch {
      command = ctx.toolArgs;
    }

    if (!command.trim()) {
      return { approved: true };
    }

    const classification = classifyBashCommand(command);

    // Log bash classification
    const parsedArgs = { command };
    defaultTelemetry.logPermissionDecision(
      ctx.sessionId,
      ctx.toolName,
      parsedArgs,
      {
        approved: !classification.requiresApproval,
        confidence: classification.riskLevel === 'safe' ? 0.9 :
                   classification.riskLevel === 'moderate' ? 0.6 : 0.3,
        riskLevel: classification.riskLevel as 'low' | 'medium' | 'high' | 'critical',
        reasoning: classification.reasoning,
      },
      classification
    );

    if (classification.requiresApproval) {
      return {
        approved: false,
        error: `Shell command blocked: ${classification.reasoning}`,
        blockedBy: 'hook',
        severity: classification.riskLevel === 'critical' ? 'critical' :
                 classification.riskLevel === 'high' ? 'high' : 'medium',
      };
    }

    return { approved: true };
  } catch (error) {
    console.warn('Bash classifier check failed:', error);
    return { approved: true };
  }
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
    mlClassifierCheck,
    bashClassifierCheck,
  ];

  for (const hook of hooks) {
    const result = await hook(ctx);
    if (!result.approved) {
      return result;
    }
  }

  return { approved: true };
}
