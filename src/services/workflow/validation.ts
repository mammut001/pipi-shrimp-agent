import type {
  WorkflowAgent,
  WorkflowConnection,
  WorkflowInstance,
} from '@/types/workflow';

export type WorkflowValidationErrorCode =
  | 'missing-instance'
  | 'duplicate-agent-id'
  | 'no-executable-agents'
  | 'dangling-connection'
  | 'missing-route-target'
  | 'invalid-input-from'
  | 'cycle-detected'
  | 'missing-entry-agent'
  | 'missing-agent-name'
  | 'missing-task-fallback'
  | 'invalid-execution'
  | 'invalid-max-iterations';

export interface WorkflowValidationError {
  code: WorkflowValidationErrorCode;
  message: string;
  agentId?: string;
  connectionId?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowValidationError[];
  firstError: WorkflowValidationError | null;
  entryAgentIds: string[];
  executableAgentIds: string[];
}

function isExecutableAgent(agent: WorkflowAgent): boolean {
  return agent.role !== 'goal-evaluator';
}

function hasAgentTaskFallback(agent: WorkflowAgent): boolean {
  return Boolean(
    agent.task?.trim()
      || agent.taskPrompt?.trim()
      || agent.taskInstruction?.trim(),
  );
}

function hasSequentialCycle(
  agentIds: string[],
  connections: WorkflowConnection[],
): boolean {
  const idSet = new Set(agentIds);
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const agentId of idSet) {
    indegree.set(agentId, 0);
    adjacency.set(agentId, new Set());
  }

  for (const connection of connections) {
    if (!idSet.has(connection.sourceAgentId) || !idSet.has(connection.targetAgentId)) {
      continue;
    }

    if (connection.sourceAgentId === connection.targetAgentId) {
      return true;
    }

    const targets = adjacency.get(connection.sourceAgentId);
    if (!targets || targets.has(connection.targetAgentId)) {
      continue;
    }

    targets.add(connection.targetAgentId);
    indegree.set(connection.targetAgentId, (indegree.get(connection.targetAgentId) ?? 0) + 1);
  }

  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([agentId]) => agentId);
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    visited += 1;

    for (const target of adjacency.get(current) ?? []) {
      const nextDegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) {
        queue.push(target);
      }
    }
  }

  return visited !== idSet.size;
}

export function validateWorkflowForRun(
  instance: WorkflowInstance | null | undefined,
): WorkflowValidationResult {
  const errors: WorkflowValidationError[] = [];

  if (!instance) {
    errors.push({
      code: 'missing-instance',
      message: '请先创建一个 Workflow。',
    });

    return {
      valid: false,
      errors,
      firstError: errors[0] ?? null,
      entryAgentIds: [],
      executableAgentIds: [],
    };
  }

  const agents = instance.agents ?? [];
  const connections = instance.connections ?? [];
  const executableAgents = agents.filter(isExecutableAgent);
  const executableAgentIds = executableAgents.map((agent) => agent.id);
  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const seenAgentIds = new Set<string>();
  const hasProjectGoal = Boolean(instance.projectGoal?.trim());

  for (const agent of agents) {
    if (seenAgentIds.has(agent.id)) {
      errors.push({
        code: 'duplicate-agent-id',
        message: `存在重复 Agent ID：${agent.id}`,
        agentId: agent.id,
      });
      continue;
    }
    seenAgentIds.add(agent.id);
  }

  for (const connection of connections) {
    if (!validAgentIds.has(connection.sourceAgentId) || !validAgentIds.has(connection.targetAgentId)) {
      errors.push({
        code: 'dangling-connection',
        message: '存在指向缺失 Agent 的连接，请先清理图结构。',
        connectionId: connection.id,
      });
    }
  }

  for (const agent of agents) {
    if (!agent.name?.trim()) {
      errors.push({
        code: 'missing-agent-name',
        message: '存在未命名的 Agent，请先补全名称。',
        agentId: agent.id,
      });
    }

    if (agent.inputFrom && !validAgentIds.has(agent.inputFrom)) {
      errors.push({
        code: 'invalid-input-from',
        message: `Agent “${agent.name || agent.id}” 的上游引用已失效。`,
        agentId: agent.id,
      });
    }

    for (const route of agent.outputRoutes ?? []) {
      if (!validAgentIds.has(route.targetAgentId)) {
        errors.push({
          code: 'missing-route-target',
          message: `Agent “${agent.name || agent.id}” 存在缺失目标的输出路由。`,
          agentId: agent.id,
        });
      }
    }

    if (!isExecutableAgent(agent)) {
      continue;
    }

    if (!hasProjectGoal && !hasAgentTaskFallback(agent)) {
      errors.push({
        code: 'missing-task-fallback',
        message: `Agent “${agent.name || agent.id}” 缺少任务说明，且当前 Workflow 没有项目目标可兜底。`,
        agentId: agent.id,
      });
    }

    if (!agent.execution?.mode) {
      errors.push({
        code: 'invalid-execution',
        message: `Agent “${agent.name || agent.id}” 缺少执行模式配置。`,
        agentId: agent.id,
      });
      continue;
    }

    if (
      agent.execution.mode === 'multi-round'
      && (!Number.isFinite(agent.execution.maxRounds) || (agent.execution.maxRounds ?? 0) <= 0)
    ) {
      errors.push({
        code: 'invalid-execution',
        message: `Agent “${agent.name || agent.id}” 的多轮执行配置无效。`,
        agentId: agent.id,
      });
    }
  }

  if (executableAgents.length === 0) {
    errors.push({
      code: 'no-executable-agents',
      message: '至少需要一个可执行的 Agent 才能运行 Workflow。',
    });
  }

  if (!Number.isInteger(instance.maxGoalIterations) || instance.maxGoalIterations <= 0) {
    errors.push({
      code: 'invalid-max-iterations',
      message: '最大 Goal 迭代次数必须是大于 0 的整数。',
    });
  }

  const executableIdSet = new Set(executableAgentIds);
  const executableConnections = connections.filter((connection) => (
    executableIdSet.has(connection.sourceAgentId) && executableIdSet.has(connection.targetAgentId)
  ));
  const entryAgentIds = executableAgents
    .filter((agent) => !executableConnections.some((connection) => connection.targetAgentId === agent.id))
    .map((agent) => agent.id);

  if (executableAgents.length > 0 && entryAgentIds.length === 0) {
    errors.push({
      code: 'missing-entry-agent',
      message: '当前 Workflow 没有可作为入口的 Agent，通常意味着存在循环依赖。',
    });
  }

  if (hasSequentialCycle(executableAgentIds, executableConnections)) {
    errors.push({
      code: 'cycle-detected',
      message: '当前 Workflow 存在循环依赖，运行前请先打断环路。',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    firstError: errors[0] ?? null,
    entryAgentIds,
    executableAgentIds,
  };
}
