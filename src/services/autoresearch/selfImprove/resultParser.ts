/**
 * Self-Improve Mode — Result Parser
 *
 * Parses self-improve results from agent output and builds living doc sections.
 * Handles both the structured JSON artifact and the fallback text line.
 * Prefers schema v2 when available; falls back to v1 (auto-upgraded).
 */

import type { SelfImproveResult } from './schema';
import type { SelfImproveResultV2 } from './schemaV2';
import { parseSelfImproveResult as parseStructuredResult } from './schema';
import { parseSelfImproveResultV2 } from './schemaV2';

// ─── Fallback Line Parser ───────────────────────────────────────────────────

interface FallbackResult {
  status: 'IMPROVED' | 'NO_CHANGE' | 'FAILED' | 'NEEDS_REVIEW';
  summary: string;
}

const FALLBACK_REGEX = /SELF_IMPROVE_RESULT:\s*status=(\S+)\s+summary="([^"]*)"/;

function parseFallbackLine(text: string): FallbackResult | null {
  const match = text.match(FALLBACK_REGEX);
  if (!match) return null;

  const status = match[1]?.trim();
  const summary = match[2]?.trim() ?? '';

  if (!['IMPROVED', 'NO_CHANGE', 'FAILED', 'NEEDS_REVIEW'].includes(status)) {
    return null;
  }

  return { status: status as FallbackResult['status'], summary };
}

// ─── Main Parser ────────────────────────────────────────────────────────────

/**
 * Parse a SelfImproveResult from agent output.
 *
 * Tries structured v2 JSON first (falls back to v1 internally), then falls
 * back to the text line. Returns null if no valid result is found.
 */
export function parseSelfImproveAgentOutput(output: string): SelfImproveResult | null {
  // Try v2 first (auto-upgrades v1 internally); flatten to v1.
  const v2 = parseSelfImproveResultV2(output);
  if (v2 && v2.sourceSchema === 1 && v2.originalV1) {
    return v2.originalV1;
  }
  if (v2) {
    // v2 result — emit a synthesized v1 representation for backward
    // compatibility. The UI can call parseSelfImproveResultV2 directly
    // for full v2 fields.
    return v1FromV2(v2.result);
  }

  // Last-resort text line.
  const fallback = parseFallbackLine(output);
  if (!fallback) return null;

  return {
    schemaVersion: 1,
    mode: 'repo_self_improve',
    iteration: 0, // Will be filled by the caller
    phaseResults: {},
    changedFiles: [],
    commandsRun: [],
    buildPassed: null,
    testsPassed: null,
    typecheckPassed: null,
    riskLevel: 'low',
    status: fallback.status,
    summary: fallback.summary,
    nextRecommendation: '',
  };
}

function v1FromV2(v2: SelfImproveResultV2): SelfImproveResult {
  return {
    schemaVersion: 1,
    mode: 'repo_self_improve',
    iteration: v2.iteration,
    phaseResults: v2.phaseResults,
    changedFiles: v2.changedFiles,
    commandsRun: v2.commandsRun,
    buildPassed: v2.buildPassed,
    testsPassed: v2.testsPassed,
    typecheckPassed: v2.typecheckPassed,
    riskLevel: v2.riskLevel,
    status: v2.status,
    summary: v2.summary,
    nextRecommendation: v2.nextRecommendation,
  };
}

// ─── Living Doc Section Builder ─────────────────────────────────────────────

/**
 * Build a living doc section from a self-improve result.
 * This is used to maintain memory across iterations.
 */
export function buildSelfImproveLivingDocSection(
  iteration: number,
  result: SelfImproveResult,
): string {
  const iterLabel = `iter-${String(iteration).padStart(3, '0')}`;
  const statusEmoji = getStatusEmoji(result.status);
  const lines: string[] = [];

  lines.push(`### ${iterLabel} ${statusEmoji} ${result.status}`);
  lines.push(`- **Summary**: ${result.summary}`);
  lines.push(`- **Risk**: ${result.riskLevel}`);

  if (result.changedFiles.length > 0) {
    lines.push(`- **Changed files**: ${result.changedFiles.join(', ')}`);
  }

  const checks: string[] = [];
  if (result.buildPassed !== null) checks.push(`build: ${result.buildPassed ? 'PASS' : 'FAIL'}`);
  if (result.testsPassed !== null) checks.push(`tests: ${result.testsPassed ? 'PASS' : 'FAIL'}`);
  if (result.typecheckPassed !== null) checks.push(`typecheck: ${result.typecheckPassed ? 'PASS' : 'FAIL'}`);
  if (checks.length > 0) {
    lines.push(`- **Verification**: ${checks.join(', ')}`);
  }

  if (result.commandsRun.length > 0) {
    lines.push(`- **Commands**: ${result.commandsRun.join(', ')}`);
  }

  if (result.nextRecommendation) {
    lines.push(`- **Next**: ${result.nextRecommendation}`);
  }

  return lines.join('\n');
}

/**
 * Build a "known issues" section from multiple iteration results.
 * Collects issues from AUDIT phases of completed iterations.
 */
export function buildKnownIssuesSection(
  iterations: Array<{ iteration: number; result: SelfImproveResult }>,
): string {
  const issues: string[] = [];

  for (const { iteration, result } of iterations) {
    const auditPhase = result.phaseResults['AUDIT'];
    if (auditPhase?.output) {
      const iterLabel = `iter-${String(iteration).padStart(3, '0')}`;
      issues.push(`- [${iterLabel}] ${auditPhase.output.split('\n')[0]}`);
    }
  }

  return issues.length > 0 ? issues.join('\n') : '- No issues documented yet.';
}

/**
 * Build a "do not repeat" section from failed attempts.
 */
export function buildDoNotRepeatSection(
  iterations: Array<{ iteration: number; result: SelfImproveResult }>,
): string {
  const failed = iterations.filter(({ result }) =>
    result.status === 'FAILED' || result.status === 'NEEDS_REVIEW',
  );

  if (failed.length === 0) return '- No failed attempts yet.';

  return failed
    .map(({ iteration, result }) => {
      const iterLabel = `iter-${String(iteration).padStart(3, '0')}`;
      return `- [${iterLabel}] ${result.summary}`;
    })
    .join('\n');
}

/**
 * Build a "successful fixes" section from improved iterations.
 */
export function buildSuccessfulFixesSection(
  iterations: Array<{ iteration: number; result: SelfImproveResult }>,
): string {
  const improved = iterations.filter(({ result }) => result.status === 'IMPROVED');

  if (improved.length === 0) return '- No successful fixes yet.';

  return improved
    .map(({ iteration, result }) => {
      const iterLabel = `iter-${String(iteration).padStart(3, '0')}`;
      return `- [${iterLabel}] ${result.summary}`;
    })
    .join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStatusEmoji(status: 'IMPROVED' | 'NO_CHANGE' | 'FAILED' | 'NEEDS_REVIEW'): string {
  switch (status) {
    case 'IMPROVED': return '✅';
    case 'NO_CHANGE': return '⚪';
    case 'FAILED': return '❌';
    case 'NEEDS_REVIEW': return '⚠️';
  }
}
