import { describe, expect, it } from '@jest/globals';

import { coerceRenderableText, normalizeSelectOption } from '../coerceRenderableText';

describe('coerceRenderableText', () => {
  it('returns strings unchanged', () => {
    expect(coerceRenderableText('hello')).toBe('hello');
  });

  it('extracts label from option objects', () => {
    expect(coerceRenderableText({ label: 'Option A', description: 'More detail' })).toBe('Option A');
  });

  it('falls back to description when label is missing', () => {
    expect(coerceRenderableText({ description: 'More detail' })).toBe('More detail');
  });
});

describe('normalizeSelectOption', () => {
  it('preserves plain string options', () => {
    expect(normalizeSelectOption('English')).toBe('English');
  });

  it('normalizes structured select options', () => {
    expect(normalizeSelectOption({ label: 'English', description: 'EN locale' })).toBe('English');
  });
});