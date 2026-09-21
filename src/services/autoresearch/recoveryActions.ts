/**
 * Shared AutoResearch recovery-action dispatcher.
 *
 * Recovery buttons historically only opened the detail modal / debug tab.
 * This module maps each AutoResearchRecoveryAction.type onto a real
 * loop-engine or inspect outcome so Panel + DashboardView stay thin.
 *
 * Handlers are injected (no top-level loopEngine import) so light UI unit
 * tests can mount DashboardView without pulling the full loop graph.
 */

import type { AutoResearchRecoveryAction } from './history';

export type AutoResearchRecoveryDispatchResult =
  | { kind: 'executed'; effect: 'retry' | 'abort' }
  | { kind: 'inspect'; focus: 'debug' }
  | { kind: 'unsupported'; reason: string };

export interface AutoResearchRecoveryLoopHandlers {
  resumeExperimentLoop: (runId?: string) => void;
  stopExperimentLoop: (runId?: string) => void;
}

function unsupportedReason(action: AutoResearchRecoveryAction, fallback: string): string {
  const reason = typeof action.reason === 'string' ? action.reason.trim() : '';
  return reason.length > 0 ? reason : fallback;
}

/**
 * Pure dispatch: maps a recovery action onto loop APIs or an inspect cue.
 * Inject `handlers` so tests can assert resume/stop without booting the store.
 */
export function dispatchAutoResearchRecoveryAction(
  action: AutoResearchRecoveryAction,
  runId: string | null | undefined,
  handlers: AutoResearchRecoveryLoopHandlers,
): AutoResearchRecoveryDispatchResult {
  if (action.supported === false) {
    return {
      kind: 'unsupported',
      reason: unsupportedReason(action, `${action.type} is not available for this run.`),
    };
  }

  switch (action.type) {
    case 'retry_iteration':
    case 'retry_failed_phase': {
      handlers.resumeExperimentLoop(runId || undefined);
      return { kind: 'executed', effect: 'retry' };
    }
    case 'abort_run': {
      handlers.stopExperimentLoop(runId || undefined);
      return { kind: 'executed', effect: 'abort' };
    }
    case 'open_logs':
    case 'open_raw_request_summary':
      return { kind: 'inspect', focus: 'debug' };
    case 'switch_provider':
      return {
        kind: 'unsupported',
        reason: unsupportedReason(
          action,
          'Provider switching is not available from recovery actions yet. Change the agent provider in settings, then start a new run.',
        ),
      };
    case 'increase_tool_budget':
      return {
        kind: 'unsupported',
        reason: unsupportedReason(
          action,
          'Increase the tool-round budget (or fix tool permission/confirmation settings) in the agent config, then start a new run.',
        ),
      };
    default: {
      const unknownType = (action as AutoResearchRecoveryAction).type;
      return {
        kind: 'unsupported',
        reason: `Unknown recovery action: ${unknownType}`,
      };
    }
  }
}

/** Convenience alias used by React click handlers. */
export function handleAutoResearchRecoveryAction(
  action: AutoResearchRecoveryAction,
  runId: string | null | undefined,
  handlers: AutoResearchRecoveryLoopHandlers,
): AutoResearchRecoveryDispatchResult {
  return dispatchAutoResearchRecoveryAction(action, runId, handlers);
}

export default handleAutoResearchRecoveryAction;
