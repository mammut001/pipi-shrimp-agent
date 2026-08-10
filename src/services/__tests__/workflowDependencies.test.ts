import { findReentryAgent } from '../workflowDependencies';
import { selectReentryAgents } from '../workflowEngine/phases';
import type { GoalEvaluationResult, WorkflowAgent } from '@/types/workflow';

function createAgent(overrides: Partial<WorkflowAgent>): WorkflowAgent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'Agent',
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    ...overrides,
  };
}

describe('workflowDependencies', () => {
  it('falls back to a non-evaluator agent when no role-based reentry target exists', () => {
    const evaluation: GoalEvaluationResult = {
      iteration: 1,
      reached: false,
      confidence: 0.3,
      missingItems: ['Follow up on failures'],
      reasoning: 'Need another pass.',
      timestamp: 1,
    };

    const customAgent = createAgent({ id: 'custom-agent', role: 'custom' });
    const evaluator = createAgent({ id: 'evaluator', role: 'goal-evaluator' });

    const reentry = findReentryAgent(
      evaluation,
      [customAgent, evaluator],
      new Map([['custom-agent', '[[WORKFLOW:GOAL_NOT_REACHED]]']]),
    );

    expect(reentry?.id).toBe('custom-agent');
  });

  it('selects unexecuted C when evaluation hint points to already executed B and outputs exist for A and B', () => {
    const agentA = createAgent({ id: 'agent-A', role: 'planner' });
    const agentB = createAgent({ id: 'agent-B', role: 'developer' });
    const agentC = createAgent({ id: 'agent-C', role: 'qa' });

    const evaluation: GoalEvaluationResult = {
      iteration: 1,
      reached: false,
      confidence: 0.8,
      missingItems: [],
      nextAgentIdHint: 'agent-B',
      reasoning: 'Evaluation hint pointing to B',
      timestamp: 1,
    };

    const selected = selectReentryAgents({
      evaluation,
      agents: [agentA, agentB, agentC],
      connections: [],
      agentOutputs: new Map([
        ['agent-A', 'output A'],
        ['agent-B', 'output B'],
      ]),
    });

    expect(selected).toEqual(['agent-C']);
  });

  it('evaluates reached: true when all agents (A, B, C) have completed without failure markers', async () => {
    const { evaluateGoalWithRules, evaluateWorkflowGoal } = await import('../workflowGoalEvaluator');

    const agentA = createAgent({ id: 'agent-A', role: 'planner', name: 'Technical Writer' });
    const agentB = createAgent({ id: 'agent-B', role: 'developer', name: 'Full Stack Developer' });
    const agentC = createAgent({ id: 'agent-C', role: 'qa', name: 'QA Engineer' });
    const agents = [agentA, agentB, agentC];

    const agentOutputs = new Map([
      ['agent-A', 'Spec doc complete.'],
      ['agent-B', 'Feature implementation ready.'],
      ['agent-C', 'QA tests passed.'],
    ]);

    const context = {
      instance: {
        id: 'inst-1',
        name: 'Workflow',
        projectGoal: 'Build feature',
        successCriteria: 'Pass',
        goalEvaluatorAgentId: null,
        maxGoalIterations: 5,
        agents,
        connections: [],
        workflowRuns: [],
        activeRunId: null,
        dirtyAgentIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      agents,
      agentOutputs,
      iteration: 1,
    };

    const ruleResult = evaluateGoalWithRules(context);
    expect(ruleResult.reached).toBe(true);

    const fullResult = await evaluateWorkflowGoal(context, {
      runAgent: async () => JSON.stringify({
        reached: false,
        confidence: 0.8,
        missing_items: ['Developer should add unit tests'],
        next_agent_role_hint: 'coder',
        reasoning: 'Need developer re-run.',
      }),
    });

    expect(fullResult.reached).toBe(true);
    expect(fullResult.nextAgentIdHint).toBeUndefined();
  });
});