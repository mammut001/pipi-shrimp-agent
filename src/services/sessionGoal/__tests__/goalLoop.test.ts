import { evaluateSessionGoalTurn, stripGoalMarkers } from '@/services/sessionGoal/goalEvaluator';
import { decideGoalLoopAfterTurn } from '@/services/sessionGoal/goalLoop';
import { DEFAULT_SESSION_GOAL_BUDGET, normalizeSessionGoalRecord } from '@/types/sessionGoal';

describe('session goal evaluator', () => {
  it('detects explicit reached marker', () => {
    const goal = normalizeSessionGoalRecord({
      objective: 'Build API',
      status: 'active',
    });
    const evaluation = evaluateSessionGoalTurn(goal, 'All tests pass. [[SESSION_GOAL_REACHED]]');
    expect(evaluation.reached).toBe(true);
    expect(stripGoalMarkers('done [[SESSION_GOAL_REACHED]]')).toBe('done');
  });
});

describe('session goal loop', () => {
  it('continues when auto-continue is enabled', () => {
    const goal = normalizeSessionGoalRecord({
      objective: 'Build API',
      status: 'active',
      autoContinue: true,
      budget: { ...DEFAULT_SESSION_GOAL_BUDGET, turnsUsed: 1 },
    });
    const decision = decideGoalLoopAfterTurn({
      goal,
      assistantContent: 'Implemented handler, still need tests.',
    });
    expect(decision.action).toBe('continue');
    expect(decision.continueMessage).toContain('Build API');
  });

  it('marks budget limited when turns exhausted', () => {
    const goal = normalizeSessionGoalRecord({
      objective: 'Build API',
      status: 'active',
      autoContinue: true,
      budget: { ...DEFAULT_SESSION_GOAL_BUDGET, turnsUsed: DEFAULT_SESSION_GOAL_BUDGET.maxTurns },
    });
    const decision = decideGoalLoopAfterTurn({
      goal,
      assistantContent: 'Still working...',
    });
    expect(decision.action).toBe('budget_limited');
  });

  it('does NOT advance goal when turn intent is unrelated (even with autoContinue ON)', () => {
    const goal = normalizeSessionGoalRecord({
      objective: 'Create goal-test.txt containing goal completed',
      status: 'active',
      autoContinue: true,
      budget: { ...DEFAULT_SESSION_GOAL_BUDGET, turnsUsed: 1 },
    });
    const decision = decideGoalLoopAfterTurn({
      goal,
      assistantContent: '2',
      intent: 'unrelated',
    });
    expect(decision.action).toBe('none');
    expect(decision.continueMessage).toBeUndefined();
  });

  it('does NOT advance goal when turn intent is interrupt', () => {
    const goal = normalizeSessionGoalRecord({
      objective: 'Create goal-test.txt containing goal completed',
      status: 'active',
      autoContinue: true,
      budget: { ...DEFAULT_SESSION_GOAL_BUDGET, turnsUsed: 1 },
    });
    const decision = decideGoalLoopAfterTurn({
      goal,
      assistantContent: '好的，已暂停目标。',
      intent: 'interrupt',
    });
    expect(decision.action).toBe('none');
    expect(decision.continueMessage).toBeUndefined();
  });

  it('does NOT advance goal when autoContinue is OFF', () => {
    const goal = normalizeSessionGoalRecord({
      objective: 'Create goal-test.txt containing goal completed',
      status: 'active',
      autoContinue: false,
      budget: { ...DEFAULT_SESSION_GOAL_BUDGET, turnsUsed: 1 },
    });
    const decision = decideGoalLoopAfterTurn({
      goal,
      assistantContent: 'Created file scaffold.',
      intent: 'goal_related',
    });
    expect(decision.action).toBe('none');
  });

  it('advances goal when turn intent is goal_continue and autoContinue is ON', () => {
    const goal = normalizeSessionGoalRecord({
      objective: 'Create goal-test.txt containing goal completed',
      status: 'active',
      autoContinue: true,
      budget: { ...DEFAULT_SESSION_GOAL_BUDGET, turnsUsed: 1 },
    });
    const decision = decideGoalLoopAfterTurn({
      goal,
      assistantContent: 'Continuing with task...',
      intent: 'goal_continue',
    });
    expect(decision.action).toBe('continue');
    expect(decision.continueMessage).toContain('Create goal-test.txt');
  });
});
