/**
 * Self-Improve Mode — Result Parser
 *
 * Parses self-improve results from agent output and builds living doc sections.
 * Handles both the structured JSON artifact and the fallback text line.
 */

import type {
  SelfImproveResult,
  SelfImprovePhaseResult,
  SelfImproveStatus,
} from './schema';
import { parseSelfImproveResult as parseStructuredResult } from './schema';

// ─── Fallback Line Parser ───────────────────────────────────────────────────

interface FallbackResult {
  status: SelfImproveStatus;
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

  return { status: status as SelfImproveStatus, summary };
}

// ─── Main Parser ────────────────────────────────────────────────────────────

/**
 * Parse a SelfImproveResult from agent output.
 *
 * Tries structured JSON first, then falls back to the text line.
 * Returns null if no valid result is found.
 */
export function parseSelfImproveAgentOutput(output: string): SelfImproveResult | null {
  // Try structured JSON first
  const structured = parseStructuredResult(output);
  if (structured) return structured;

  // Fall back to text line
  const fallback = parseFallbackLine(output);
  if (!fallback) return null;

  // Build a minimal SelfImproveResult from the fallback
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

function getStatusEmoji(status: SelfImproveStatus): string {
  switch (status) {
    case 'IMPROVED': return '✅';
    case 'NO_CHANGE': return '⚪';
    case 'FAILED': return '❌';
    case 'NEEDS_REVIEW': return '⚠️';
  }
}
