import { describe, expect, it } from '@jest/globals';

import { extractErrorDetails, formatError } from '../errorFormat';

describe('errorFormat', () => {
  it('formats Error instances', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('formats string errors', () => {
    expect(formatError('boom')).toBe('boom');
  });

  it('stringifies plain object errors instead of returning [object Object]', () => {
    expect(formatError({ error: { message: 'auth failed' } })).toBe('{"error":{"message":"auth failed"}}');
  });

  it('handles circular objects without crashing or returning [object Object]', () => {
    const circular: Record<string, unknown> = { message: 'loop' };
    circular.self = circular;

    const formatted = formatError(circular);
    expect(formatted).toContain('"message":"loop"');
    expect(formatted).not.toBe('[object Object]');
  });

  it('extracts structured API error details', () => {
    expect(extractErrorDetails({
      error: { message: 'login fail', http_code: '401' },
      request_id: 'req-1',
    })).toEqual({
      message: 'login fail',
      httpCode: '401',
      requestId: 'req-1',
    });
  });
});
