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
 * Calculate total cost for a request based on token usage
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param pricing - Model pricing configuration
 * @returns Total cost in USD
 */
export function calculateRequestCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing
): number {
  const inputCost = calculateTokenCost(inputTokens, pricing.inputPrice);
  const outputCost = calculateTokenCost(outputTokens, pricing.outputPrice);
  return inputCost + outputCost;
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
