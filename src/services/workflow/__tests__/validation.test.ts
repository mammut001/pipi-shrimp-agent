import { describe, expect, it } from '@jest/globals';
import { validateWorkflowForRun } from '../validation';
import type { WorkflowAgent, WorkflowConnection, WorkflowInstance } from '@/types/workflow';

function createAgent(overrides: Partial<WorkflowAgent> = {}): WorkflowAgent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'Agent',
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    role: overrides.role ?? 'custom',
    ...overrides,
  };
}

function createInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: overrides.id ?? 'workflow-1',
    name: overrides.name ?? 'Workflow',
    projectGoal: overrides.projectGoal ?? 'Ship the workflow',
    successCriteria: overrides.successCriteria ?? '',
    goalEvaluatorAgentId: overrides.goalEvaluatorAgentId ?? null,
    maxGoalIterations: overrides.maxGoalIterations ?? 5,
    agents: overrides.agents ?? [createAgent({ id: 'agent-1', role: 'writer' })],
    connections: overrides.connections ?? [],
    workflowRuns: overrides.workflowRuns ?? [],
    activeRunId: overrides.activeRunId ?? null,
    dirtyAgentIds: overrides.dirtyAgentIds ?? [],
    createdAt: overrides.createdAt ?? 0,
    updatedAt: overrides.updatedAt ?? 0,
  };
}

describe('validateWorkflowForRun', () => {
  it('accepts a simple valid workflow', () => {
    const result = validateWorkflowForRun(createInstance());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.entryAgentIds).toEqual(['agent-1']);
  });

  it('rejects workflows without executable agents', () => {
    const result = validateWorkflowForRun(createInstance({
      agents: [createAgent({ id: 'goal', role: 'goal-evaluator' })],
    }));

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'no-executable-agents' }),
    ]));
  });

  it('rejects workflows with dangling graph references', () => {
    const agent = createAgent({ id: 'writer', role: 'writer' });
    const danglingConnection: WorkflowConnection = {
      id: 'c1',
      sourceAgentId: 'writer',
      targetAgentId: 'missing',
      condition: 'onComplete',
      type: 'sequential',
    };
    const result = validateWorkflowForRun(createInstance({
      agents: [agent],
      connections: [danglingConnection],
    }));

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'missing-target-agent', connectionId: 'c1' }),
    ]));
  });

  it('rejects cyclic execution graphs', () => {
    const agentA = createAgent({ id: 'a', role: 'writer' });
    const agentB = createAgent({ id: 'b', role: 'developer' });
    const result = validateWorkflowForRun(createInstance({
      agents: [agentA, agentB],
      connections: [
        { id: 'c1', sourceAgentId: 'a', targetAgentId: 'b', condition: 'onComplete', type: 'sequential' },
        { id: 'c2', sourceAgentId: 'b', targetAgentId: 'a', condition: 'onComplete', type: 'sequential' },
      ],
    }));

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'cycle' }),
    ]));
  });
  
    it('rejects workflows with ambiguous multi-predecessor inputs', () => {
      const agentA = createAgent({ id: 'a', role: 'writer' });
      const agentB = createAgent({ id: 'b', role: 'developer' });
      const agentC = createAgent({ id: 'c', role: 'reviewer' });
      const result = validateWorkflowForRun(createInstance({
        agents: [agentA, agentB, agentC],
        connections: [
          { id: 'c1', sourceAgentId: 'a', targetAgentId: 'c', condition: 'onComplete', type: 'sequential' },
          { id: 'c2', sourceAgentId: 'b', targetAgentId: 'c', condition: 'onComplete', type: 'sequential' },
        ],
      }));

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'ambiguous-input', agentId: 'c' }),
      ]));
    });

  it('requires either a project goal or agent-level task fallback', () => {
    const result = validateWorkflowForRun(createInstance({
      projectGoal: '',
      agents: [createAgent({ id: 'agent-1', role: 'writer', task: '', taskPrompt: '', taskInstruction: '' })],
    }));

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-task-fallback', agentId: 'agent-1' }),
    ]));
  });
});
