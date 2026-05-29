/**
 * Self-Improve Mode — Scoring Logic
 *
 * Evaluates self-improve iteration results to produce a numeric score
 * and determine the final status (IMPROVED, NO_CHANGE, FAILED, NEEDS_REVIEW).
 *
 * Scoring criteria:
 *   +30 build passes
 *   +30 tests pass
 *   +20 typecheck passes
 *   +10 regression tests added (test files in changedFiles)
 *   -10 per unrelated directory touched (>3 distinct directories = penalty)
 *   -50 if any verification step fails
 *   -20 if risk level is high
 */

import type {
  SelfImproveResult,
  SelfImproveRiskLevel,
  SelfImproveStatus,
} from './schema';

// ─── Score Weights ──────────────────────────────────────────────────────────

const SCORE_BUILD_PASSED = 30;
const SCORE_TESTS_PASSED = 30;
const SCORE_TYPECHECK_PASSED = 20;
const SCORE_REGRESSION_TEST_ADDED = 10;
const PENALTY_UNRELATED_DIR = 10;
const PENALTY_VERIFICATION_FAILED = 50;
const PENALTY_HIGH_RISK = 20;
const UNRELATED_DIR_THRESHOLD = 3;

// ─── Score Computation ──────────────────────────────────────────────────────

/**
 * Compute a numeric score for a self-improve iteration result.
 * Higher is better. Range is roughly -70 to +90.
 */
export function computeSelfImproveScore(result: SelfImproveResult): number {
  let score = 0;

  // Verification signals
  if (result.buildPassed === true) score += SCORE_BUILD_PASSED;
  if (result.testsPassed === true) score += SCORE_TESTS_PASSED;
  if (result.typecheckPassed === true) score += SCORE_TYPECHECK_PASSED;

  // Regression test bonus: check if any changed file looks like a test file
  if (hasRegressionTestFiles(result.changedFiles)) {
    score += SCORE_REGRESSION_TEST_ADDED;
  }

  // Unrelated directory penalty
  const distinctDirs = countDistinctDirectories(result.changedFiles);
  if (distinctDirs > UNRELATED_DIR_THRESHOLD) {
    score -= (distinctDirs - UNRELATED_DIR_THRESHOLD) * PENALTY_UNRELATED_DIR;
  }

  // Verification failure penalty
  if (hasVerificationFailure(result)) {
    score -= PENALTY_VERIFICATION_FAILED;
  }

  // High risk penalty
  if (result.riskLevel === 'high') {
    score -= PENALTY_HIGH_RISK;
  }

  return score;
}

// ─── Status Determination ───────────────────────────────────────────────────

/**
 * Determine the self-improve status based on the result and computed score.
 */
export function determineSelfImproveStatus(
  result: SelfImproveResult,
  score: number,
): SelfImproveStatus {
  // If the agent already marked NEEDS_REVIEW, respect it
  if (result.status === 'NEEDS_REVIEW') {
    return 'NEEDS_REVIEW';
  }

  // If any verification failed, it's FAILED or NEEDS_REVIEW
  if (hasVerificationFailure(result)) {
    // If build or typecheck failed, it's a hard failure
    if (result.buildPassed === false || result.typecheckPassed === false) {
      return 'FAILED';
    }
    // If only tests failed, it might be a partial fix needing review
    if (result.testsPassed === false) {
      return 'NEEDS_REVIEW';
    }
    return 'FAILED';
  }

  // If nothing changed and score is zero, it's NO_CHANGE
  if (result.changedFiles.length === 0 && score <= 0) {
    return 'NO_CHANGE';
  }

  // If score is positive and all checks passed, it's IMPROVED
  if (score > 0 && !hasVerificationFailure(result)) {
    return 'IMPROVED';
  }

  // Default: NO_CHANGE
  return 'NO_CHANGE';
}

// ─── Risk Classification ────────────────────────────────────────────────────

/**
 * Classify the risk level of a self-improve iteration.
 */
export function classifySelfImproveRiskLevel(
  changedFiles: string[],
  commandsRun: string[],
): SelfImproveRiskLevel {
  // High risk: many files changed or dangerous commands
  if (changedFiles.length > 10) return 'high';
  if (commandsRun.some(isDangerousCommand)) return 'high';

  // Medium risk: moderate changes across multiple directories
  const distinctDirs = countDistinctDirectories(changedFiles);
  if (changedFiles.length > 5 || distinctDirs > 3) return 'medium';

  // Low risk: small, focused changes
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

function isDangerousCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return /\brm\s+(-rf?|--force)\s+/.test(lower)
    || /\bmkfs\b/.test(lower)
    || /\bdd\s+/.test(lower)
    || /\bformat\b/.test(lower)
    || /\/etc\//.test(lower)
    || /\bchmod\s+777\b/.test(lower);
}
