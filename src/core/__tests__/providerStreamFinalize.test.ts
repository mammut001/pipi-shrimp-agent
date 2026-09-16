import { describe, expect, it } from '@jest/globals';
import {
  appendTruncatedReplyNotice,
  isTruncatedProviderResponse,
  PROVIDER_STREAM_TRUNCATED_NOTICE,
} from '../providerStreamFinalize';

describe('providerStreamFinalize', () => {
  it('detects truncated provider finalize metadata', () => {
    expect(isTruncatedProviderResponse({ truncated: true })).toBe(true);
    expect(isTruncatedProviderResponse({ finish_reason: 'length' })).toBe(true);
    expect(isTruncatedProviderResponse({ stop_reason: 'content_filter' })).toBe(true);
    expect(isTruncatedProviderResponse({ finish_reason: 'stop' })).toBe(false);
    expect(isTruncatedProviderResponse({ truncated: false, finish_reason: 'done' })).toBe(false);
    expect(isTruncatedProviderResponse(undefined)).toBe(false);
  });

  it('appends a clear truncated-reply notice exactly once', () => {
    const once = appendTruncatedReplyNotice('ping');
    expect(once).toBe(`ping${PROVIDER_STREAM_TRUNCATED_NOTICE}`);
    expect(appendTruncatedReplyNotice(once)).toBe(once);
    expect(appendTruncatedReplyNotice('   ')).toBe('   ');
  });
});
