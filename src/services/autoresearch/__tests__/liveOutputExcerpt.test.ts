import { describe, expect, it } from '@jest/globals';
import { clipLiveOutputExcerptInMemory, redactLiveOutputExcerptForStorage } from '../history';

const MAX = 20_000;
const SECRET = 'sk-live-SECRET123';

function persistedExcerpt(output: string): string {
  return redactLiveOutputExcerptForStorage(clipLiveOutputExcerptInMemory(output));
}

function filler(length: number): string {
  return `${'x'.repeat(99)}\n`.repeat(Math.ceil(length / 100)).slice(0, length);
}

describe('live output excerpt clipping + persist-time redaction', () => {
  it('passes short output through unchanged', () => {
    expect(clipLiveOutputExcerptInMemory('hello\nworld')).toBe('hello\nworld');
  });

  it('does not leak a secret whose label is cut off by the 20k clip', () => {
    const secretLine = `OPENAI_API_KEY=${SECRET}\n`;
    const fromKey = secretLine.slice(secretLine.indexOf('KEY='));
    // Place the cut so the clipped tail starts at "KEY=sk-live-..." — the
    // "API_" part of the label falls outside the excerpt.
    const output = filler(5_000) + secretLine + filler(MAX - fromKey.length);

    expect(output.slice(-MAX).startsWith('KEY=')).toBe(true);
    const stored = persistedExcerpt(output);
    expect(stored).not.toContain(SECRET);
    expect(stored.length).toBeLessThanOrEqual(MAX);
  });

  it('keeps whole lines after the cut', () => {
    const output = filler(MAX + 5_000) + 'final metric: 0.93\n';
    const clipped = clipLiveOutputExcerptInMemory(output);
    expect(clipped.endsWith('final metric: 0.93\n')).toBe(true);
    expect(clipped.startsWith('x'.repeat(99))).toBe(true);
  });

  it('redacts a cut secret even when the output is one giant line', () => {
    const output = `${'y'.repeat(5_000)} OPENAI_API_KEY=${SECRET} ${'z'.repeat(MAX - 20)}`;
    expect(output.slice(-MAX)).not.toContain('OPENAI_API_KEY');
    const stored = persistedExcerpt(output);
    expect(stored).not.toContain(SECRET);
    expect(stored.length).toBeLessThanOrEqual(MAX);
  });
});
