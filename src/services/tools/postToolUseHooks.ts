/**
 * PostToolUse Hooks
 *
 * Runs after every tool execution. Used for:
 * - Audit logging
 * - Triggering side effects (file list refresh, etc.)
 * - Error tracking
 */

export interface PostHookContext {
  toolName: string;
  toolArgs: string;
  result: string;
  isError: boolean;
  sessionId: string;
}

/**
 * PostToolUse hook: audit logging.
 * Records tool execution for audit trail.
 */
export async function auditLog(ctx: PostHookContext): Promise<void> {
  console.log(
    `[Audit] Tool: ${ctx.toolName}, Session: ${ctx.sessionId}, ` +
    `Error: ${ctx.isError}, Args: ${ctx.toolArgs.slice(0, 100)}`
  );
  // Future: write to audit log file or database
}

/**
 * PostToolUse hook: refresh file list after write operations.
 * Triggers UI updates when files are modified.
 */
export async function refreshAfterWrite(ctx: PostHookContext): Promise<void> {
  const writeTools = ['write_file', 'create_directory'];
  if (writeTools.includes(ctx.toolName) && !ctx.isError) {
    console.log(`[PostHook] Refreshing file list after ${ctx.toolName}`);
    // Future: trigger file list refresh in UI
  }
}

/**
 * PostToolUse hook: error tracking.
 * Tracks tool execution errors for debugging.
 */
export async function errorTracking(ctx: PostHookContext): Promise<void> {
  if (ctx.isError) {
    console.warn(
      `[ErrorTrack] Tool: ${ctx.toolName}, Session: ${ctx.sessionId}, ` +
      `Error: ${ctx.result.slice(0, 200)}`
    );
  }
}

/**
 * Run all PostToolUse hooks.
 * All hooks run regardless of errors (fire-and-forget).
 */
export async function runPostToolUseHooks(ctx: PostHookContext): Promise<void> {
  const hooks = [auditLog, refreshAfterWrite, errorTracking];

  for (const hook of hooks) {
    try {
      await hook(ctx);
    } catch (e) {
      console.warn(`[PostToolUseHooks] Hook ${hook.name} failed:`, e);
    }
  }
}
