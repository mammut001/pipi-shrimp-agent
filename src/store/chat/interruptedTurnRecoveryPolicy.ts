/**
 * Interrupted-turn recovery policy (GPT P1 #5).
 *
 * Pure helpers + named constants. Does not rewrite SessionRuntime / queryLoop.
 * Hydrate enforcement reuses terminalizeInterrupted* from scrubDanglingToolCalls.
 */
import type { Message } from '../../types/chat';
import {
  listOrphanToolCalls,
  type OrphanToolCall,
} from './scrubDanglingToolCalls';

/** Named policy knobs — restart never resumes; only explicit user retry re-runs. */
export const INTERRUPTED_TURN_RECOVERY_POLICY = {
  /** R1: running turn must not resume after process/app restart. */
  resumeRunningTurnAfterRestart: false,
  /** R2: in-flight tools must not auto-retry after restart. */
  autoRetryRunningToolAfterRestart: false,
  /** R3: restart/hydrate must terminalize orphans as interrupted. */
  restartYieldsInterruptedTerminal: true,
  /** R4: only an explicit user action may re-execute. */
  reExecuteRequiresExplicitUserRetry: true,
} as const;

export type HydrateRecoveryAction = 'noop' | 'terminalize_interrupted';

/** R1 — never resume a pre-restart live turn. */
export function shouldResumeRunningTurnAfterRestart(): boolean {
  return INTERRUPTED_TURN_RECOVERY_POLICY.resumeRunningTurnAfterRestart;
}

/** R2 — never auto-retry unfinished tools after restart. */
export function shouldAutoRetryInterruptedTool(): boolean {
  return INTERRUPTED_TURN_RECOVERY_POLICY.autoRetryRunningToolAfterRestart;
}

/** R4 — re-execution requires sendMessage / retryLastMessage (or equivalent UI). */
export function requiresExplicitUserRetryToReExecute(): boolean {
  return INTERRUPTED_TURN_RECOVERY_POLICY.reExecuteRequiresExplicitUserRetry;
}

/**
 * R3 — hydrate decision from persisted messages only (no toolRuntimeState).
 * Orphans ⇒ terminalize; clean history ⇒ noop.
 */
export function decideHydrateRecoveryAction(messages: Message[]): HydrateRecoveryAction {
  return listOrphanToolCalls(messages).length > 0
    ? 'terminalize_interrupted'
    : 'noop';
}

/** True when history already carries a durable interrupt/cancel notice. */
export function hasInterruptedOrCancelNotice(
  messages: Message[],
  kind: 'interrupted' | 'user_cancel' | 'any' = 'any',
): boolean {
  return messages.some((message) => {
    if (message.role !== 'assistant' || typeof message.content !== 'string') {
      return false;
    }
    const content = message.content;
    const interrupted = content.includes('Tool run interrupted before completion')
      && content.includes('do NOT re-request');
    const userCancel = content.includes('Tool run cancelled by user')
      && content.includes('do NOT re-request');
    if (kind === 'interrupted') return interrupted;
    if (kind === 'user_cancel') return userCancel;
    return interrupted || userCancel
      || message.metadata?.interruptedTurnTerminal === true;
  });
}

export type InterruptedRecoveryInvariantResult = {
  ok: boolean;
  orphans: OrphanToolCall[];
  hasNotice: boolean;
  violations: string[];
};

/**
 * Post-hydrate / post-terminalize checks:
 * - no orphan tool_calls remain
 * - durable cancel/interrupted notice when `expectNotice` is true
 * - policy still forbids auto-resume / auto-retry
 */
export function assertInterruptedRecoveryInvariants(
  messages: Message[],
  options: { expectNotice?: boolean } = {},
): InterruptedRecoveryInvariantResult {
  const orphans = listOrphanToolCalls(messages);
  const hasNotice = hasInterruptedOrCancelNotice(messages, 'any');
  const violations: string[] = [];

  if (orphans.length > 0) {
    violations.push(
      `orphan tool_calls remain: ${orphans.map((o) => o.toolCall.id).join(',')}`,
    );
  }
  if (options.expectNotice === true && !hasNotice) {
    violations.push('expected durable cancel/interrupted notice');
  }
  if (shouldResumeRunningTurnAfterRestart()) {
    violations.push('policy R1 violated: resumeRunningTurnAfterRestart is true');
  }
  if (shouldAutoRetryInterruptedTool()) {
    violations.push('policy R2 violated: autoRetryRunningToolAfterRestart is true');
  }
  if (!requiresExplicitUserRetryToReExecute()) {
    violations.push('policy R4 violated: reExecuteRequiresExplicitUserRetry is false');
  }

  return {
    ok: violations.length === 0,
    orphans,
    hasNotice,
    violations,
  };
}
