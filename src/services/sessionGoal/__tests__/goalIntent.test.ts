import { classifyGoalTurnIntent } from '../goalIntent';
import type { SessionGoalRecord } from '@/types/sessionGoal';

describe('classifyGoalTurnIntent', () => {
  const goal: SessionGoalRecord = {
    id: 'goal-1',
    sessionId: 'session-1',
    objective: 'Create goal-test.txt containing goal completed',
    status: 'active',
    autoContinue: true,
    budget: { turnsUsed: 0, maxTurns: 10, tokensUsed: 0, maxTokens: 10000 },
    successCriteria: ['goal-test.txt exists', 'content is valid'],
    traces: [],
    clarifications: [],
    history: [],
    asciiPreview: '',
    updatedAt: Date.now(),
  };

  it('1. classifies math question as unrelated', () => {
    const intent = classifyGoalTurnIntent('1+1等于几？', goal);
    expect(intent).toBe('unrelated');
  });

  it('2. classifies greeting as unrelated', () => {
    const intent = classifyGoalTurnIntent('你好', goal);
    expect(intent).toBe('unrelated');
  });

  it('3. classifies recursion explanation question as unrelated', () => {
    const intent = classifyGoalTurnIntent('解释一下什么是递归', goal);
    expect(intent).toBe('unrelated');
  });

  it('4. classifies explicit pause / interrupt command as interrupt', () => {
    const intent = classifyGoalTurnIntent('先别做目标，我想问个问题', goal);
    expect(intent).toBe('interrupt');
  });

  it('5. classifies explicit continuation command as goal_continue', () => {
    expect(classifyGoalTurnIntent('继续目标', goal)).toBe('goal_continue');
    expect(classifyGoalTurnIntent('继续完成刚才的任务', goal)).toBe('goal_continue');
    expect(classifyGoalTurnIntent('continue goal', goal)).toBe('goal_continue');
  });

  it('6. classifies automatic continuation option as goal_continue', () => {
    const intent = classifyGoalTurnIntent('任意消息', goal, { goalLoopContinuation: true });
    expect(intent).toBe('goal_continue');
  });

  it('7. classifies goal keyword related follow-up as goal_related', () => {
    const intent = classifyGoalTurnIntent('goal-test.txt 写好了吗？', goal);
    expect(intent).toBe('goal_related');
  });
});
