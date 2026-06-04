/**
 * Self-Improve Mode — Schema v2
 *
 * Adds structured issue/patch/verification/decision/workspace sections
 * for the AutoResearch Harness v1. v1 results are accepted and
 * normalized to v2 via `normalizeToV2`.
 *
 * The harness layer (scripts/autoresearch-exec.mjs) writes v2 directly.
 * The agent prompt for self-improve mode now documents v2 fields.
 * Existing v1 result files in the run directory continue to parse.
 */

import { z } from 'zod';
import {
  SelfImproveResultSchema as V1Schema,
  parseSelfImproveResult as parseV1,
  type SelfImproveResult as V1Result,
} from './schema';

// ─── v2 Types ────────────────────────────────────────────────────────────────

export type SelfImproveCategory =
  | 'build'
  | 'test'
  | 'typecheck'
  | 'lint'
  | 'security'
  | 'performance'
  | 'docs'
  | 'refactor'
  | 'bugfix'
  | 'other';

export type SelfImproveSeverity = 'info' | 'minor' | 'major' | 'critical';

export type VerificationStatus = 'pass' | 'fail' | 'skipped' | 'timeout';

export interface SelfImproveIssueV2 {
  summary: string;
  evidence: string[];
  category: SelfImproveCategory;
  severity: SelfImproveSeverity;
}

export interface SelfImprovePatchV2 {
  diffPath: string;
  addedLines: number;
  deletedLines: number;
  reverted: boolean;
}

export interface SelfImproveVerificationEntryV2 {
  command: string;
  exitCode: number | null;
  durationMs: number | null;
  status: VerificationStatus;
  stdoutPath: string | null;
  stderrPath: string | null;
}

export interface SelfImproveWorkspaceV2 {
  dirtyBefore: boolean;
  dirtyAfter: boolean;
}

export interface SelfImproveDecisionV2 {
  status: 'IMPROVED' | 'NO_CHANGE' | 'FAILED' | 'NEEDS_REVIEW';
  score: number;
  nextRecommendation: string;
}

export interface SelfImproveResultV2 {
  schemaVersion: 2;
  mode: 'repo_self_improve';
  iteration: number;
  /** v1 phase results are kept for backward compatibility. */
  phaseResults: Record<string, { phase: string; success: boolean; output?: string; durationMs?: number }>;
  changedFiles: string[];
  commandsRun: string[];
  buildPassed: boolean | null;
  testsPassed: boolean | null;
  typecheckPassed: boolean | null;
  riskLevel: 'low' | 'medium' | 'high';
  status: 'IMPROVED' | 'NO_CHANGE' | 'FAILED' | 'NEEDS_REVIEW';
  summary: string;
  nextRecommendation: string;
  /** v2-only fields. */
  issue?: SelfImproveIssueV2;
  patch?: SelfImprovePatchV2;
  verification?: SelfImproveVerificationEntryV2[];
  workspace?: SelfImproveWorkspaceV2;
  decision?: SelfImproveDecisionV2;
}

// ─── v2 Zod Schemas ──────────────────────────────────────────────────────────

const SelfImproveCategorySchema = z.enum([
  'build', 'test', 'typecheck', 'lint', 'security',
  'performance', 'docs', 'refactor', 'bugfix', 'other',
]);
const SelfImproveSeveritySchema = z.enum(['info', 'minor', 'major', 'critical']);
const VerificationStatusSchema = z.enum(['pass', 'fail', 'skipped', 'timeout']);

const SelfImproveIssueV2Schema = z.object({
  summary: z.string().min(1),
  evidence: z.array(z.string()),
  category: SelfImproveCategorySchema,
  severity: SelfImproveSeveritySchema,
}).strict();

const SelfImprovePatchV2Schema = z.object({
  diffPath: z.string(),
  addedLines: z.number().int().nonnegative(),
  deletedLines: z.number().int().nonnegative(),
  reverted: z.boolean(),
}).strict();

const SelfImproveVerificationEntryV2Schema = z.object({
  command: z.string().min(1),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  status: VerificationStatusSchema,
  stdoutPath: z.string().nullable(),
  stderrPath: z.string().nullable(),
}).strict();

const SelfImproveWorkspaceV2Schema = z.object({
  dirtyBefore: z.boolean(),
  dirtyAfter: z.boolean(),
}).strict();

const SelfImproveDecisionV2Schema = z.object({
  status: z.enum(['IMPROVED', 'NO_CHANGE', 'FAILED', 'NEEDS_REVIEW']),
  score: z.number(),
  nextRecommendation: z.string(),
}).strict();

const SelfImprovePhaseResultSchema = z.object({
  phase: z.string().min(1),
  success: z.boolean(),
  output: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
}).strict();

export const SelfImproveResultV2Schema = z.object({
  schemaVersion: z.literal(2),
  mode: z.literal('repo_self_improve'),
  iteration: z.number().int().nonnegative(),
  phaseResults: z.record(SelfImprovePhaseResultSchema),
  changedFiles: z.array(z.string()),
  commandsRun: z.array(z.string()),
  buildPassed: z.boolean().nullable(),
  testsPassed: z.boolean().nullable(),
  typecheckPassed: z.boolean().nullable(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  status: z.enum(['IMPROVED', 'NO_CHANGE', 'FAILED', 'NEEDS_REVIEW']),
  summary: z.string().min(1),
  nextRecommendation: z.string(),
  issue: SelfImproveIssueV2Schema.optional(),
  patch: SelfImprovePatchV2Schema.optional(),
  verification: z.array(SelfImproveVerificationEntryV2Schema).optional(),
  workspace: SelfImproveWorkspaceV2Schema.optional(),
  decision: SelfImproveDecisionV2Schema.optional(),
});

// ─── v1 → v2 Normalization ───────────────────────────────────────────────────

export function normalizeV1ToV2(v1: V1Result): SelfImproveResultV2 {
  return {
    schemaVersion: 2,
    mode: 'repo_self_improve',
    iteration: v1.iteration,
    phaseResults: v1.phaseResults,
    changedFiles: v1.changedFiles,
    commandsRun: v1.commandsRun,
    buildPassed: v1.buildPassed,
    testsPassed: v1.testsPassed,
    typecheckPassed: v1.typecheckPassed,
    riskLevel: v1.riskLevel,
    status: v1.status,
    summary: v1.summary,
    nextRecommendation: v1.nextRecommendation,
    issue: {
      summary: v1.summary,
      evidence: v1.phaseResults['AUDIT']?.output
        ? [v1.phaseResults['AUDIT'].output as string].filter(Boolean)
        : [],
      category: inferCategory(v1),
      severity: v1.riskLevel === 'high' ? 'major' : v1.riskLevel === 'medium' ? 'minor' : 'info',
    },
    workspace: {
      dirtyBefore: false,
      dirtyAfter: v1.changedFiles.length > 0,
    },
  };
}

function inferCategory(v1: V1Result): SelfImproveCategory {
  if (v1.buildPassed === false) return 'build';
  if (v1.typecheckPassed === false) return 'typecheck';
  if (v1.testsPassed === false) return 'test';
  if (/lint|hygiene/i.test(v1.summary)) return 'lint';
  if (/doc/i.test(v1.summary)) return 'docs';
  if (/perf|optimi[sz]e/i.test(v1.summary)) return 'performance';
  if (/refactor|cleanup/i.test(v1.summary)) return 'refactor';
  if (/secur|password|secret|token/i.test(v1.summary)) return 'security';
  return 'other';
}

// ─── v2 Parser (with v1 fallback) ─────────────────────────────────────────────

function extractBalancedJsonObjects(text: string): string[] {
  const matches: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        matches.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return matches;
}

export interface ParseV2Result {
  result: SelfImproveResultV2;
  sourceSchema: 1 | 2;
  /** If the result was upgraded from v1, the original v1 object. */
  originalV1?: V1Result;
}

export function parseSelfImproveResultV2(text: string): ParseV2Result | null {
  const fencedBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1])
    .filter((block): block is string => typeof block === 'string' && block.includes('{'));

  const candidates: string[] = [];
  for (const block of fencedBlocks) candidates.push(...extractBalancedJsonObjects(block));
  candidates.push(...extractBalancedJsonObjects(text));

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]?.trim();
    if (!candidate) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(candidate); } catch { continue; }
    if (!parsed || typeof parsed !== 'object') continue;

    const obj = parsed as Record<string, unknown>;
    if (obj.schemaVersion === 2) {
      const result = SelfImproveResultV2Schema.safeParse(parsed);
      if (result.success) {
        return { result: result.data, sourceSchema: 2 };
      }
    } else if (obj.schemaVersion === 1) {
      const v1 = V1Schema.safeParse(parsed);
      if (v1.success) {
        return {
          result: normalizeV1ToV2(v1.data),
          sourceSchema: 1,
          originalV1: v1.data,
        };
      }
    }
  }
  return null;
}

/**
 * Try v2 first, then fall back to v1. Always returns the highest available
 * representation. Returns null if nothing parses.
 */
export function parseSelfImproveResultAny(text: string): SelfImproveResultV2 | null {
  const v2 = parseSelfImproveResultV2(text);
  if (v2) return v2.result;
  const v1 = parseV1(text);
  if (v1) return normalizeV1ToV2(v1);
  return null;
}
