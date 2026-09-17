import { describe, expect, it } from '@jest/globals';
import type { Session } from '../../../types/chat';
import {
  COMPOSER_SEND_CONTROL_TEST_ID,
  COMPOSER_STOP_BUSY_HINT_TEST_ID,
  COMPOSER_STOP_CONTROL_TEST_ID,
  filterSessionsByProject,
  resolveComposerSendStopAffordance,
  selectCurrentMessages,
  selectCurrentSession,
  shouldShowStopControl,
} from '../chatSelectors';

const sessions: Session[] = [
  { id: 's1', title: 'One', messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }], createdAt: 1, updatedAt: 1 },
  { id: 's2', title: 'Two', messages: [], createdAt: 2, updatedAt: 2, projectId: 'p1' },
];

describe('chatSelectors', () => {
  it('selects the current session and messages by id', () => {
    expect(selectCurrentSession(sessions, 's1')?.title).toBe('One');
    expect(selectCurrentMessages(sessions, 's1')).toHaveLength(1);
  });

  it('returns stable empty values when no session is selected', () => {
    expect(selectCurrentSession(sessions, null)).toBeNull();
    expect(selectCurrentMessages(sessions, 'missing')).toEqual([]);
  });

  it('filters project and unprojected sessions', () => {
    expect(filterSessionsByProject(sessions, 'p1').map((session) => session.id)).toEqual(['s2']);
    expect(filterSessionsByProject(sessions, null).map((session) => session.id)).toEqual(['s1']);
  });
});

describe('shouldShowStopControl', () => {
  it('shows Stop while streaming', () => {
    expect(shouldShowStopControl({
      isStreaming: true,
      pendingToolCalls: 0,
      pendingToolResultsLength: 0,
    })).toBe(true);
  });

  it('shows Stop during long tools even when isStreaming is false', () => {
    expect(shouldShowStopControl({
      isStreaming: false,
      pendingToolCalls: 1,
      pendingToolResultsLength: 0,
    })).toBe(true);
    expect(shouldShowStopControl({
      isStreaming: false,
      pendingToolCalls: 0,
      pendingToolResultsLength: 2,
    })).toBe(true);
  });

  it('hides Stop when idle', () => {
    expect(shouldShowStopControl({
      isStreaming: false,
      pendingToolCalls: 0,
      pendingToolResultsLength: 0,
    })).toBe(false);
  });
});

describe('resolveComposerSendStopAffordance', () => {
  it('affordance delegates to shouldShowStopControl', () => {
    const states = [
      { isStreaming: false, pendingToolCalls: 0, pendingToolResultsLength: 0 },
      { isStreaming: true, pendingToolCalls: 0, pendingToolResultsLength: 0 },
      { isStreaming: false, pendingToolCalls: 2, pendingToolResultsLength: 0 },
      { isStreaming: false, pendingToolCalls: 0, pendingToolResultsLength: 1 },
      { isStreaming: true, pendingToolCalls: 1, pendingToolResultsLength: 1 },
    ];

    for (const state of states) {
      const affordance = resolveComposerSendStopAffordance(state);
      expect(affordance.showStop).toBe(shouldShowStopControl(state));
      expect(affordance.sendPrimary).toBe(!affordance.showStop);
      expect(affordance.primaryAction).toBe(affordance.showStop ? 'stop' : 'send');
    }
  });

  it('streaming → primary stop, reason streaming, stop title key stopStreaming', () => {
    const affordanceOnlyStreaming = resolveComposerSendStopAffordance({
      isStreaming: true,
      pendingToolCalls: 0,
      pendingToolResultsLength: 0,
    });
    expect(affordanceOnlyStreaming.showStop).toBe(true);
    expect(affordanceOnlyStreaming.primaryAction).toBe('stop');
    expect(affordanceOnlyStreaming.sendPrimary).toBe(false);
    expect(affordanceOnlyStreaming.stopReason).toBe('streaming');
    expect(affordanceOnlyStreaming.stopTitleKey).toBe('chat.stopStreaming');
    expect(affordanceOnlyStreaming.sendTitleKey).toBe('chat.send');
    expect(affordanceOnlyStreaming.stopTestId).toBe(COMPOSER_STOP_CONTROL_TEST_ID);
    expect(affordanceOnlyStreaming.sendTestId).toBe(COMPOSER_SEND_CONTROL_TEST_ID);
    expect(affordanceOnlyStreaming.busyHintKey).toBe('chat.stopBusyHint');

    // Streaming takes precedence even when tools are also pending
    const affordanceStreamingWithTools = resolveComposerSendStopAffordance({
      isStreaming: true,
      pendingToolCalls: 3,
      pendingToolResultsLength: 2,
    });
    expect(affordanceStreamingWithTools.showStop).toBe(true);
    expect(affordanceStreamingWithTools.primaryAction).toBe('stop');
    expect(affordanceStreamingWithTools.sendPrimary).toBe(false);
    expect(affordanceStreamingWithTools.stopReason).toBe('streaming');
    expect(affordanceStreamingWithTools.stopTitleKey).toBe('chat.stopStreaming');
  });

  it('pending tools only → primary stop, reason pending_tools', () => {
    const affordancePendingCalls = resolveComposerSendStopAffordance({
      isStreaming: false,
      pendingToolCalls: 1,
      pendingToolResultsLength: 0,
    });
    expect(affordancePendingCalls.showStop).toBe(true);
    expect(affordancePendingCalls.primaryAction).toBe('stop');
    expect(affordancePendingCalls.sendPrimary).toBe(false);
    expect(affordancePendingCalls.stopReason).toBe('pending_tools');
    expect(affordancePendingCalls.stopTitleKey).toBe('chat.stopTools');
    expect(affordancePendingCalls.sendTitleKey).toBe('chat.send');
    expect(affordancePendingCalls.busyHintKey).toBe('chat.stopBusyHint');

    const affordancePendingResults = resolveComposerSendStopAffordance({
      isStreaming: false,
      pendingToolCalls: 0,
      pendingToolResultsLength: 2,
    });
    expect(affordancePendingResults.showStop).toBe(true);
    expect(affordancePendingResults.primaryAction).toBe('stop');
    expect(affordancePendingResults.sendPrimary).toBe(false);
    expect(affordancePendingResults.stopReason).toBe('pending_tools');
    expect(affordancePendingResults.stopTitleKey).toBe('chat.stopTools');
    expect(affordancePendingResults.busyHintKey).toBe('chat.stopBusyHint');
  });

  it('idle → primary send, showStop false', () => {
    const affordanceIdle = resolveComposerSendStopAffordance({
      isStreaming: false,
      pendingToolCalls: 0,
      pendingToolResultsLength: 0,
    });
    expect(affordanceIdle.showStop).toBe(false);
    expect(affordanceIdle.primaryAction).toBe('send');
    expect(affordanceIdle.sendPrimary).toBe(true);
    expect(affordanceIdle.stopReason).toBeNull();
    expect(affordanceIdle.stopTitleKey).toBe('chat.stop');
    expect(affordanceIdle.sendTitleKey).toBe('chat.send');
    expect(affordanceIdle.stopTestId).toBe('composer-stop-control');
    expect(affordanceIdle.sendTestId).toBe('composer-send-control');
    expect(affordanceIdle.busyHintKey).toBeNull();
  });

  it('provides stable testId constants', () => {
    expect(COMPOSER_STOP_CONTROL_TEST_ID).toBe('composer-stop-control');
    expect(COMPOSER_SEND_CONTROL_TEST_ID).toBe('composer-send-control');
    expect(COMPOSER_STOP_BUSY_HINT_TEST_ID).toBe('composer-stop-busy-hint');
  });
});

