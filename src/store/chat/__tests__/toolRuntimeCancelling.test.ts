import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';

const mockSetTaskProgress = jest.fn();
const mockClearTaskProgress = jest.fn();

jest.mock('../../uiStore', () => ({
  useUIStore: {
    getState: () => ({
      setTaskProgress: mockSetTaskProgress,
      clearTaskProgress: mockClearTaskProgress,
    }),
  },
}));

import type { ChatState } from '../../../types/chat';
import {
  failUnresolvedSessionTools,
  listUnresolvedSessionTools,
  markSessionToolRunning,
  markSessionToolsCancelling,
  resetAllSessionToolRuntime,
  seedSessionToolRuntime,
  setSessionToolExecutionId,
} from '../toolRuntimeState';

function makeState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    currentSessionId: 'session-a',
    pendingToolCalls: 0,
    pendingToolResults: [],
    sessions: [],
    ...overrides,
  } as ChatState;
}

describe('markSessionToolsCancelling', () => {
  let state: ChatState;
  const set = (updater: unknown) => {
    if (typeof updater === 'function') {
      state = { ...state, ...(updater as (s: ChatState) => Partial<ChatState>)(state) };
    } else {
      state = { ...state, ...(updater as Partial<ChatState>) };
    }
  };
  const get = () => state;

  beforeEach(() => {
    mockSetTaskProgress.mockReset();
    mockClearTaskProgress.mockReset();
    resetAllSessionToolRuntime();
    state = makeState();
  });

  afterEach(() => {
    resetAllSessionToolRuntime();
  });

  it('marks unresolved non-terminal steps as cancelling and syncs TaskProgress without restoring pending counters', () => {
    seedSessionToolRuntime(
      'session-a',
      [{ id: 'tool-1', name: 'execute_command' }],
      set,
      get,
    );
    markSessionToolRunning('session-a', 'tool-1', 'execute_command', set, get);
    setSessionToolExecutionId('session-a', 'tool-1', 'execute_command', 'exec-1', set, get);
    // Simulate Stop optimistic busy clear.
    state = { ...state, pendingToolCalls: 0, pendingToolResults: [] };
    mockSetTaskProgress.mockClear();

    markSessionToolsCancelling('session-a', set, get);

    expect(state.pendingToolCalls).toBe(0);
    expect(listUnresolvedSessionTools('session-a')).toEqual([
      { toolCallId: 'tool-1', label: 'execute_command', executionId: 'exec-1' },
    ]);
    expect(mockSetTaskProgress).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'tool-1', status: 'cancelling', executionId: 'exec-1' }),
    ]);
  });

  it('does not touch another session and failUnresolved still terminalizes to cancelled', () => {
    seedSessionToolRuntime('session-a', [{ id: 'tool-a', name: 'read_file' }], set, get);
    seedSessionToolRuntime('session-b', [{ id: 'tool-b', name: 'write_file' }], set, get);
    markSessionToolRunning('session-a', 'tool-a', 'read_file', set, get);
    markSessionToolRunning('session-b', 'tool-b', 'write_file', set, get);
    mockSetTaskProgress.mockClear();

    markSessionToolsCancelling('session-a', set, get);

    const lastCall = mockSetTaskProgress.mock.calls.at(-1)?.[0] as Array<{ id: string; status: string }>;
    expect(lastCall.some((s) => s.id === 'tool-a' && s.status === 'cancelling')).toBe(true);
    expect(lastCall.some((s) => s.id === 'tool-b')).toBe(false);

    failUnresolvedSessionTools(
      'session-a',
      set,
      get,
      (_id, label) => `Error: ${label} cancelled by user`,
      'cancelled',
    );
    expect(listUnresolvedSessionTools('session-a')).toEqual([]);
    expect(mockSetTaskProgress).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'tool-a', status: 'cancelled' }),
    ]);
  });
});
