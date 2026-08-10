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

  it('llm evaluator parses json inside markdown fences with next_agent_role_hint', async () => {
    const agents = [createAgent('agent-A', 'writer'), createAgent('agent-B', 'developer'), createAgent('agent-C', 'qa')];

    const result = await evaluateWorkflowGoal(
      {
        instance: createInstance({ agents }),
        agents,
        agentOutputs: new Map([
          ['agent-A', 'doc'],
          ['agent-B', 'implementation finished'],
        ]),
        iteration: 1,
      },
      {
        runAgent: async () => `Here is the goal evaluation result:

\`\`\`json
{
  "reached": false,
  "confidence": 0.9,
  "missing_items": [],
  "next_agent_role_hint": "agent-C",
  "reasoning": "Agent B completed, now proceed to agent-C."
}
\`\`\``,
      },
    );

    expect(result.reached).toBe(false);
    expect(result.confidence).toBe(0.9);
    expect(result.nextAgentIdHint).toBe('agent-C');
    expect(result.reasoning).toContain('Agent B completed');
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

  it('rule evaluator evaluates reached: true when all agents have completed without failure markers', () => {
    const agents = [createAgent('writer', 'writer'), createAgent('developer', 'developer')];
    const outputs = new Map([
      ['writer', 'doc output'],
      ['developer', 'Let me first check the current workspace, then implement the full pipeline.'],
    ]);

    const result = evaluateGoalWithRules({
      instance: createInstance({ agents }),
      agents,
      agentOutputs: outputs,
      iteration: 1,
    });

    expect(result.reached).toBe(true);
    expect(result.missingItems).toHaveLength(0);
  });

  it('rule evaluator ignores failure tokens inside fenced code blocks', () => {
    const agents = [createAgent('writer', 'writer'), createAgent('developer', 'developer')];
    const outputs = new Map([
      ['writer', '## Specification\n\n```ts\n// If status === "REJECT", handle error\nconst code = "REVIEW_REJECT";\n```'],
      ['developer', '## Implementation\n\n```ts\nif (res === "<BUG_FOUND>") return null;\n```'],
    ]);

    const result = evaluateGoalWithRules({
      instance: createInstance({ agents }),
      agents,
      agentOutputs: outputs,
      iteration: 1,
    });

    expect(result.reached).toBe(true);
    expect(result.missingItems).toHaveLength(0);
  });
});
