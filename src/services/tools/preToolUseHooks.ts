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
 * 2b. typstRenderGuardCheck — blocks inline render tools for @preview imports
 * 3. permissionModeCheck — plan-only blocks all tools
 * 4. autoEditsRestriction — auto-edits limits which tools are auto-approved
 */

import { checkToolCallForDangerPatterns } from './dangerousPatterns';
import { validateToolCallPaths } from './pathValidation';
import {
  canAutoApproveTool,
  isHighRiskToolName,
  type PermissionMode,
} from './toolExecutionPolicy';
import { isToolAllowedForMode } from '../executionMode';
import { defaultClassifier, type PermissionRequest } from '../../utils/permissions/classifierDecision';
import { classifyBashCommand } from '../../utils/permissions/bashClassifier';
import { defaultTelemetry } from '../../utils/permissions/permissionLogging';
import { defaultDenialTracker } from '../../utils/permissions/denialTracking';

export interface HookContext {
  toolName: string;
  toolArgs: string;
  workDir?: string;
  permissionMode: PermissionMode;
  /**
   * Optional 6-mode execution mode id. When set, outer guards in
   * preToolUseHooks can enforce mode-specific tool policies that the
   * 4-mode PermissionMode alone cannot express (e.g. Ask mode forcing
   * every tool call to require confirmation, Plan mode blocking all
   * tools, Debug mode restricting writes).
   */
  executionMode?: string;
  sessionId: string;
  conversationHistory?: string[];
  previousToolCalls?: Array<{ toolName: string; approved: boolean }>;
}

export interface HookResult {
  approved: boolean;
  modifiedArgs?: string;
  error?: string;
  requiresConfirmation?: boolean;
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
 * Hook 1b: Execution-mode outer guard.
 *
 * Enforces the 5-mode execution mode policy for tools that the
 * 4-mode PermissionMode cannot express on its own. Runs after the
 * dangerous-command check so it can never be used to bypass hard
 * safety constraints.
 *
 * Behavior:
 *  - Ask mode: blocks ALL tools (chat only). The model is expected
 *    to respond conversationally without calling execute_command,
 *    read_file, write_file, browser tools, etc. If a tool call slips
 *    through we return a structured block with a hint to switch mode.
 *  - Plan mode: blocks all tools (the existing plan-only hook handles
 *    the 4-mode mapping; this also covers the 6-mode 'plan' id which
 *    may be present alongside a non-plan permissionMode in some flows).
 *  - Debug / Agent: use the per-mode allow-list from the registry.
 *  - Bypass: no outer restriction; per-tool approval policy still
 *    applies through the existing 4-mode hooks.
 *
 * This is the runtime enforcement of the 5-mode registry. It is
 * deliberately conservative: when in doubt, it blocks and lets the UI
 * surface a clear error to the user.
 */
export async function executionModeGuardCheck(ctx: HookContext): Promise<HookResult> {
  if (!ctx.executionMode) {
    return { approved: true };
  }

  // Ask mode short-circuit: chat only. Blocks every tool regardless
  // of the underlying 4-mode permissionMode field. This is the
  // primary defense against "simple Q&A falls into an Agent/Bypass
  // tool loop" — even if the backend reports `allowed` for the
  // tool, the 6-mode outer guard vetoes it.
  if (ctx.executionMode === 'ask') {
    return {
      approved: false,
      error: 'Tool execution is disabled in Ask mode. Switch to Agent or Bypass to run tools.',
      blockedBy: 'permission-mode',
    };
  }

  // Plan mode short-circuit: blocks all tool execution regardless of
  // the underlying 4-mode permissionMode field. Plan is meant to be
  // read-only and produce a plan/checklist only.
  if (ctx.executionMode === 'plan') {
    return {
      approved: false,
      error: 'Tool execution is not allowed in Plan mode. Switch to Agent or Bypass to run tools.',
      blockedBy: 'permission-mode',
    };
  }

  if (ctx.executionMode === 'debug') {
    if (!isToolAllowedForMode('debug', ctx.toolName)) {
      return {
        approved: false,
        error: 'This tool is not allowed in Debug mode (read + small writes only).',
        blockedBy: 'permission-mode',
      };
    }
    return { approved: true };
  }

  if (ctx.executionMode === 'agent') {
    if (!isToolAllowedForMode('agent', ctx.toolName)) {
      return {
        approved: false,
        error: 'This tool is not allowed in Agent mode for the current policy.',
        blockedBy: 'permission-mode',
      };
    }
    return { approved: true };
  }

  // Bypass: no outer restriction; per-tool approval policy still applies
  // through the existing 4-mode hooks.
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
 * Hook 2b: Typst render guard.
 * Inline render tools cannot resolve bundled @preview packages.
 */
export async function typstRenderGuardCheck(ctx: HookContext): Promise<HookResult> {
  if (ctx.toolName !== 'render_typst_to_pdf' && ctx.toolName !== 'render_typst_to_svg') {
    return { approved: true };
  }

  try {
    const parsedArgs = JSON.parse(ctx.toolArgs) as { source?: unknown };
    const source = typeof parsedArgs.source === 'string' ? parsedArgs.source : '';

    if (!source.includes('@preview/')) {
      return { approved: true };
    }

    return {
      approved: false,
      error: 'This Typst source imports @preview packages. Use compile_typst_file on the saved .typ file instead of render_typst_to_pdf/render_typst_to_svg, because inline render tools cannot resolve bundled @preview packages.',
      blockedBy: 'hook',
      severity: 'medium',
    };
  } catch {
    return { approved: true };
  }
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

  return canAutoApproveTool('auto-edits', ctx.toolName)
    ? { approved: true }
    : {
      approved: true,
      requiresConfirmation: true,
    };
}

/**
 * Hook 5: ML-based permission classifier.
 * Uses machine learning model to assess risk and make intelligent decisions.
 * 
 * Classifier denials on non-critical tools downgrade to a confirmation requirement.
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
      // In standard (ASK) mode, let the permission UI handle it
      if (ctx.permissionMode === 'standard' || ctx.permissionMode === 'bypass') {
        return { approved: true };
      }
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
      if (decision.riskLevel !== 'critical') {
        return {
          approved: true,
          requiresConfirmation: true,
        };
      }
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
    if (!isHighRiskToolName(ctx.toolName)) {
      return { approved: true };
    }
    return {
      approved: true,
      requiresConfirmation: true,
    };
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
      if (classification.riskLevel !== 'critical') {
        return {
          approved: true,
          requiresConfirmation: true,
        };
      }
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
    if (!isHighRiskToolName(ctx.toolName)) {
      return { approved: true };
    }
    return {
      approved: true,
      requiresConfirmation: true,
    };
  }
}

/**
 * Run all PreToolUse hooks in order.
 * Returns the first blocking result, or { approved: true } if all pass.
 */
export async function runPreToolUseHooks(ctx: HookContext): Promise<HookResult> {
  const hooks = [
    dangerousCommandCheck,
    executionModeGuardCheck,
    pathValidationCheck,
    typstRenderGuardCheck,
    permissionModeCheck,
    autoEditsRestriction,
    mlClassifierCheck,
    bashClassifierCheck,
  ];

  const aggregate: HookResult = { approved: true };

  for (const hook of hooks) {
    const result = await hook(ctx);
    if (!result.approved) {
      return result;
    }
    if (result.modifiedArgs) {
      aggregate.modifiedArgs = result.modifiedArgs;
    }
    if (result.requiresConfirmation) {
      aggregate.requiresConfirmation = true;
    }
  }

  return aggregate;
}
