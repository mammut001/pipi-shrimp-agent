import {
  evaluateGoalWithRules,
  evaluateWorkflowGoal,
} from '../workflowGoalEvaluator';
import type {
  WorkflowAgent,
  WorkflowInstance,
} from '@/types/workflow';

function createAgent(id: string, role: WorkflowAgent['role']): WorkflowAgent {
  return {
    id,
    name: id,
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    role,
  };
}

function createInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: 'instance-1',
    name: 'Workflow',
    projectGoal: 'Ship the feature',
    successCriteria: 'Tests pass and docs are updated',
    goalEvaluatorAgentId: null,
    maxGoalIterations: 5,
    agents: [],
    connections: [],
    workflowRuns: [],
    activeRunId: null,
    dirtyAgentIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('workflowGoalEvaluator', () => {
  it('rule evaluator reaches goal when all agents completed without failure markers', () => {
    const agents = [createAgent('writer', 'writer'), createAgent('developer', 'developer')];
    const outputs = new Map([
      ['writer', 'requirements ready'],
      ['developer', 'implementation ready [[WORKFLOW:PASS]]'],
    ]);

    const result = evaluateGoalWithRules({
      instance: createInstance({ agents }),
      agents,
      agentOutputs: outputs,
      iteration: 1,
    });

    expect(result.reached).toBe(true);
    expect(result.missingItems).toEqual([]);
  });

  it('llm evaluator parses valid json output', async () => {
    const agents = [createAgent('writer', 'writer'), createAgent('developer', 'developer')];

    const result = await evaluateWorkflowGoal(
      {
        instance: createInstance({ agents }),
        agents,
        agentOutputs: new Map([
          ['writer', 'doc'],
          ['developer', 'code'],
        ]),
        iteration: 2,
      },
      {
        runAgent: async () => JSON.stringify({
          reached: true,
          confidence: 0.85,
          missing_items: [],
          next_agent_role_hint: 'coder',
          reasoning: 'Everything is done.',
        }),
      },
    );

    expect(result.reached).toBe(true);
    expect(result.confidence).toBe(0.85);
    expect(result.nextAgentIdHint).toBe('developer');
  });

  it('falls back to rule evaluator when llm json parsing fails', async () => {
    const agents = [createAgent('qa', 'qa')];

    const result = await evaluateWorkflowGoal(
      {
        instance: createInstance({ agents }),
        agents,
        agentOutputs: new Map([
          ['qa', 'failure [[WORKFLOW:TESTS_FAIL_CODE]]'],
        ]),
        iteration: 1,
      },
      {
        runAgent: async () => 'not-json',
      },
    );

    expect(result.reached).toBe(false);
    expect(result.reasoning).toContain('回退到规则判定');
    expect(result.missingItems.length).toBeGreaterThan(0);
  });

  it('rule evaluator rejects lazy planning stubs when no real execution occurred', () => {
    const agents = [createAgent('writer', 'writer'), createAgent('developer', 'developer')];
    const outputs = new Map([
      ['writer', 'doc [[WORKFLOW:PASS]]'],
      ['developer', 'Let me first check the current workspace, then implement the full pipeline.'],
    ]);

    const result = evaluateGoalWithRules({
      instance: createInstance({ agents }),
      agents,
      agentOutputs: outputs,
      iteration: 1,
    });

    expect(result.reached).toBe(false);
    expect(result.missingItems).toContain('部分 Agent 仅输出了计划说明而未产生真实执行与产物。');
  });
});
