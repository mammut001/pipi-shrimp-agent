import { describe, expect, it } from '@jest/globals';
import { formatError } from '../errors';

describe('formatError', () => {
  it('stringifies plain objects instead of returning [object Object]', () => {
    expect(formatError({ code: 'ENOENT', detail: 'missing file' })).toBe('{"code":"ENOENT","detail":"missing file"}');
  });
});
