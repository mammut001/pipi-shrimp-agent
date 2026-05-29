/**
 * Self-Improve Mode — Schema & Types
 *
 * Defines the structured result artifact for repo self-improve iterations.
 * Unlike ML experiment mode (which tracks a single scalar metric),
 * self-improve mode evaluates build/test/typecheck/hygiene signals.
 */

import { z } from 'zod';

// ─── Status & Risk ──────────────────────────────────────────────────────────

export type SelfImproveStatus = 'IMPROVED' | 'NO_CHANGE' | 'FAILED' | 'NEEDS_REVIEW';
export type SelfImproveRiskLevel = 'low' | 'medium' | 'high';

// ─── Phase Results ──────────────────────────────────────────────────────────

export interface SelfImprovePhaseResult {
  phase: string;
  success: boolean;
  output?: string;
  durationMs?: number;
}

// ─── Structured Result Artifact ─────────────────────────────────────────────

export interface SelfImproveResult {
  schemaVersion: 1;
  mode: 'repo_self_improve';
  iteration: number;
  phaseResults: Record<string, SelfImprovePhaseResult>;
  changedFiles: string[];
  commandsRun: string[];
  buildPassed: boolean | null;
  testsPassed: boolean | null;
  typecheckPassed: boolean | null;
  riskLevel: SelfImproveRiskLevel;
  status: SelfImproveStatus;
  summary: string;
  nextRecommendation: string;
}

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const SelfImproveStatusSchema = z.enum(['IMPROVED', 'NO_CHANGE', 'FAILED', 'NEEDS_REVIEW']);
const SelfImproveRiskLevelSchema = z.enum(['low', 'medium', 'high']);

const SelfImprovePhaseResultSchema = z.object({
  phase: z.string().min(1),
  success: z.boolean(),
  output: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
}).strict();

export const SelfImproveResultSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal('repo_self_improve'),
  iteration: z.number().int().nonnegative(),
  phaseResults: z.record(SelfImprovePhaseResultSchema),
  changedFiles: z.array(z.string()),
  commandsRun: z.array(z.string()),
  buildPassed: z.boolean().nullable(),
  testsPassed: z.boolean().nullable(),
  typecheckPassed: z.boolean().nullable(),
  riskLevel: SelfImproveRiskLevelSchema,
  status: SelfImproveStatusSchema,
  summary: z.string().min(1),
  nextRecommendation: z.string(),
}) satisfies z.ZodType<SelfImproveResult>;

// ─── Parsing Helpers ────────────────────────────────────────────────────────

function extractBalancedJsonObjects(text: string): string[] {
  const matches: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        matches.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return matches;
}

/**
 * Parse a SelfImproveResult from agent output text.
 *
 * Searches for JSON objects matching the schema in:
 * 1. Fenced code blocks (```json ... ```)
 * 2. Plain JSON objects in the text
 *
 * Returns the last valid match (agent typically writes the final result last).
 */
export function parseSelfImproveResult(text: string): SelfImproveResult | null {
  // Try fenced code blocks first
  const fencedBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1])
    .filter((block): block is string => typeof block === 'string' && block.includes('{'));

  const candidates: string[] = [];
  for (const block of fencedBlocks) {
    candidates.push(...extractBalancedJsonObjects(block));
  }
  // Also try plain JSON objects in the full text
  candidates.push(...extractBalancedJsonObjects(text));

  // Search from last to first (final result is most authoritative)
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]?.trim();
    if (!candidate) continue;

    try {
      const parsed = JSON.parse(candidate);
      const result = SelfImproveResultSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return null;
}

// ─── Mapping to ML Experiment Types ─────────────────────────────────────────

/**
 * Map a SelfImproveStatus to the ML experiment status used by the store.
 * This allows self-improve results to be stored in the same ExperimentEntry format.
 */
export function mapSelfImproveStatusToExperimentStatus(
  status: SelfImproveStatus,
): 'IMPROVED' | 'NOT_IMPROVED' | 'FAILED' {
  switch (status) {
    case 'IMPROVED':
      return 'IMPROVED';
    case 'NO_CHANGE':
      return 'NOT_IMPROVED';
    case 'FAILED':
    case 'NEEDS_REVIEW':
      return 'FAILED';
  }
}

/**
 * Build a synthetic metric value from self-improve signals for the store.
 * Returns a 0-1 score that can be tracked over iterations.
 */
export function buildSelfImproveMetricValue(result: SelfImproveResult): number | null {
  if (result.status === 'FAILED') return null;

  let score = 0;
  let maxScore = 0;

  if (result.buildPassed !== null) {
    maxScore += 1;
    if (result.buildPassed) score += 1;
  }
  if (result.testsPassed !== null) {
    maxScore += 1;
    if (result.testsPassed) score += 1;
  }
  if (result.typecheckPassed !== null) {
    maxScore += 1;
    if (result.typecheckPassed) score += 1;
  }

  return maxScore > 0 ? score / maxScore : null;
}
