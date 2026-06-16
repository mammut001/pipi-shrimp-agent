import { buildSessionGoalPromptContext } from '@/services/sessionGoal/goalPrompt';
import { normalizeSessionGoalRecord } from '@/types/sessionGoal';

describe('buildSessionGoalPromptContext', () => {
  it('returns empty block when no goal is set', () => {
    expect(buildSessionGoalPromptContext(null)).toEqual({ sessionGoalBlock: '' });
  });

  it('includes objective, status, trace, and guidance when active', () => {
    const goal = normalizeSessionGoalRecord({
      objective: 'Build a Go marketplace',
      status: 'active',
      successCriteria: ['Users can list items'],
      traces: [{ id: '1', kind: 'user_turn', summary: 'start project', timestamp: 1 }],
      createdAt: 1,
      updatedAt: 2,
    });

    const context = buildSessionGoalPromptContext(goal);
    expect(context.sessionGoalBlock).toContain('Build a Go marketplace');
    expect(context.sessionGoalBlock).toContain('进行中');
    expect(context.sessionGoalBlock).toContain('start project');
  });
});
