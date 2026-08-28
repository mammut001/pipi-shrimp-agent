import { buildContinueGoalMessage } from '@/services/sessionGoal/goalPrompt';
import { evaluateSessionGoalTurn, isBudgetExhausted } from '@/services/sessionGoal/goalEvaluator';
import type { GoalTurnIntent } from '@/services/sessionGoal/goalIntent';
import type { SessionGoalEvaluation, SessionGoalRecord } from '@/types/sessionGoal';

export type GoalLoopAction = 'none' | 'complete' | 'continue' | 'budget_limited' | 'blocked';

export interface GoalLoopDecision {
  action: GoalLoopAction;
  evaluation: SessionGoalEvaluation;
  continueMessage?: string;
}

export interface GoalLoopTurnInput {
  goal: SessionGoalRecord;
  assistantContent: string;
  tokenDelta?: number;
  isGoalLoopContinuation?: boolean;
  intent?: GoalTurnIntent;
}

export function decideGoalLoopAfterTurn(input: GoalLoopTurnInput): GoalLoopDecision {
  const { goal, assistantContent, tokenDelta = 0, intent } = input;

  if (intent === 'unrelated' || intent === 'interrupt') {
    return {
      action: 'none',
      evaluation: {
        reached: false,
        confidence: 0,
        reasoning: '当前轮次为独立问题或已被暂停，不推进持久目标循环',
        evidence: [],
        timestamp: Date.now(),
      },
    };
  }

  const evaluation = evaluateSessionGoalTurn(goal, assistantContent);

  if (goal.status === 'paused' || goal.status === 'completed') {
    return { action: 'none', evaluation };
  }

  const projectedTokens = goal.budget.tokensUsed + tokenDelta;
  const budgetHit = goal.budget.turnsUsed >= goal.budget.maxTurns
    || projectedTokens >= goal.budget.maxTokens;

  if (evaluation.reached && evaluation.confidence >= 0.7) {
    return { action: 'complete', evaluation };
  }

  if (budgetHit) {
    return { action: 'budget_limited', evaluation };
  }

  if (evaluation.reasoning.includes('需要用户介入')) {
    return { action: 'blocked', evaluation };
  }

  if (!goal.autoContinue) {
    return { action: 'none', evaluation };
  }

  return {
    action: 'continue',
    evaluation,
    continueMessage: buildContinueGoalMessage(goal.objective, goal.successCriteria),
  };
}

export function shouldRunGoalLoop(options?: {
  goalLoopContinuation?: boolean;
  isPlanMode?: boolean;
  intent?: GoalTurnIntent;
}): boolean {
  if (options?.isPlanMode) return false;
  if (options?.intent === 'unrelated' || options?.intent === 'interrupt') return false;
  return true;
}
