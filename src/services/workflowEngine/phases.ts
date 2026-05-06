import type {
  GoalEvaluationResult,
  WorkflowAgent,
  WorkflowConnection,
} from '@/types/workflow';
import { parseAgentStatusBlock } from '@/services/workflowPromptBuilder';
import {
  collectDownstreamAgentIds,
  findReentryAgent,
  topoSort,
} from '@/services/workflowDependencies';

function buildRouteMatcher(keyword?: string, keywordMode?: 'includes' | 'regex'): RegExp | null {
  if (!keyword || keywordMode !== 'regex') {
    return null;
  }

  if (keyword.startsWith('/') && keyword.lastIndexOf('/') > 0) {
    const lastSlash = keyword.lastIndexOf('/');
    const pattern = keyword.slice(1, lastSlash);
    const flags = keyword.slice(lastSlash + 1);
    return new RegExp(pattern, flags);
  }

  return new RegExp(keyword, 'i');
}

export function routeMatchesOutput(
  output: string,
  keyword?: string,
  keywordMode: 'includes' | 'regex' = 'includes',
): boolean {
  if (!keyword) return false;

  if (keywordMode === 'regex') {
    try {
      return Boolean(buildRouteMatcher(keyword, keywordMode)?.test(output));
    } catch {
      return false;
    }
  }

  return output.toLowerCase().includes(keyword.toLowerCase());
}

export function evaluateNextAgent(
  currentAgent: WorkflowAgent,
  output: string,
  connections: WorkflowConnection[],
  agents: WorkflowAgent[],
  agentStatus: 'completed' | 'error' = 'completed',
): WorkflowAgent | null {
  const routes = currentAgent.outputRoutes || [];

  for (const route of routes) {
    let matched = false;
    switch (route.condition) {
      case 'onComplete':
        matched = agentStatus === 'completed';
        break;
      case 'onError':
        matched = agentStatus === 'error';
        break;
      case 'outputContains':
        matched = routeMatchesOutput(output, route.keyword, route.keywordMode ?? 'includes');
        break;
      case 'always':
        matched = true;
        break;
    }

    if (matched) {
      return agents.find((agent) => agent.id === route.targetAgentId) ?? null;
    }
  }

  const outgoingConn = connections.find((conn) => conn.sourceAgentId === currentAgent.id);
  if (outgoingConn) {
    return agents.find((agent) => agent.id === outgoingConn.targetAgentId) ?? null;
  }

  return null;
}

export function buildExecutionPlan(
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
  dirtyAgentIds: string[],
): WorkflowAgent[] {
  const orderedAgents = topoSort(agents, connections);
  if (dirtyAgentIds.length === 0) {
    return orderedAgents;
  }

  const rerunSet = new Set(collectDownstreamAgentIds(dirtyAgentIds, agents, connections));
  return orderedAgents.filter((agent) => rerunSet.has(agent.id));
}

function collectTriggeredLoopTargets(
  agents: WorkflowAgent[],
  _connections: WorkflowConnection[],
  agentOutputs: Map<string, string>,
): string[] {
  const triggered = new Set<string>();

  for (const agent of agents) {
    const output = agentOutputs.get(agent.id);
    if (!output) continue;

    for (const route of agent.outputRoutes ?? []) {
      if (route.condition === 'onComplete' || route.condition === 'always') {
        continue;
      }
      if (route.condition === 'outputContains' && !routeMatchesOutput(output, route.keyword, route.keywordMode ?? 'includes')) {
        continue;
      }
      if (route.condition === 'onError') {
        continue;
      }
      triggered.add(route.targetAgentId);
    }

    const status = parseAgentStatusBlock(output);
    if (status?.needs_followup && status.hand_off_to_role) {
      const nextAgent = agents.find((candidate) => candidate.role === status.hand_off_to_role);
      if (nextAgent) {
        triggered.add(nextAgent.id);
      }
    }
  }

  return Array.from(triggered);
}

export function selectReentryAgents(params: {
  evaluation: GoalEvaluationResult;
  agents: WorkflowAgent[];
  connections: WorkflowConnection[];
  agentOutputs: Map<string, string>;
}): string[] {
  const triggered = collectTriggeredLoopTargets(
    params.agents,
    params.connections,
    params.agentOutputs,
  );

  if (params.evaluation.nextAgentIdHint) {
    triggered.unshift(params.evaluation.nextAgentIdHint);
  }

  if (triggered.length > 0) {
    return Array.from(new Set(triggered));
  }

  const fallbackAgent = findReentryAgent(
    params.evaluation,
    params.agents,
    params.agentOutputs,
  );

  return fallbackAgent ? [fallbackAgent.id] : [];
}
