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
});
