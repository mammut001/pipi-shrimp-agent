import { describe, expect, it, beforeEach } from '@jest/globals';

import {
  appendStreamingBuffer,
  bumpChatSessionTurnEpoch,
  clearChatGenerationCancel,
  clearStreamingBuffer,
  consumeChatGenerationCancel,
  getChatSessionTurnEpoch,
  getStreamingBuffer,
  requestChatGenerationCancel,
  resetChatSessionTurnEpochForTests,
  resetStreamingBuffersForTests,
  ownsSelectedStreamChrome,
  resolveSessionStreamReasoning,
  resolveSessionStreamText,
  resolveStreamingOwnerSessionId,
  setStreamingBuffer,
} from '../chatStreaming';

describe('chat streaming session isolation (TOP-15-01)', () => {
  beforeEach(() => {
    resetChatSessionTurnEpochForTests();
    resetStreamingBuffersForTests();
  });

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
    expect(getChatSessionTurnEpoch('session-a')).toBe(0);
    const stopEpoch = getChatSessionTurnEpoch('session-a');
    bumpChatSessionTurnEpoch('session-a');
    expect(getChatSessionTurnEpoch('session-a')).not.toBe(stopEpoch);
    expect(getChatSessionTurnEpoch('session-b')).toBe(0);
  });

  it('ownsSelectedStreamChrome is true only when owning session is selected', () => {
    expect(ownsSelectedStreamChrome('session-a', 'session-a')).toBe(true);
    expect(ownsSelectedStreamChrome('session-a', 'session-b')).toBe(false);
    expect(ownsSelectedStreamChrome(null, 'session-b')).toBe(false);
    expect(ownsSelectedStreamChrome('session-a', null)).toBe(false);
  });

  it('per-session streaming buffers do not cross-contaminate on concurrent append', () => {
    appendStreamingBuffer('session-a', 'A1');
    appendStreamingBuffer('session-b', 'B1');
    appendStreamingBuffer('session-a', 'A2');
    expect(getStreamingBuffer('session-a')).toBe('A1A2');
    expect(getStreamingBuffer('session-b')).toBe('B1');
  });

  it('clearStreamingBuffer only clears the owning session', () => {
    setStreamingBuffer('session-a', 'AAA');
    setStreamingBuffer('session-b', 'BBB');
    clearStreamingBuffer('session-a');
    expect(getStreamingBuffer('session-a')).toBe('');
    expect(getStreamingBuffer('session-b')).toBe('BBB');
  });


  it('resolveSessionStreamText: empty A buffer must not inherit B selected chrome', () => {
    expect(resolveSessionStreamText('session-a', 'B-chrome', 'session-b')).toBe('');
    expect(resolveSessionStreamText('session-b', 'B-chrome', 'session-b')).toBe('B-chrome');
    setStreamingBuffer('session-a', 'A-only');
    expect(resolveSessionStreamText('session-a', 'B-chrome', 'session-b')).toBe('A-only');
  });

  it('resolveSessionStreamReasoning: background A must not read B streamingReasoning', () => {
    expect(resolveSessionStreamReasoning('session-a', 'B-reason', 'session-b')).toBe('');
    expect(resolveSessionStreamReasoning('session-b', 'B-reason', 'session-b')).toBe('B-reason');
  });

  it('appendStreamingBuffer seeds from fallback only when session buffer empty', () => {
    expect(appendStreamingBuffer('session-a', 'x', 'chrome-seed')).toBe('chrome-seedx');
    expect(appendStreamingBuffer('session-a', 'y', 'ignored-chrome')).toBe('chrome-seedxy');
    // Other session still empty / independent
    expect(getStreamingBuffer('session-b')).toBe('');
    expect(appendStreamingBuffer('session-b', 'z', 'b-chrome')).toBe('b-chromez');
    expect(getStreamingBuffer('session-a')).toBe('chrome-seedxy');
  });
});
