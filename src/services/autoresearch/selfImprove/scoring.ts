/**
 * Self-Improve Mode — Scoring Logic (v2)
 *
 * Computes a numeric score and final status for a self-improve iteration.
 * Builds on the original v1 weights and adds the harness-aware checks:
 *   - verification[] exit codes (any non-zero → -PENALTY_VERIFICATION_EXIT)
 *   - workspace.dirtyAfter=true → penalty (iteration left the workspace dirty)
 *   - missing result.json → FAILED (hard)
 *   - claimed IMPROVED but no diff → NEEDS_REVIEW
 *   - changedFiles list disagrees with actual diff → NEEDS_REVIEW
 *   - high-risk command present → NEEDS_REVIEW or FAILED
 *
 * The scoring function is intentionally stable: callers that need v1-style
 * numbers can pass `useV2Signals: false` to disable the new penalties.
 */

import type {
  SelfImproveResult,
  SelfImproveRiskLevel,
  SelfImproveStatus,
} from './schema';
import type { SelfImproveResultV2 } from './schemaV2';
import { classifyCommandRisk } from '../permissions';

// ─── Score Weights ──────────────────────────────────────────────────────────

const SCORE_BUILD_PASSED = 30;
const SCORE_TESTS_PASSED = 30;
const SCORE_TYPECHECK_PASSED = 20;
const SCORE_REGRESSION_TEST_ADDED = 10;
const PENALTY_UNRELATED_DIR = 10;
const PENALTY_VERIFICATION_FAILED = 50;
const PENALTY_VERIFICATION_EXIT = 25;
const PENALTY_DIRTY_AFTER = 15;
const PENALTY_HIGH_RISK = 20;
const PENALTY_HIGH_RISK_COMMAND = 35;
const UNRELATED_DIR_THRESHOLD = 3;

// ─── v1-style Score ──────────────────────────────────────────────────────────

/**
 * Compute a numeric score for a self-improve iteration result.
 * Higher is better. Range is roughly -100 to +90.
 */
export function computeSelfImproveScore(result: SelfImproveResult): number {
  let score = 0;

  if (result.buildPassed === true) score += SCORE_BUILD_PASSED;
  if (result.testsPassed === true) score += SCORE_TESTS_PASSED;
  if (result.typecheckPassed === true) score += SCORE_TYPECHECK_PASSED;

  if (hasRegressionTestFiles(result.changedFiles)) {
    score += SCORE_REGRESSION_TEST_ADDED;
  }

  const distinctDirs = countDistinctDirectories(result.changedFiles);
  if (distinctDirs > UNRELATED_DIR_THRESHOLD) {
    score -= (distinctDirs - UNRELATED_DIR_THRESHOLD) * PENALTY_UNRELATED_DIR;
  }

  if (hasVerificationFailure(result)) {
    score -= PENALTY_VERIFICATION_FAILED;
  }

  if (result.riskLevel === 'high') {
    score -= PENALTY_HIGH_RISK;
  }

  return score;
}

// ─── v2 Score ────────────────────────────────────────────────────────────────

export interface ScoreV2Input {
  result: SelfImproveResultV2;
  options?: {
    resultJsonPresent?: boolean; // false → hard FAILED
    actualChangedFiles?: string[]; // for diff mismatch detection
  };
}

export interface ScoreV2Output {
  score: number;
  status: SelfImproveStatus;
  notes: string[];
}

export function computeSelfImproveScoreV2(input: ScoreV2Input): ScoreV2Output {
  const { result, options } = input;
  const notes: string[] = [];
  let score = 0;

  // Hard failure: no result.json
  if (options?.resultJsonPresent === false) {
    return {
      score: -1000,
      status: 'FAILED',
      notes: ['no_result_json: result.json missing on disk; iteration is a hard failure.'],
    };
  }

  // Verification signals
  if (result.buildPassed === true) score += SCORE_BUILD_PASSED;
  if (result.testsPassed === true) score += SCORE_TESTS_PASSED;
  if (result.typecheckPassed === true) score += SCORE_TYPECHECK_PASSED;

  // verification[] per-command exit codes
  if (result.verification && result.verification.length > 0) {
    for (const entry of result.verification) {
      if (entry.status === 'fail' || (entry.exitCode !== null && entry.exitCode !== 0)) {
        score -= PENALTY_VERIFICATION_EXIT;
        notes.push(`verification_failed: ${entry.command} exit=${entry.exitCode}`);
      }
    }
  }

  if (hasRegressionTestFiles(result.changedFiles)) {
    score += SCORE_REGRESSION_TEST_ADDED;
  }

  const distinctDirs = countDistinctDirectories(result.changedFiles);
  if (distinctDirs > UNRELATED_DIR_THRESHOLD) {
    score -= (distinctDirs - UNRELATED_DIR_THRESHOLD) * PENALTY_UNRELATED_DIR;
  }

  if (hasVerificationFailureV2(result)) {
    score -= PENALTY_VERIFICATION_FAILED;
  }

  // dirtyAfter penalty
  if (result.workspace?.dirtyAfter) {
    score -= PENALTY_DIRTY_AFTER;
    notes.push('dirty_after: workspace remained dirty after iteration.');
  }

  // High-risk command penalty
  const highRiskCommands = (result.commandsRun ?? []).filter(
    (cmd) => classifyCommandRisk(cmd) === 'high',
  );
  if (highRiskCommands.length > 0) {
    score -= PENALTY_HIGH_RISK_COMMAND;
    notes.push(`high_risk_command: ${highRiskCommands[0]}`);
  }

  if (result.riskLevel === 'high') {
    score -= PENALTY_HIGH_RISK;
  }

  // Diff mismatch with claimed changedFiles
  let diffMismatch = false;
  if (options?.actualChangedFiles) {
    const claimed = new Set(result.changedFiles);
    const actual = new Set(options.actualChangedFiles);
    const claimedSorted = [...claimed].sort();
    const actualSorted = [...actual].sort();
    if (claimedSorted.length !== actualSorted.length
      || claimedSorted.some((file, i) => file !== actualSorted[i])) {
      diffMismatch = true;
      notes.push('changed_files_mismatch: result.changedFiles disagrees with diff.');
    }
  }

  const status = determineStatusV2(result, {
    score,
    hasHighRiskCommand: highRiskCommands.length > 0,
    hasDiff: (result.patch?.addedLines ?? 0) + (result.patch?.deletedLines ?? 0) > 0,
    diffMismatch,
  });

  return { score, status, notes };
}

// ─── v1 Status Determination (preserved) ─────────────────────────────────────

export function determineSelfImproveStatus(
  result: SelfImproveResult,
  score: number,
): SelfImproveStatus {
  if (result.status === 'NEEDS_REVIEW') return 'NEEDS_REVIEW';

  if (hasVerificationFailure(result)) {
    if (result.buildPassed === false || result.typecheckPassed === false) {
      return 'FAILED';
    }
    if (result.testsPassed === false) {
      return 'NEEDS_REVIEW';
    }
    return 'FAILED';
  }

  if (result.changedFiles.length === 0 && score <= 0) {
    return 'NO_CHANGE';
  }

  if (score > 0 && !hasVerificationFailure(result)) {
    return 'IMPROVED';
  }

  return 'NO_CHANGE';
}

// ─── v2 Status Determination ─────────────────────────────────────────────────

function determineStatusV2(
  result: SelfImproveResultV2,
  ctx: { score: number; hasHighRiskCommand: boolean; hasDiff: boolean; diffMismatch: boolean },
): SelfImproveStatus {
  // Hard verification failure (build or typecheck)
  if (result.buildPassed === false || result.typecheckPassed === false) {
    return 'FAILED';
  }
  if (result.testsPassed === false) {
    return 'NEEDS_REVIEW';
  }

  // High-risk command → FAILED or NEEDS_REVIEW
  if (ctx.hasHighRiskCommand) {
    return result.changedFiles.length > 0 ? 'NEEDS_REVIEW' : 'FAILED';
  }

  // claimed IMPROVED but no diff at all → NEEDS_REVIEW
  if (result.status === 'IMPROVED' && !ctx.hasDiff) {
    return 'NEEDS_REVIEW';
  }

  // changedFiles doesn't match actual diff → NEEDS_REVIEW
  if (ctx.diffMismatch) {
    return 'NEEDS_REVIEW';
  }

  // Respect agent's NEEDS_REVIEW
  if (result.status === 'NEEDS_REVIEW') return 'NEEDS_REVIEW';

  if (result.changedFiles.length === 0 && ctx.score <= 0) {
    return 'NO_CHANGE';
  }

  if (ctx.score > 0) {
    return 'IMPROVED';
  }
  return 'NO_CHANGE';
}

// ─── Risk Classification ────────────────────────────────────────────────────

export function classifySelfImproveRiskLevel(
  changedFiles: string[],
  commandsRun: string[],
): SelfImproveRiskLevel {
  if (changedFiles.length > 10) return 'high';
  if (commandsRun.some((cmd) => classifyCommandRisk(cmd) === 'high')) return 'high';
  if (commandsRun.some((cmd) => classifyCommandRisk(cmd) === 'medium')) return 'medium';

  const distinctDirs = countDistinctDirectories(changedFiles);
  if (changedFiles.length > 5 || distinctDirs > 3) return 'medium';

  return 'low';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hasRegressionTestFiles(changedFiles: string[]): boolean {
  return changedFiles.some((file) =>
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)
    || file.includes('__tests__/'),
  );
}

function countDistinctDirectories(files: string[]): number {
  const dirs = new Set<string>();
  for (const file of files) {
    const lastSlash = file.lastIndexOf('/');
    if (lastSlash > 0) {
      dirs.add(file.slice(0, lastSlash));
    }
  }
  return dirs.size;
}

function hasVerificationFailure(result: SelfImproveResult): boolean {
  return result.buildPassed === false
    || result.testsPassed === false
    || result.typecheckPassed === false;
}

function hasVerificationFailureV2(result: SelfImproveResultV2): boolean {
  return result.buildPassed === false
    || result.testsPassed === false
    || result.typecheckPassed === false;
}
