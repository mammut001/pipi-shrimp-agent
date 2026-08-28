import { create } from 'zustand';

import { buildSessionGoalPromptContext } from '@/services/sessionGoal/goalPrompt';
import type { GoalTurnIntent } from '@/services/sessionGoal/goalIntent';
import type { GoalPreflightResult } from '@/services/workflow/goalPreflight/schema';
import {
  createEmptySessionGoal,
  normalizeSessionGoalRecord,
  type GoalTraceEntry,
  type GoalTraceKind,
  type SessionGoalBudget,
  type SessionGoalEvaluation,
  type SessionGoalRecord,
  type SessionGoalStatus,
} from '@/types/sessionGoal';

const STORAGE_KEY = 'pipi-shrimp-session-goals';
const MAX_TRACES = 40;

type GoalsBySession = Record<string, SessionGoalRecord>;

interface SessionGoalState {
  goalsBySession: GoalsBySession;
  activeSessionId: string | null;
  hydrate: () => void;
  bindSession: (sessionId: string | null) => void;
  getActiveGoal: () => SessionGoalRecord | null;
  getGoalForSession: (sessionId: string) => SessionGoalRecord | null;
  setObjective: (sessionId: string, objective: string) => void;
  applyPreflightResult: (sessionId: string, result: GoalPreflightResult) => void;
  clearGoal: (sessionId: string) => void;
  setStatus: (sessionId: string, status: SessionGoalStatus) => void;
  setAutoContinue: (sessionId: string, enabled: boolean) => void;
  setBudget: (sessionId: string, budget: Partial<SessionGoalBudget>) => void;
  pauseGoal: (sessionId: string) => void;
  resumeGoal: (sessionId: string) => void;
  completeGoal: (sessionId: string, evidence?: string[]) => void;
  syncRestricted: (sessionId: string, restricted: boolean) => void;
  recordTrace: (sessionId: string, kind: GoalTraceKind, summary: string) => void;
  recordEvaluation: (sessionId: string, evaluation: SessionGoalEvaluation) => void;
  consumeTurnBudget: (sessionId: string, tokenDelta?: number) => void;
  getPromptContext: (sessionId: string, intent?: GoalTurnIntent) => Record<string, string>;
}

function loadGoalsFromStorage(): GoalsBySession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const migrated: GoalsBySession = {};

    for (const [sessionId, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) continue;
        migrated[sessionId] = normalizeSessionGoalRecord({
          objective: trimmed,
          status: 'active',
          traces: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        continue;
      }

      if (value && typeof value === 'object' && 'objective' in value) {
        migrated[sessionId] = normalizeSessionGoalRecord(value as SessionGoalRecord);
      }
    }

    return migrated;
  } catch {
    return {};
  }
}

function persistGoals(goalsBySession: GoalsBySession) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(goalsBySession));
  } catch (error) {
    console.error('[sessionGoalStore] Failed to persist goals:', error);
  }
}

function summarizeText(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '（空消息）';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function appendTrace(
  goal: SessionGoalRecord,
  kind: GoalTraceKind,
  summary: string,
): SessionGoalRecord {
  const entry: GoalTraceEntry = {
    id: crypto.randomUUID(),
    kind,
    summary: summarizeText(summary),
    timestamp: Date.now(),
  };

  const traces = [...goal.traces, entry].slice(-MAX_TRACES);
  return {
    ...goal,
    traces,
    updatedAt: Date.now(),
  };
}

function withGoal(
  goalsBySession: GoalsBySession,
  sessionId: string,
  updater: (goal: SessionGoalRecord) => SessionGoalRecord | null,
): GoalsBySession {
  const current = goalsBySession[sessionId] ?? createEmptySessionGoal();
  const next = updater(current);
  if (!next) {
    const { [sessionId]: _removed, ...rest } = goalsBySession;
    return rest;
  }
  return { ...goalsBySession, [sessionId]: next };
}

export const useSessionGoalStore = create<SessionGoalState>((set, get) => ({
  goalsBySession: {},
  activeSessionId: null,

  hydrate: () => {
    set({ goalsBySession: loadGoalsFromStorage() });
  },

  bindSession: (sessionId) => {
    set({ activeSessionId: sessionId });
  },

  getActiveGoal: () => {
    const { activeSessionId, goalsBySession } = get();
    if (!activeSessionId) return null;
    const goal = goalsBySession[activeSessionId];
    if (!goal?.objective?.trim()) return null;
    return goal;
  },

  getGoalForSession: (sessionId) => {
    const goal = get().goalsBySession[sessionId];
    if (!goal?.objective?.trim()) return null;
    return goal;
  },

  setObjective: (sessionId, objective) => {
    const trimmed = objective.trim();
    set((state) => {
      const goalsBySession = trimmed
        ? withGoal(state.goalsBySession, sessionId, (goal) => {
            const now = Date.now();
            const next = normalizeSessionGoalRecord({
              ...goal,
              objective: trimmed,
              status: 'active',
              createdAt: goal.objective ? goal.createdAt : now,
              updatedAt: now,
              lastContinuedAt: now,
            });
            return appendTrace(next, 'system', trimmed === goal.objective ? '目标已更新' : '目标已设定');
          })
        : withGoal(state.goalsBySession, sessionId, () => null);

      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  applyPreflightResult: (sessionId, result) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => {
        const now = Date.now();
        const next = normalizeSessionGoalRecord({
          ...goal,
          objective: result.finalGoal,
          successCriteria: result.successCriteria,
          asciiPreview: result.asciiPreview,
          status: 'active',
          clarifyReady: true,
          updatedAt: now,
          lastContinuedAt: now,
        });
        return appendTrace(next, 'system', '澄清完成，目标已写入会话');
      });
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  clearGoal: (sessionId) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, () => null);
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  setStatus: (sessionId, status) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => {
        if (!goal.objective.trim()) return goal;
        return { ...goal, status, updatedAt: Date.now() };
      });
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  setAutoContinue: (sessionId, enabled) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => {
        if (!goal.objective.trim()) return goal;
        return appendTrace(
          { ...goal, autoContinue: enabled, updatedAt: Date.now() },
          'system',
          enabled ? '自动续跑已开启' : '自动续跑已关闭',
        );
      });
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  setBudget: (sessionId, budget) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => ({
        ...goal,
        budget: { ...goal.budget, ...budget },
        updatedAt: Date.now(),
      }));
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  pauseGoal: (sessionId) => {
    get().setStatus(sessionId, 'paused');
    get().recordTrace(sessionId, 'system', '目标已暂停');
  },

  resumeGoal: (sessionId) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => {
        if (!goal.objective.trim()) return goal;
        const now = Date.now();
        return appendTrace(
          {
            ...goal,
            status: goal.status === 'budget_limited' ? 'active' : 'active',
            updatedAt: now,
            lastContinuedAt: now,
          },
          'system',
          '目标已恢复',
        );
      });
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  completeGoal: (sessionId, evidence = []) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => {
        if (!goal.objective.trim()) return goal;
        const evaluation: SessionGoalEvaluation = {
          reached: true,
          confidence: 0.95,
          reasoning: '用户或系统标记目标完成。',
          evidence,
          timestamp: Date.now(),
        };
        return appendTrace(
          {
            ...goal,
            status: 'completed',
            autoContinue: false,
            lastEvaluation: evaluation,
            updatedAt: Date.now(),
          },
          'system',
          evidence.length > 0 ? `目标完成：${evidence[0]}` : '目标已标记完成',
        );
      });
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  syncRestricted: (sessionId, restricted) => {
    const goal = get().goalsBySession[sessionId];
    if (!goal?.objective?.trim()) return;
    if (goal.status === 'paused' || goal.status === 'completed' || goal.status === 'budget_limited') return;

    const nextStatus: SessionGoalStatus = restricted ? 'restricted' : 'active';
    if (goal.status === nextStatus) return;
    get().setStatus(sessionId, nextStatus);
  },

  recordTrace: (sessionId, kind, summary) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => {
        if (!goal.objective.trim()) return goal;
        return appendTrace(goal, kind, summary);
      });
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  recordEvaluation: (sessionId, evaluation) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => ({
        ...goal,
        lastEvaluation: evaluation,
        updatedAt: Date.now(),
      }));
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  consumeTurnBudget: (sessionId, tokenDelta = 0) => {
    set((state) => {
      const goalsBySession = withGoal(state.goalsBySession, sessionId, (goal) => ({
        ...goal,
        budget: {
          ...goal.budget,
          turnsUsed: goal.budget.turnsUsed + 1,
          tokensUsed: goal.budget.tokensUsed + tokenDelta,
        },
        updatedAt: Date.now(),
      }));
      persistGoals(goalsBySession);
      return { goalsBySession };
    });
  },

  getPromptContext: (sessionId, intent) => {
    const goal = get().goalsBySession[sessionId];
    if (!goal?.objective?.trim()) {
      return buildSessionGoalPromptContext(null, intent);
    }
    return buildSessionGoalPromptContext(goal, intent);
  },
}));
