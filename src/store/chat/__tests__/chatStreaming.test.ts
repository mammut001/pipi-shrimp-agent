import { describe, expect, it } from '@jest/globals';
import {
  resolveStreamingOwnerSessionId,
  shouldFlushStreamingUpdate,
  STREAMING_TIMEOUT_MS,
  STREAMING_UI_THROTTLE_MS,
} from '../chatStreaming';

describe('chatStreaming', () => {
  it('keeps timeout and UI throttle constants explicit', () => {
    expect(STREAMING_TIMEOUT_MS).toBe(300_000);
    expect(STREAMING_UI_THROTTLE_MS).toBe(100);
  });

  it('decides when streaming content should flush to the UI', () => {
    expect(shouldFlushStreamingUpdate(1100, 1000)).toBe(true);
    expect(shouldFlushStreamingUpdate(1099, 1000)).toBe(false);
  });

  it('prefers the streaming owner session over the current UI session', () => {
    expect(resolveStreamingOwnerSessionId('streaming-session', 'current-session')).toBe('streaming-session');
    expect(resolveStreamingOwnerSessionId(null, 'current-session')).toBe('current-session');
    expect(resolveStreamingOwnerSessionId(null, null)).toBeNull();
  });
});
