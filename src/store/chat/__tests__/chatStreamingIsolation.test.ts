import { describe, expect, it } from '@jest/globals';

import {
  clearChatGenerationCancel,
  consumeChatGenerationCancel,
  requestChatGenerationCancel,
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
});