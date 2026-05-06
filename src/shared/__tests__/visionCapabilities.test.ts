import { describe, expect, it } from '@jest/globals';
import {
  lookupVisionCapability,
  supportsVision,
  VISION_CAPABILITY_REGISTRY,
} from '../visionCapabilities';

describe('visionCapabilities', () => {
  it('recognizes first-party vision models', () => {
    expect(supportsVision('anthropic', 'claude-3-7-sonnet-20250219')).toBe(true);
    expect(supportsVision('openai', 'gpt-4o')).toBe(true);
  });

  it('treats current MiniMax and DeepSeek entries as text-only', () => {
    expect(supportsVision('minimax', 'MiniMax-M2.7')).toBe(false);
    expect(supportsVision('deepseek', 'deepseek-chat')).toBe(false);
  });

  it('allows openai-compatible vision models without enabling all compatible models', () => {
    expect(supportsVision('openai-compatible', 'gpt-4o-mini')).toBe(true);
    expect(supportsVision('openai-compatible', 'deepseek-chat')).toBe(false);
  });

  it('returns the matched capability metadata', () => {
    const capability = lookupVisionCapability('openai', 'gpt-4.1');

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
