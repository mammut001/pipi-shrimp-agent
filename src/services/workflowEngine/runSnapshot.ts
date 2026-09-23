import {
  type WorkflowAgent,
  type WorkflowConnection,
  type WorkflowInstance,
} from '@/types/workflow';
import { DEFAULT_MAX_GOAL_ITERATIONS } from '@/services/workflow/defaults';
import { normalizeSuccessCriteria } from '@/services/goal/types';

export interface WorkflowRunSnapshot {
  instanceId: string;
  instanceName: string;
  projectGoal: string;
  successCriteria: string[];
  maxGoalIterations: number;
  goalEvaluatorAgentId: string | null;
  agents: WorkflowAgent[];
  executableAgents: WorkflowAgent[];
  connections: WorkflowConnection[];
  dirtyAgentIds: string[];
}


function cloneWorkflowAgent(agent: WorkflowAgent): WorkflowAgent {
  return {
    ...agent,
    position: { ...agent.position },
    outputRoutes: (agent.outputRoutes ?? []).map((route) => ({ ...route })),
    execution: { ...agent.execution },
    model: agent.model ? { ...agent.model } : undefined,
    retryPolicy: agent.retryPolicy
      ? {
          ...agent.retryPolicy,
          fallbackConfigIds: [...(agent.retryPolicy.fallbackConfigIds ?? [])],
        }
      : undefined,
    notifyOnComplete: [...(agent.notifyOnComplete ?? [])],
  };
}

function cloneWorkflowConnection(connection: WorkflowConnection): WorkflowConnection {
  return { ...connection };
}

function freezeWorkflowRunSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  for (const agent of snapshot.agents) {
    Object.freeze(agent.position);
    Object.freeze(agent.outputRoutes);
    Object.freeze(agent.execution);
    if (agent.model) {
      Object.freeze(agent.model);
    }
    if (agent.retryPolicy) {
      Object.freeze(agent.retryPolicy.fallbackConfigIds ?? []);
      Object.freeze(agent.retryPolicy);
    }
    Object.freeze(agent.notifyOnComplete ?? []);
    Object.freeze(agent);
  }

  for (const connection of snapshot.connections) {
    Object.freeze(connection);
  }

  Object.freeze(snapshot.successCriteria);
  Object.freeze(snapshot.agents);
  Object.freeze(snapshot.executableAgents);
  Object.freeze(snapshot.connections);
  Object.freeze(snapshot.dirtyAgentIds);

  return Object.freeze(snapshot);
}

export function createWorkflowRunSnapshot(instance: WorkflowInstance): WorkflowRunSnapshot {
  const agents = instance.agents.map(cloneWorkflowAgent);
  const connections = instance.connections.map(cloneWorkflowConnection);

  return freezeWorkflowRunSnapshot({
    instanceId: instance.id,
    instanceName: instance.name,
    projectGoal: instance.projectGoal?.trim() || '',
    successCriteria: normalizeSuccessCriteria(instance.successCriteria),
    maxGoalIterations: instance.maxGoalIterations ?? DEFAULT_MAX_GOAL_ITERATIONS,
    goalEvaluatorAgentId: instance.goalEvaluatorAgentId ?? null,
    agents,
    executableAgents: agents.filter((agent) => agent.role !== 'goal-evaluator'),
    connections,
    dirtyAgentIds: [...(instance.dirtyAgentIds ?? [])],
  });
}

export function buildGoalEvaluationInstance(snapshot: WorkflowRunSnapshot): WorkflowInstance {
  return {
    id: snapshot.instanceId,
    name: snapshot.instanceName,
    projectGoal: snapshot.projectGoal,
    successCriteria: [...snapshot.successCriteria],
    goalEvaluatorAgentId: snapshot.goalEvaluatorAgentId,
    maxGoalIterations: snapshot.maxGoalIterations,
    agents: snapshot.agents,
    connections: snapshot.connections,
    workflowRuns: [],
    activeRunId: null,
    dirtyAgentIds: [...snapshot.dirtyAgentIds],
    createdAt: 0,
    updatedAt: 0,
  };
}
