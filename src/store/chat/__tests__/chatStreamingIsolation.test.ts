import { describe, expect, it } from '@jest/globals';

import {
  bumpChatSessionTurnEpoch,
  clearChatGenerationCancel,
  consumeChatGenerationCancel,
  getChatSessionTurnEpoch,
  requestChatGenerationCancel,
  resetChatSessionTurnEpochForTests,
  ownsSelectedStreamChrome,
  resolveStreamingOwnerSessionId,
} from '../chatStreaming';

describe('chat streaming session isolation (TOP-15-01)', () => {
  it('resolveStreamingOwnerSessionId prefers streamingSessionId over currentSessionId', () => {
    expect(resolveStreamingOwnerSessionId('stream-a', 'current-b')).toBe('stream-a');
  });

  it('resolveStreamingOwnerSessionId falls back to currentSessionId when stream id is null', () => {
    expect(resolveStreamingOwnerSessionId(null, 'current-b')).toBe('current-b');
  });

  it('selectSession cancellation marks only the requested session', () => {
    requestChatGenerationCancel('session-a');
    expect(consumeChatGenerationCancel('session-a')).toBe(true);
    expect(consumeChatGenerationCancel('session-b')).toBe(false);
  });

  it('late cancel token cannot bleed into a newly selected session', () => {
    requestChatGenerationCancel('session-a');
    clearChatGenerationCancel('session-a');
    expect(consumeChatGenerationCancel('session-b')).toBe(false);
  });

  it('turn epoch bumps so stale Stop completion can be detected', () => {
    resetChatSessionTurnEpochForTests();
    expect(getChatSessionTurnEpoch('session-a')).toBe(0);
    const stopEpoch = getChatSessionTurnEpoch('session-a');
    bumpChatSessionTurnEpoch('session-a');
    expect(getChatSessionTurnEpoch('session-a')).not.toBe(stopEpoch);
    expect(getChatSessionTurnEpoch('session-b')).toBe(0);
  });
});

  it('ownsSelectedStreamChrome is true only when owning session is selected', () => {
    expect(ownsSelectedStreamChrome('session-a', 'session-a')).toBe(true);
    expect(ownsSelectedStreamChrome('session-a', 'session-b')).toBe(false);
    expect(ownsSelectedStreamChrome(null, 'session-b')).toBe(false);
    expect(ownsSelectedStreamChrome('session-a', null)).toBe(false);
  });

