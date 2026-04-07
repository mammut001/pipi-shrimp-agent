/**
 * Result Collector
 *
 * Tracks delegation execution, collects agent results,
 * and produces a synthesis-ready structure for the main thread.
 *
 * Uses the swarm runtime's SwarmEventBus to listen for task_result_received events.
 */

import type {
  DelegationPlan,
  DelegationResult,
  DelegationStatus,
  AgentResult,
  AgentRoleType,
} from './types';

// =============================================================================
// Active Delegation Tracking
// =============================================================================

/** In-flight delegation execution with result accumulation */
interface ActiveDelegation {
  plan: DelegationPlan;
  /** Maps runtime agent ID → planned agent index */
  agentMapping: Map<string, number>;
  /** Collected results so far */
  results: AgentResult[];
  /** Promise resolvers for completion */
  resolve: (result: DelegationResult) => void;
  startedAt: number;
}

/** Active delegations indexed by plan ID */
const activeDelegations = new Map<string, ActiveDelegation>();

// =============================================================================
// Lifecycle
// =============================================================================

/**
 * Register a delegation plan as active and begin collecting results.
 *
 * Returns a promise that resolves when all agents have completed (or failed).
 * Also returns a timeout handle for the caller to manage.
 */
export function startCollecting(plan: DelegationPlan): {
  promise: Promise<DelegationResult>;
  registerAgent: (agentName: string, runtimeAgentId: string, runtimeTaskId: string) => void;
} {
  let resolvePromise!: (result: DelegationResult) => void;
  const promise = new Promise<DelegationResult>((resolve) => {
    resolvePromise = resolve;
  });

  const delegation: ActiveDelegation = {
    plan,
    agentMapping: new Map(),
    results: [],
    resolve: resolvePromise,
    startedAt: Date.now(),
  };

  activeDelegations.set(plan.id, delegation);

  const registerAgent = (agentName: string, runtimeAgentId: string, _runtimeTaskId: string) => {
    const idx = plan.agents.findIndex((a) => a.name === agentName);
    if (idx >= 0) {
      delegation.agentMapping.set(runtimeAgentId, idx);
    }
  };

  return { promise, registerAgent };
}

/**
 * Record a result from a completed/failed agent.
 *
 * Called by the swarm event listener when task_result_received fires.
 * When all expected agents have reported, resolves the delegation promise.
 */
export function recordAgentResult(
  planId: string,
  runtimeAgentId: string,
  runtimeTaskId: string,
  content: string,
  success: boolean,
  error?: string,
): boolean {
  const delegation = activeDelegations.get(planId);
  if (!delegation) return false;

  const agentIdx = delegation.agentMapping.get(runtimeAgentId);
  const planned = agentIdx !== undefined ? delegation.plan.agents[agentIdx] : undefined;

  const result: AgentResult = {
    agentName: planned?.name || runtimeAgentId,
    role: planned?.role || ('unknown' as AgentRoleType),
    scope: planned?.scope || 'general',
    runtimeAgentId,
    runtimeTaskId,
    success,
    content,
    error,
    completedAt: Date.now(),
  };

  delegation.results.push(result);

  // Check if all agents have reported
  if (delegation.results.length >= delegation.plan.agents.length) {
    finalizeDelegation(delegation);
    return true; // Delegation complete
  }

  return false;
}

/**
 * Force-finish a delegation (e.g., on timeout).
 * Resolves with whatever results have been collected so far.
 */
export function forceFinish(planId: string): DelegationResult | null {
  const delegation = activeDelegations.get(planId);
  if (!delegation) return null;

  return finalizeDelegation(delegation);
}

/**
 * Check if a delegation is still active.
 */
export function isActive(planId: string): boolean {
  return activeDelegations.has(planId);
}

/**
 * Get current progress for an active delegation.
 */
export function getProgress(planId: string): {
  total: number;
  completed: number;
  results: AgentResult[];
} | null {
  const delegation = activeDelegations.get(planId);
  if (!delegation) return null;

  return {
    total: delegation.plan.agents.length,
    completed: delegation.results.length,
    results: [...delegation.results],
  };
}

// =============================================================================
// Internal
// =============================================================================

function finalizeDelegation(delegation: ActiveDelegation): DelegationResult {
  const allSuccess = delegation.results.every((r) => r.success);
  const anySuccess = delegation.results.some((r) => r.success);

  let status: DelegationStatus;
  if (allSuccess) {
    status = 'completed';
  } else if (anySuccess) {
    status = 'partial_failure';
  } else {
    status = 'failed';
  }

  const synthesisInput = buildSynthesisInput(delegation);

  const result: DelegationResult = {
    planId: delegation.plan.id,
    status,
    agentResults: delegation.results,
    synthesisInput,
    startedAt: delegation.startedAt,
    completedAt: Date.now(),
  };

  // Resolve the waiting promise
  delegation.resolve(result);

  // Clean up
  activeDelegations.delete(delegation.plan.id);

  return result;
}

/**
 * Build a synthesis-ready input string from all agent results.
 *
 * This is what gets injected into the main thread's conversation
 * so the assistant can produce a synthesized response.
 */
function buildSynthesisInput(delegation: ActiveDelegation): string {
  const parts: string[] = [];

  parts.push('## Delegation Results\n');
  parts.push(`**Task:** ${delegation.plan.userMessage}\n`);
  parts.push(`**Strategy:** ${delegation.plan.synthesisStrategy}\n`);

  for (const result of delegation.results) {
    const statusIcon = result.success ? '✅' : '❌';
    parts.push(`### ${statusIcon} ${result.agentName} (${result.role})`);
    if (result.success) {
      parts.push(result.content);
    } else {
      parts.push(`**Failed:** ${result.error || 'Unknown error'}`);
      if (result.content) {
        parts.push(`**Partial output:** ${result.content}`);
      }
    }
    parts.push('');
  }

  parts.push('---');
  parts.push(`**Main thread responsibility:** ${delegation.plan.mainThreadResponsibility}`);

  return parts.join('\n');
}

/**
 * Find which active delegation a runtime agent belongs to.
 */
export function findDelegationForAgent(runtimeAgentId: string): string | null {
  for (const [planId, delegation] of activeDelegations) {
    if (delegation.agentMapping.has(runtimeAgentId)) {
      return planId;
    }
  }
  return null;
}
