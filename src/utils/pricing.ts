/**
 * Pricing utilities for cost estimation
 */

import { type ModelPricing } from '../types/settings';
import { resolvePricing } from '../shared/providers';

/**
 * Calculate cost for a given number of tokens
 * @param tokens - Number of tokens
 * @param pricePerMillion - Price per million tokens
 * @returns Cost in USD
 */
export function calculateTokenCost(tokens: number, pricePerMillion: number): number {
  return (tokens / 1_000_000) * pricePerMillion;
}

/**
 * Per-bucket cost breakdown for a single request.
 *
 * Mirrors ccswitch's 4-bucket model: input / output / cache_read /
 * cache_create, plus a derived `savedByCache` that quantifies how much
 * the prompt cache saved vs. paying full input price.
 */
export interface RequestCostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
  /**
   * Cache_read tokens that would have cost `inputPrice` but cost
   * `cacheReadPrice` instead — i.e. inputPrice - cacheReadPrice per token.
   * Always >= 0.
   */
  savedByCache: number;
}

/**
 * Calculate the cost of a single token bucket, with a 1.25x fallback
 * for cache_write when the registry didn't specify `cacheWritePrice`.
 * Matches ccswitch's `cache_create_rate = inputPrice * 1.25` rule.
 */
function bucketCost(tokens: number, pricePerMillion: number | undefined, fallback: number): number {
  const rate = pricePerMillion ?? fallback;
  return calculateTokenCost(tokens, rate);
}

/**
 * Calculate total cost for a request based on token usage.
 *
 * 4-bucket aware: if the caller omits the cache fields, this behaves
 * identically to the legacy 2-bucket version.
 */
export function calculateRequestCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
): number {
  return calculateRequestCostDetailed(inputTokens, outputTokens, pricing, cacheReadTokens, cacheWriteTokens).totalCost;
}

/**
 * Cost breakdown for a request — input / output / cache_read /
 * cache_create priced independently. Use this from the UI to surface
 * the per-bucket cards and the green "saved by cache" pill.
 */
export function calculateRequestCostDetailed(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
): RequestCostBreakdown {
  const inputCost = calculateTokenCost(inputTokens, pricing.inputPrice);
  const outputCost = calculateTokenCost(outputTokens, pricing.outputPrice);
  const cacheReadCost = bucketCost(cacheReadTokens, pricing.cacheReadPrice, 0);
  // 1.25x of input is Anthropic's documented cache write surcharge; the
  // registry can override with `cacheWritePrice` (e.g. 3.75 for Sonnet).
  const cacheWriteCost = bucketCost(cacheWriteTokens, pricing.cacheWritePrice, pricing.inputPrice * 1.25);
  // Saving = tokens that would have been charged at full input price but
  // were billed at the cache rate instead. Only meaningful when
  // cacheReadPrice < inputPrice (the Anthropic case).
  const effectiveCacheReadPrice = pricing.cacheReadPrice ?? 0;
  const savedByCache = Math.max(0, pricing.inputPrice - effectiveCacheReadPrice) * cacheReadTokens / 1_000_000;
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    savedByCache,
  };
}

/**
 * Calculate cost breakdown for a request
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param pricing - Model pricing configuration
 * @returns Cost breakdown object
 */
export function calculateCostBreakdown(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing
): {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  costPer1KInput: number;
  costPer1KOutput: number;
} {
  const inputCost = calculateTokenCost(inputTokens, pricing.inputPrice);
  const outputCost = calculateTokenCost(outputTokens, pricing.outputPrice);

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    costPer1KInput: pricing.inputPrice / 1000,
    costPer1KOutput: pricing.outputPrice / 1000,
  };
}

/**
 * Get default pricing for a model
 * @param model - Model name
 * @returns Pricing configuration or null if not found
 */
export function getDefaultPricing(model: string): ModelPricing | null {
  const pricing = resolvePricing(model);
  if (!pricing) return null;
  return { model, ...pricing } as ModelPricing;
}

/**
 * Format cost for display
 * @param cost - Cost in USD
 * @returns Formatted cost string
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.0001) return '<$0.0001';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Format cost for compact display (e.g., in status bars)
 * @param cost - Cost in USD
 * @returns Compact formatted cost string
 */
export function formatCostCompact(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Estimate token count from text
 * Uses a rough approximation: ~4 characters per token for English, ~2 for Chinese
 * @param text - Input text
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  // Rough approximation: average 4 chars per token for mixed text
  // Chinese characters are roughly 2 per token
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;

  // Chinese: ~2 chars per token, others: ~4 chars per token
  return Math.ceil((otherChars / 4) + (chineseChars / 2));
}

/**
 * Calculate context usage percentage
 * @param tokens - Current token count
 * @param contextWindow - Model's context window size
 * @returns Usage percentage (0-100)
 */
export function calculateContextUsage(tokens: number, contextWindow: number): number {
  if (contextWindow === 0) return 0;
  return Math.min(100, Math.round((tokens / contextWindow) * 100));
}

/**
 * Format context usage for display
 * @param tokens - Current token count
 * @param contextWindow - Model's context window size
 * @returns Formatted context usage string
 */
export function formatContextUsage(tokens: number, contextWindow: number): string {
  const usage = calculateContextUsage(tokens, contextWindow);
  const formattedWindow = contextWindow >= 1000
    ? `${(contextWindow / 1000).toFixed(0)}K`
    : contextWindow.toString();

  return `${usage}% / ${formattedWindow}`;
}
