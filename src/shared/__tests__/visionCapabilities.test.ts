import { describe, expect, it } from '@jest/globals';
import {
  lookupVisionCapability,
  supportsVision,
  VISION_CAPABILITY_REGISTRY,
} from '../visionCapabilities';

describe('visionCapabilities', () => {
  it('recognizes first-party vision models', () => {
    expect(supportsVision('anthropic', 'claude-fable-5')).toBe(true);
    expect(supportsVision('openai', 'gpt-5.5')).toBe(true);
  });

  it('treats MiniMax M-series as vision-capable and DeepSeek entries as text-only', () => {
    expect(supportsVision('minimax', 'MiniMax-M3')).toBe(true);
    expect(supportsVision('minimax', 'MiniMax-K')).toBe(false);
    expect(supportsVision('deepseek', 'deepseek-chat')).toBe(false);
  });

  it('allows openai-compatible vision models without enabling all compatible models', () => {
    expect(supportsVision('openai-compatible', 'gpt-5.4-mini')).toBe(true);
    expect(supportsVision('openai-compatible', 'deepseek-chat')).toBe(false);
  });

  it('returns the matched capability metadata', () => {
    const capability = lookupVisionCapability('openai', 'gpt-5.4');

    expect(capability).not.toBeNull();
    expect(capability?.supportsVision).toBe(true);
    expect(capability?.encoding).toContain('base64');
  });

  it('returns null for unknown provider-model pairs', () => {
    expect(lookupVisionCapability('anthropic', 'unknown-model')).toBeNull();
  });

  it('keeps registry scoped to currently wired frontend providers', () => {
    const providerIds = new Set(VISION_CAPABILITY_REGISTRY.map((entry) => entry.providerId));

    expect(providerIds.has('gemini')).toBe(false);
  });
});
