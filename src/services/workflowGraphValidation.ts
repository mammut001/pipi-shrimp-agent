import type { WorkflowAgent, WorkflowConnection } from '@/types/workflow';

export type WorkflowGraphValidationErrorCode =
  | 'cycle'
  | 'self-loop'
  | 'missing-source-agent'
  | 'missing-target-agent'
  | 'duplicate-edge'
  | 'dangling-route'
  | 'ambiguous-input'
  | 'invalid-input-from'
  | 'route-target-missing';

export interface WorkflowGraphValidationError {
  code: WorkflowGraphValidationErrorCode;
  message: string;
  agentIds?: string[];
  connectionIds?: string[];
}

export interface WorkflowGraphValidationResult {
  valid: boolean;
  errors: WorkflowGraphValidationError[];
}

interface EdgeRecord {
  sourceAgentId: string;
  targetAgentId: string;
  agentIds: Set<string>;
  connectionIds: Set<string>;
}

function buildConnectionSignature(connection: WorkflowConnection): string {
  return [
    connection.sourceAgentId,
    connection.targetAgentId,
    connection.condition,
    connection.keyword?.trim().toLowerCase() ?? '',
    connection.keywordMode ?? '',
    connection.type ?? 'sequential',
  ].join('::');
}

function addGraphEdge(
  edges: Map<string, EdgeRecord>,
  sourceAgentId: string,
  targetAgentId: string,
  options?: { agentId?: string; connectionId?: string },
): void {
  const key = `${sourceAgentId}::${targetAgentId}`;
  const existing = edges.get(key);

  if (existing) {
    if (options?.agentId) {
      existing.agentIds.add(options.agentId);
    }
    if (options?.connectionId) {
      existing.connectionIds.add(options.connectionId);
    }
    return;
  }

  edges.set(key, {
    sourceAgentId,
    targetAgentId,
    agentIds: new Set(options?.agentId ? [options.agentId] : []),
    connectionIds: new Set(options?.connectionId ? [options.connectionId] : []),
  });
}

function detectCycle(agentIds: string[], edges: Map<string, EdgeRecord>): string[] {
  if (agentIds.length === 0) {
    return [];
  }

  const indegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const agentId of agentIds) {
    indegree.set(agentId, 0);
    adjacency.set(agentId, new Set());
  }

  for (const edge of edges.values()) {
    const targets = adjacency.get(edge.sourceAgentId);
    if (!targets || targets.has(edge.targetAgentId)) {
      continue;
    }
    targets.add(edge.targetAgentId);
    indegree.set(edge.targetAgentId, (indegree.get(edge.targetAgentId) ?? 0) + 1);
  }

  const queue = agentIds.filter((agentId) => (indegree.get(agentId) ?? 0) === 0);
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    visited += 1;

    for (const targetId of adjacency.get(current) ?? []) {
      const nextDegree = (indegree.get(targetId) ?? 1) - 1;
      indegree.set(targetId, nextDegree);
      if (nextDegree === 0) {
        queue.push(targetId);
      }
    }
  }

  return visited === agentIds.length
    ? []
    : agentIds.filter((agentId) => (indegree.get(agentId) ?? 0) > 0);
}

function describeAgent(agent: WorkflowAgent | undefined, fallbackId: string): string {
  return agent?.name?.trim() || fallbackId;
}

export function validateWorkflowGraph(
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
): WorkflowGraphValidationResult {
  const errors: WorkflowGraphValidationError[] = [];
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const validAgentIds = new Set(agentById.keys());
  const incomingSources = new Map<string, Set<string>>();
  const edges = new Map<string, EdgeRecord>();
  const duplicateConnectionGroups = new Map<string, string[]>();

  for (const agent of agents) {
    incomingSources.set(agent.id, new Set());
  }

  for (const connection of connections) {
    const sourceAgentId = connection.sourceAgentId?.trim() ?? '';
    const targetAgentId = connection.targetAgentId?.trim() ?? '';
    const signature = buildConnectionSignature(connection);
    const duplicateGroup = duplicateConnectionGroups.get(signature) ?? [];
    duplicateGroup.push(connection.id);
    duplicateConnectionGroups.set(signature, duplicateGroup);

    if (!sourceAgentId || !validAgentIds.has(sourceAgentId)) {
      errors.push({
        code: 'missing-source-agent',
        message: `连接 ${connection.id} 引用了不存在的源 Agent。`,
        connectionIds: [connection.id],
      });
      continue;
    }

    if (!targetAgentId || !validAgentIds.has(targetAgentId)) {
      errors.push({
        code: 'missing-target-agent',
        message: `连接 ${connection.id} 引用了不存在的目标 Agent。`,
        connectionIds: [connection.id],
        agentIds: [sourceAgentId],
      });
      continue;
    }

    if (sourceAgentId === targetAgentId) {
      errors.push({
        code: 'self-loop',
        message: `Agent “${describeAgent(agentById.get(sourceAgentId), sourceAgentId)}” 不能连接到自己。`,
        agentIds: [sourceAgentId],
        connectionIds: [connection.id],
      });
      continue;
    }

    incomingSources.get(targetAgentId)?.add(sourceAgentId);
    addGraphEdge(edges, sourceAgentId, targetAgentId, { connectionId: connection.id });
  }

  for (const duplicateIds of duplicateConnectionGroups.values()) {
    if (duplicateIds.length <= 1) {
      continue;
    }

    errors.push({
      code: 'duplicate-edge',
      message: `检测到重复连接：${duplicateIds.join(', ')}。同一逻辑边只能定义一次。`,
      connectionIds: duplicateIds,
    });
  }

  for (const agent of agents) {
    const inputFrom = agent.inputFrom?.trim() ?? '';
    if (inputFrom) {
      if (inputFrom === agent.id) {
        errors.push({
          code: 'self-loop',
          message: `Agent “${describeAgent(agent, agent.id)}” 的 inputFrom 不能指向自己。`,
          agentIds: [agent.id],
        });
      } else if (!validAgentIds.has(inputFrom)) {
        errors.push({
          code: 'invalid-input-from',
          message: `Agent “${describeAgent(agent, agent.id)}” 的 inputFrom 指向了不存在的 Agent。`,
          agentIds: [agent.id],
        });
      } else {
        incomingSources.get(agent.id)?.add(inputFrom);
        addGraphEdge(edges, inputFrom, agent.id, { agentId: agent.id });
      }
    }

    for (const route of agent.outputRoutes ?? []) {
      const targetAgentId = route.targetAgentId?.trim() ?? '';

      if (!targetAgentId) {
        errors.push({
          code: 'dangling-route',
          message: `Agent “${describeAgent(agent, agent.id)}” 存在未指定目标的输出路由。`,
          agentIds: [agent.id],
        });
        continue;
      }

      if (targetAgentId === agent.id) {
        errors.push({
          code: 'self-loop',
          message: `Agent “${describeAgent(agent, agent.id)}” 的输出路由不能回到自己。`,
          agentIds: [agent.id],
        });
        continue;
      }

      if (!validAgentIds.has(targetAgentId)) {
        errors.push({
          code: 'route-target-missing',
          message: `Agent “${describeAgent(agent, agent.id)}” 的输出路由指向了不存在的目标 Agent。`,
          agentIds: [agent.id],
        });
        continue;
      }

      incomingSources.get(targetAgentId)?.add(agent.id);
      addGraphEdge(edges, agent.id, targetAgentId, { agentId: agent.id });
    }
  }

  for (const agent of agents) {
    const predecessors = incomingSources.get(agent.id);
    if (!predecessors || predecessors.size <= 1) {
      continue;
    }

    errors.push({
      code: 'ambiguous-input',
      message: `Agent “${describeAgent(agent, agent.id)}” 同时依赖多个上游（${Array.from(predecessors).join(', ')}）。当前工作流模型要求单一且明确的主输入来源。`,
      agentIds: [agent.id, ...Array.from(predecessors)],
    });
  }

  const cycleAgents = detectCycle(Array.from(validAgentIds), edges);
  if (cycleAgents.length > 0) {
    errors.push({
      code: 'cycle',
      message: `检测到循环依赖，涉及 Agent：${cycleAgents.join(', ')}。请先打断环路后再运行。`,
      agentIds: cycleAgents,
      connectionIds: Array.from(edges.values())
        .filter((edge) => cycleAgents.includes(edge.sourceAgentId) && cycleAgents.includes(edge.targetAgentId))
        .flatMap((edge) => Array.from(edge.connectionIds)),
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}