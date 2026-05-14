import type {
  WorkflowAgent,
  WorkflowInstance,
} from '@/types/workflow';
import {
  type WorkflowGraphValidationError,
  type WorkflowGraphValidationErrorCode,
  validateWorkflowGraph,
} from '@/services/workflowGraphValidation';

export type WorkflowValidationErrorCode =
  | WorkflowGraphValidationErrorCode
  | 'missing-instance'
  | 'duplicate-agent-id'
  | 'no-executable-agents'
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
  agentIds?: string[];
  connectionIds?: string[];
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

function toWorkflowValidationError(
  error: WorkflowGraphValidationError,
): WorkflowValidationError {
  return {
    code: error.code,
    message: error.message,
    agentId: error.agentIds?.[0],
    connectionId: error.connectionIds?.[0],
    agentIds: error.agentIds,
    connectionIds: error.connectionIds,
  };
}

export function formatWorkflowValidationErrors(
  result: WorkflowValidationResult,
): string {
  if (result.errors.length === 0) {
    return 'Workflow validation passed.';
  }

  return result.errors
    .map((error, index) => `${index + 1}. [${error.code}] ${error.message}`)
    .join('\n');
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

  const graphValidation = validateWorkflowGraph(agents, connections);
  errors.push(...graphValidation.errors.map(toWorkflowValidationError));

  for (const agent of agents) {
    if (!agent.name?.trim()) {
      errors.push({
        code: 'missing-agent-name',
        message: '存在未命名的 Agent，请先补全名称。',
        agentId: agent.id,
      });
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

  return {
    valid: errors.length === 0,
    errors,
    firstError: errors[0] ?? null,
    entryAgentIds,
    executableAgentIds,
  };
}
