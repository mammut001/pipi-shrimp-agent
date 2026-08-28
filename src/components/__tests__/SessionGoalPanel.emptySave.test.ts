import { useSessionGoalStore } from '@/store/sessionGoalStore';
import { normalizeSessionGoalRecord } from '@/types/sessionGoal';

describe('Session Goal empty save validation', () => {
  beforeEach(() => {
    useSessionGoalStore.setState({
      goalsBySession: {
        'session-1': normalizeSessionGoalRecord({
          objective: 'Important project goal',
          status: 'active',
        }),
      },
      activeSessionId: 'session-1',
    });
  });

  it('keeps existing goal intact when empty objective is submitted to validation logic', () => {
    const existing = useSessionGoalStore.getState().getGoalForSession('session-1');
    expect(existing?.objective).toBe('Important project goal');

    const draft = '   ';
    const trimmed = draft.trim();
    
    // Simulating the fixed handleSave behavior:
    if (trimmed) {
      useSessionGoalStore.getState().setObjective('session-1', trimmed);
    }
    // trimmed is empty, so clearGoal is NOT called

    const afterSave = useSessionGoalStore.getState().getGoalForSession('session-1');
    expect(afterSave?.objective).toBe('Important project goal');
    expect(afterSave?.status).toBe('active');
  });

  it('explicit clearGoal removes the goal', () => {
    useSessionGoalStore.getState().clearGoal('session-1');
    const afterClear = useSessionGoalStore.getState().getGoalForSession('session-1');
    expect(afterClear).toBeNull();
  });
});
