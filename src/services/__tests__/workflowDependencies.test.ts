import { findReentryAgent } from '../workflowDependencies';
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
});