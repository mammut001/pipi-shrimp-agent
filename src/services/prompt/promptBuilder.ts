/**
 * Prompt Builder
 *
 * Builds system prompts from template sections with:
 * - Per-section caching (localStorage)
 * - {{variable}} interpolation
 * - Token estimation
 * - Export to JSON
 *
 * Mirrors Claude Code's systemPromptSection() + DANGEROUS_uncachedSystemPromptSection()
 */

import type { PromptSection, PromptBuildResult, PromptSectionTokenInfo } from '../../types/prompt';

const PROMPT_CACHE_KEY = 'pipi-shrimp-prompt-section-cache';

interface CachedSection {
  cacheKey: string;
  content: string;
}

function getCache(): Record<string, CachedSection> {
  try {
    return JSON.parse(localStorage.getItem(PROMPT_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function setCache(cache: Record<string, CachedSection>) {
  try {
    localStorage.setItem(PROMPT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    console.warn('[PromptBuilder] Failed to persist prompt cache');
  }
}

/**
 * Estimate tokens in a text string.
 * Uses a simple heuristic: ~4 chars per token for English, ~1.5 chars for CJK.
 */
function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let ascii = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x2E80 && code < 0x9FFF) {
      cjk++;
    } else {
      ascii++;
    }
  }
  return Math.ceil(cjk / 1.5) + Math.ceil(ascii / 4);
}

/**
 * Interpolate {{variable}} placeholders in a template string.
 */
function interpolate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => context[key] ?? '');
}

/**
 * Compute a cache key for a section based on its content and context dependencies.
 */
function computeCacheKey(section: PromptSection, context: Record<string, string>): string {
  const deps = Object.keys(context).sort().map(k => `${k}=${context[k]}`).join('&');
  return `${section.id}:${section.content.length}:${deps}`;
}

/**
 * Build a system prompt from template sections.
 *
 * Caching strategy:
 * - cacheable=true: check cacheKey, reuse if unchanged
 * - cacheable=false: always recompute
 * - cacheKey = section.id + content hash + context dependency values
 */
export function buildPrompt(
  sections: PromptSection[],
  context: Record<string, string> = {},
): PromptBuildResult {
  const cache = getCache();
  let cacheHits = 0;
  let cacheMisses = 0;

  const resolvedSections = sections
    .filter(s => s.enabled)
    .map(section => {
      if (!section.cacheable) {
        cacheMisses++;
        return { ...section, content: interpolate(section.content, context) };
      }

      const currentKey = computeCacheKey(section, context);
      const cached = cache[section.id];

      if (cached && cached.cacheKey === currentKey) {
        cacheHits++;
        return { ...section, content: cached.content };
      }

      cacheMisses++;
      const resolved = interpolate(section.content, context);
      cache[section.id] = { cacheKey: currentKey, content: resolved };
      return { ...section, content: resolved };
    });

  setCache(cache);

  const sorted = resolvedSections.sort((a, b) => a.order - b.order);
  const systemPrompt = sorted.map(s => s.content).filter(Boolean).join('\n\n');
  const tokenEstimate = estimateTextTokens(systemPrompt);

  return {
    systemPrompt,
    sections: sorted,
    tokenEstimate,
    cacheHits,
    cacheMisses,
  };
}

/**
 * Get per-section token breakdown for analysis display.
 */
export function getSectionTokenInfo(sections: PromptSection[]): PromptSectionTokenInfo[] {
  const enabledSections = sections.filter(s => s.enabled);
  const totalTokens = enabledSections.reduce((sum, s) => sum + estimateTextTokens(s.content), 0);
  return enabledSections.map(s => ({
    sectionId: s.id,
    label: s.label,
    tokens: estimateTextTokens(s.content),
    percentage: totalTokens > 0 ? (estimateTextTokens(s.content) / totalTokens) * 100 : 0,
  }));
}

/**
 * Export prompt sections to JSON (for audit/debug).
 */
export function exportPrompt(sections: PromptSection[]): string {
  return JSON.stringify(sections, null, 2);
}
