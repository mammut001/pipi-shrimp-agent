import { describe, expect, it } from '@jest/globals';

import { normalizeBrowserScreenshotSrc, normalizeScreenshotSrc } from '@/utils/screenshot';

describe('screenshot utilities', () => {
  it('converts raw base64 payloads into data URLs', () => {
    const result = normalizeScreenshotSrc('A'.repeat(64));

    expect(result).toBe(`data:image/png;base64,${'A'.repeat(64)}`);
  });

  it('accepts existing image data URLs', () => {
    const result = normalizeScreenshotSrc('data:image/png;base64,AAAA');

    expect(result).toBe('data:image/png;base64,AAAA');
  });

  it('rejects empty or invalid screenshot values', () => {
    expect(normalizeScreenshotSrc('')).toBeNull();
    expect(normalizeScreenshotSrc('broken-screenshot')).toBeNull();
  });

  it('normalizes browser screenshot refs', () => {
    const result = normalizeBrowserScreenshotSrc({
      kind: 'base64_png',
      value: 'A'.repeat(64),
    });

    expect(result).toBe(`data:image/png;base64,${'A'.repeat(64)}`);
  });
});