import type {
  GoalEvaluationResult,
  WorkflowAgent,
  WorkflowConnection,
} from '@/types/workflow';
import { parseAgentStatusBlock } from '@/services/workflowPromptBuilder';
import { resolveAgentIdByRole } from '@/services/workflow/templates/roles';
import {
  collectDownstreamAgentIds,
  findReentryAgent,
  topoSort,
} from '@/services/workflowDependencies';

// AUDIT-FIX [fix-5#8] — LLM-authored regexes can be made to trigger
// catastrophic backtracking (ReDoS). We block the most common offenders
// *before* constructing the `RegExp` so an infinite regex can never get
// compiled. This is a heuristic, not a complete ReDoS proof.
function isReDoSSuspicious(pattern: string): boolean {
  // Reject nested quantifiers like `(a+)+`, `(a*)*`, `(a+)*`, etc.
  // The regex is intentionally non-greedy and limited to ASCII quantifiers.
  return /\((?:[^()]*[*+][^()]*)\)[*+]/.test(pattern)
    || /[*+]\)[*+]/.test(pattern)
    || /(\.\*)+/.test(pattern)
    || /(\.\+)+/.test(pattern);
}

function buildRouteMatcher(keyword?: string, keywordMode?: 'includes' | 'regex'): RegExp | null {
  if (!keyword || keywordMode !== 'regex') {
    return null;
  }

  if (keyword.startsWith('/') && keyword.lastIndexOf('/') > 0) {
    const lastSlash = keyword.lastIndexOf('/');
    const pattern = keyword.slice(1, lastSlash);
    const flags = keyword.slice(lastSlash + 1);
    if (isReDoSSuspicious(pattern)) {
      return null;
    }
    return new RegExp(pattern, flags);
  }

  if (isReDoSSuspicious(keyword)) {
    return null;
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
  const routes = connections
    .filter((connection) => connection.sourceAgentId === currentAgent.id)
    .map((connection) => ({
      id: connection.id,
      condition: connection.condition,
      keyword: connection.keyword,
      keywordMode: connection.keywordMode,
      targetAgentId: connection.targetAgentId,
    }));

  const candidateRoutes = routes.length > 0 ? routes : (currentAgent.outputRoutes || []);

  for (const route of candidateRoutes) {
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
      // AUDIT-FIX [fix-5#9] — An unknown condition is now logged via
      // `console.warn` (in dev) so the operator can see the typo /
      // outdated enum value. Previously it was silently swallowed,
      // causing routes to never match.
      default: {
        // eslint-disable-next-line no-console
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(
            `[workflow] unknown route condition '${route.condition}' on connection '${route.id}', skipping`,
          );
        }
        matched = false;
        break;
      }
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
  connections: WorkflowConnection[],
  agentOutputs: Map<string, string>,
): string[] {
  const triggered = new Set<string>();

  for (const agent of agents) {
    const output = agentOutputs.get(agent.id);
    if (!output) continue;

    for (const connection of connections.filter((item) => item.sourceAgentId === agent.id)) {
      if (connection.condition === 'onComplete' || connection.condition === 'always') {
        continue;
      }
      if (connection.condition === 'outputContains' && !routeMatchesOutput(output, connection.keyword, connection.keywordMode ?? 'includes')) {
        continue;
      }
      if (connection.condition === 'onError') {
        continue;
      }
      triggered.add(connection.targetAgentId);
    }

    const status = parseAgentStatusBlock(output);
    if (status?.needs_followup && status.hand_off_to_role) {
      const nextAgentId = resolveAgentIdByRole(agents, status.hand_off_to_role);
      if (nextAgentId) {
        triggered.add(nextAgentId);
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
