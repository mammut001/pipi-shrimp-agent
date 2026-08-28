import type { GoalEvaluation, GoalSpec } from '@/services/goal/types';

/** Lifecycle for a per-session durable objective (Codex /goal-inspired). */
export type SessionGoalStatus =
  | 'idle'
  | 'active'
  | 'paused'
  | 'completed'
  | 'restricted'
  | 'budget_limited';

export type GoalTraceKind = 'user_turn' | 'assistant_turn' | 'system';

export interface GoalTraceEntry {
  id: string;
  kind: GoalTraceKind;
  summary: string;
  timestamp: number;
}

export interface SessionGoalBudget {
  maxTurns: number;
  turnsUsed: number;
  maxTokens: number;
  tokensUsed: number;
}

export type SessionGoalEvaluation = GoalEvaluation & {
  evidence: string[];
};

export interface SessionGoalRecord extends GoalSpec {
  asciiPreview: string;
  status: SessionGoalStatus;
  autoContinue: boolean;
  budget: SessionGoalBudget;
  lastEvaluation?: SessionGoalEvaluation;
  clarifyReady: boolean;
  traces: GoalTraceEntry[];
  createdAt: number;
  updatedAt: number;
  lastContinuedAt?: number;
}

export const DEFAULT_SESSION_GOAL_BUDGET: SessionGoalBudget = {
  maxTurns: 15,
  turnsUsed: 0,
  maxTokens: 120_000,
  tokensUsed: 0,
};

export function createEmptySessionGoal(): SessionGoalRecord {
  const now = Date.now();
  return {
    objective: '',
    successCriteria: [],
    asciiPreview: '',
    status: 'idle',
    autoContinue: false,
    budget: { ...DEFAULT_SESSION_GOAL_BUDGET },
    clarifyReady: false,
    traces: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeSessionGoalRecord(raw: Partial<SessionGoalRecord> & Pick<SessionGoalRecord, 'objective'>): SessionGoalRecord {
  const base = createEmptySessionGoal();
  return {
    ...base,
    ...raw,
    successCriteria: raw.successCriteria ?? base.successCriteria,
    asciiPreview: raw.asciiPreview ?? base.asciiPreview,
    autoContinue: raw.autoContinue ?? base.autoContinue,
    budget: {
      ...DEFAULT_SESSION_GOAL_BUDGET,
      ...(raw.budget ?? {}),
    },
    clarifyReady: raw.clarifyReady ?? base.clarifyReady,
    traces: raw.traces ?? base.traces,
  };
}
