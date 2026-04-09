/**
 * Workflow Dependency Utilities
 *
 * Provides:
 * - Topological sort of workflow agents based on connections
 * - Predecessor lookup
 * - Upstream-failure blocking logic
 */

import type { WorkflowAgent, WorkflowConnection } from '@/types/workflow';

// ============================================================
// Topological Sort (Kahn's algorithm)
// ============================================================

/**
 * Sort workflow agents in topological order (entry agents first).
 *
 * Handles:
 * - One-to-one: A → B
 * - One-to-many: A → B, A → C
 * - Many-to-one: A + B → C
 *
 * Returns agents in dependency order. If the graph has a cycle, the
 * remaining cyclic agents are appended at the end (best-effort).
 */
export function topoSort(
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
): WorkflowAgent[] {
  // Build in-degree map and adjacency list
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>(); // sourceId → [targetId, ...]

  for (const agent of agents) {
    inDegree.set(agent.id, 0);
    outgoing.set(agent.id, []);
  }

  for (const conn of connections) {
    // Only count each dependency once (deduplicate duplicate connections)
    const targets = outgoing.get(conn.sourceAgentId);
    if (targets && !targets.includes(conn.targetAgentId)) {
      targets.push(conn.targetAgentId);
      inDegree.set(conn.targetAgentId, (inDegree.get(conn.targetAgentId) ?? 0) + 1);
    }
  }

  // Also account for outputRoute-based connections (agents using setAgentInputFrom)
  // but only if they're NOT already represented in connections (avoid double-counting)
  const connectedPairs = new Set(connections.map(c => `${c.sourceAgentId}→${c.targetAgentId}`));
  for (const agent of agents) {
    if (agent.inputFrom) {
      const key = `${agent.inputFrom}→${agent.id}`;
      if (!connectedPairs.has(key)) {
        // This connection exists via inputFrom but not in connections array — add it
        const targets = outgoing.get(agent.inputFrom);
        if (targets && !targets.includes(agent.id)) {
          targets.push(agent.id);
          inDegree.set(agent.id, (inDegree.get(agent.id) ?? 0) + 1);
        }
      }
    }
  }

  // BFS (Kahn's algorithm)
  const queue: WorkflowAgent[] = agents
    .filter(a => (inDegree.get(a.id) ?? 0) === 0)
    // Preserve original order for agents with in-degree 0
    .sort((a, b) => agents.indexOf(a) - agents.indexOf(b));

  const result: WorkflowAgent[] = [];
  const agentById = new Map(agents.map(a => [a.id, a]));

  while (queue.length > 0) {
    const agent = queue.shift()!;
    result.push(agent);

    for (const targetId of (outgoing.get(agent.id) ?? [])) {
      const newDegree = (inDegree.get(targetId) ?? 1) - 1;
      inDegree.set(targetId, newDegree);
      if (newDegree === 0) {
        const target = agentById.get(targetId);
        if (target) queue.push(target);
      }
    }
  }

  // Append any remaining agents (cyclic nodes — shouldn't happen in normal workflows)
  for (const agent of agents) {
    if (!result.includes(agent)) {
      result.push(agent);
    }
  }

  return result;
}

// ============================================================
// Predecessor lookup
// ============================================================

/**
 * Get all direct predecessor agent IDs for a given agent.
 * Combines both connections[] and inputFrom for complete picture.
 */
export function getPredecessorIds(
  agentId: string,
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
): string[] {
  const preds = new Set<string>();

  // From connections array
  for (const conn of connections) {
    if (conn.targetAgentId === agentId) {
      preds.add(conn.sourceAgentId);
    }
  }

  // From inputFrom (in case it's not represented in connections)
  const agent = agents.find(a => a.id === agentId);
  if (agent?.inputFrom) {
    preds.add(agent.inputFrom);
  }

  return Array.from(preds);
}

// ============================================================
// Upstream failure gate
// ============================================================

/**
 * Determine whether an agent should be skipped because a required
 * predecessor failed without providing an explicit error route.
 *
 * Returns the list of blocking failed predecessors.
 * Empty = agent may proceed.
 */
export function getBlockingFailures(
  agent: WorkflowAgent,
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
  failedAgentIds: Set<string>,
): string[] {
  const predecessorIds = getPredecessorIds(agent.id, agents, connections);
  const blocking: string[] = [];

  for (const predId of predecessorIds) {
    if (!failedAgentIds.has(predId)) continue;

    // Check if the failed predecessor has an explicit error route pointing TO this agent
    const predAgent = agents.find(a => a.id === predId);
    const hasErrorRoute = predAgent?.outputRoutes.some(
      r => r.condition === 'onError' && r.targetAgentId === agent.id,
    ) ?? false;

    if (!hasErrorRoute) {
      blocking.push(predId);
    }
  }

  return blocking;
}
