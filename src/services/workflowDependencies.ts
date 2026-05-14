import type {
  GoalEvaluationResult,
  WorkflowAgent,
  WorkflowConnection,
} from '@/types/workflow';
import { parseWorkflowMarkers } from '@/services/workflow/templates/markers';
import { normalizeWorkflowAgentRole } from '@/services/workflow/templates/roles';

function buildOutgoingMap(
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
): Map<string, Set<string>> {
  const outgoing = new Map<string, Set<string>>();
  for (const agent of agents) {
    outgoing.set(agent.id, new Set());
  }

  for (const conn of connections) {
    outgoing.get(conn.sourceAgentId)?.add(conn.targetAgentId);
  }

  return outgoing;
}

export function topoSort(
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
): WorkflowAgent[] {
  const inDegree = new Map<string, number>();
  const outgoing = buildOutgoingMap(agents, connections);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  for (const agent of agents) {
    inDegree.set(agent.id, 0);
  }

  for (const [, targets] of outgoing) {
    for (const targetId of targets) {
      inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1);
    }
  }

  const queue = agents
    .filter((agent) => (inDegree.get(agent.id) ?? 0) === 0)
    .sort((a, b) => agents.indexOf(a) - agents.indexOf(b));

  const result: WorkflowAgent[] = [];

  while (queue.length > 0) {
    const agent = queue.shift()!;
    result.push(agent);

    for (const targetId of outgoing.get(agent.id) ?? []) {
      const nextDegree = (inDegree.get(targetId) ?? 1) - 1;
      inDegree.set(targetId, nextDegree);
      if (nextDegree === 0) {
        const target = agentById.get(targetId);
        if (target) queue.push(target);
      }
    }
  }

  if (result.length !== agents.length) {
    throw new Error('topoSort requires a validated acyclic workflow graph. Run validateWorkflowGraph() before building an execution plan.');
  }

  return result;
}

export function getPredecessorIds(
  agentId: string,
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
): string[] {
  const predecessors = new Set<string>();

  for (const conn of connections) {
    if (conn.targetAgentId === agentId) {
      predecessors.add(conn.sourceAgentId);
    }
  }

  return Array.from(predecessors);
}

export function collectDownstreamAgentIds(
  startAgentIds: string[],
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
): string[] {
  const outgoing = buildOutgoingMap(agents, connections);
  const visited = new Set(startAgentIds);
  const queue = [...startAgentIds];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const nextId of outgoing.get(currentId) ?? []) {
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      queue.push(nextId);
    }
  }

  return Array.from(visited);
}

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

    const hasErrorRoute = connections.some((connection) => (
      connection.sourceAgentId === predId
      && connection.targetAgentId === agent.id
      && connection.condition === 'onError'
    ));

    if (!hasErrorRoute) {
      blocking.push(predId);
    }
  }

  return blocking;
}

function findFirstAgentByRole(
  agents: WorkflowAgent[],
  role: WorkflowAgent['role'],
): WorkflowAgent | undefined {
  return agents.find((agent) => normalizeWorkflowAgentRole(agent.role) === normalizeWorkflowAgentRole(role));
}

function chooseByFailureMarker(
  agents: WorkflowAgent[],
  agentOutputs: Map<string, string>,
): WorkflowAgent | undefined {
  const outputs = [...agentOutputs.entries()].reverse();
  for (const [, output] of outputs) {
    const markers = parseWorkflowMarkers(output);

    if (markers.includes('TESTS_FAIL_CODE')) {
      return findFirstAgentByRole(agents, 'developer') ?? findFirstAgentByRole(agents, 'qa');
    }
    if (markers.includes('TESTS_FAIL_SPEC')) {
      return findFirstAgentByRole(agents, 'writer') ?? findFirstAgentByRole(agents, 'qa');
    }
    if (markers.includes('REVIEW_REJECT')) {
      return findFirstAgentByRole(agents, 'developer') ?? findFirstAgentByRole(agents, 'reviewer');
    }
    if (markers.includes('GOAL_NOT_REACHED')) {
      return (
        findFirstAgentByRole(agents, 'developer')
        ?? findFirstAgentByRole(agents, 'writer')
        ?? findFirstAgentByRole(agents, 'qa')
        ?? findFirstAgentByRole(agents, 'planner')
      );
    }
  }

  return undefined;
}

export function findReentryAgent(
  evaluation: GoalEvaluationResult,
  agents: WorkflowAgent[],
  agentOutputs: Map<string, string>,
): WorkflowAgent | null {
  if (evaluation.nextAgentIdHint) {
    return agents.find((agent) => agent.id === evaluation.nextAgentIdHint) ?? null;
  }

  const markerDriven = chooseByFailureMarker(agents, agentOutputs);
  if (markerDriven) {
    return markerDriven;
  }

  if (evaluation.missingItems.length > 0) {
    return (
      findFirstAgentByRole(agents, 'developer')
      ?? findFirstAgentByRole(agents, 'writer')
      ?? findFirstAgentByRole(agents, 'qa')
      ?? findFirstAgentByRole(agents, 'reviewer')
      ?? findFirstAgentByRole(agents, 'planner')
      ?? agents.find((agent) => agent.role !== 'goal-evaluator')
      ?? null
    );
  }

  return null;
}
