import { afterEach, describe, expect, it } from '@jest/globals';
import {
  resolvePricing,
  resolveRemoteModelPrice,
  setRemotePricingTable,
  type RemotePricingTable,
} from '..';

const TABLE: RemotePricingTable = {
  _meta: {
    source: 'openrouter/api/v1/models',
    updated_at: '2026-09-23 20:34:28+0800',
    count: 6,
    active_count: 5,
    retained_count: 1,
  },
  models: {
    'anthropic/claude-haiku-4.5': {
      in: 1, out: 5, cache_read: 0.1, cache_write: 1.25,
      canonical_slug: 'anthropic/claude-4.5-haiku-20251001',
    },
    'anthropic/claude-opus-4.8': { in: 5, out: 25, cache_read: 0.5, cache_write: 6.25 },
    'anthropic/claude-3.5-sonnet': { in: 3, out: 15, retired: true },
    'deepseek/deepseek-v4-flash': { in: 0.088606, out: 0.177212, context_length: 1_000_000 },
    'minimax/minimax-m3': { in: 0.3, out: 1.2 },
    'meta/muse-spark-1.1': { in: 0.5, out: 2 },
  },
};

const resolvedId = (model: string) => resolveRemoteModelPrice(model)?.id ?? null;

describe('remote pricing resolution', () => {
  afterEach(() => setRemotePricingTable(null));

  it('has no remote price before the backend table loads', () => {
    expect(resolvedId('anthropic/claude-haiku-4.5')).toBeNull();
  });

  it('maps provider model names to OpenRouter ids', () => {
    setRemotePricingTable(TABLE);

    expect(resolvedId('anthropic/claude-haiku-4.5')).toBe('anthropic/claude-haiku-4.5');
    // Anthropic API ids: dashed versions, dated snapshots, -latest aliases.
    expect(resolvedId('claude-haiku-4-5')).toBe('anthropic/claude-haiku-4.5');
    expect(resolvedId('claude-haiku-4-5-20251001')).toBe('anthropic/claude-haiku-4.5');
    expect(resolvedId('claude-opus-4-8')).toBe('anthropic/claude-opus-4.8');
    expect(resolvedId('claude-3-5-sonnet-latest')).toBe('anthropic/claude-3.5-sonnet');
    // canonical slugs, bare names, case, gateway prefixes, :free tiers.
    expect(resolvedId('anthropic/claude-4.5-haiku-20251001')).toBe('anthropic/claude-haiku-4.5');
    expect(resolvedId('deepseek-v4-flash')).toBe('deepseek/deepseek-v4-flash');
    expect(resolvedId('MiniMax-M3')).toBe('minimax/minimax-m3');
    expect(resolvedId('vercel/meta/muse-spark-1.1')).toBe('meta/muse-spark-1.1');
    expect(resolvedId('deepseek/deepseek-v4-flash:free')).toBe('deepseek/deepseek-v4-flash');
  });

  it('returns nothing for unknown models instead of guessing a price', () => {
    setRemotePricingTable(TABLE);
    expect(resolvedId('claude-sonnet-9')).toBeNull();
    expect(resolvedId('totally-unknown-model')).toBeNull();
    expect(resolvedId('')).toBeNull();
  });
});

describe('resolvePricing with a remote table', () => {
  afterEach(() => setRemotePricingTable(null));

  it('prefers the OpenRouter price and keeps registry limits', () => {
    const offline = resolvePricing('claude-opus-4-8', 'anthropic');
    setRemotePricingTable(TABLE);
    const pricing = resolvePricing('claude-opus-4-8', 'anthropic');

    expect(pricing).toMatchObject({
      inputPrice: 5,
      outputPrice: 25,
      cacheReadPrice: 0.5,
      cacheWritePrice: 6.25,
    });
    expect(pricing?.contextWindow).toBe(offline?.contextWindow);
  });

  it('prices fetched models the registry does not know', () => {
    expect(resolvePricing('claude-haiku-4-5-20251001', 'anthropic')).toBeNull();
    setRemotePricingTable(TABLE);

    expect(resolvePricing('claude-haiku-4-5-20251001', 'anthropic')).toMatchObject({
      inputPrice: 1,
      outputPrice: 5,
    });
    expect(resolvePricing('deepseek/deepseek-v4-flash', 'commandcode')).toMatchObject({
      inputPrice: 0.088606,
      contextWindow: 1_000_000,
    });
  });

  it('falls back to the registry when the model is not in the table', () => {
    setRemotePricingTable(TABLE);
    expect(resolvePricing('gpt-4o', 'openai')).toMatchObject({ inputPrice: 2.5, outputPrice: 10 });
  });
});
