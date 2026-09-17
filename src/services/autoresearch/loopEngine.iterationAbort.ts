/**
 * AutoResearch Loop Engine — iteration abort and budget helpers.
 *
 * Extracted from `loopEngine.iterationPhase.ts` as part of AG-02 PR2b
 * follow-up. Owns user abort errors, abort checks, interruptible sleep,
 * and tool-budget reserve calculations.
 */

export const TOOL_BUDGET_EXHAUSTED_MARKER = '__AUTORESEARCH_TOOL_BUDGET_EXHAUSTED__';
export const MAX_CONSECUTIVE_RATE_LIMITS = 3;

export class AutoResearchAbortedError extends Error {
  constructor(message = 'AutoResearch loop was aborted by the user.') {
    super(message);
    this.name = 'AutoResearchAbortedError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined, context: string): void {
  if (signal?.aborted) {
    throw new AutoResearchAbortedError(`${context} aborted by user.`);
  }
}

// AUDIT-016 FIX: Budget reserve is now calculated dynamically based on remaining iterations.
// This ensures the reserve is meaningful even when maxIterations is small (e.g., 1).
export function calculateBudgetReserve(maxIterations: number): number {
  // Reserve 2 rounds or 25% of maxIterations, whichever is smaller but at least 1
  return Math.max(1, Math.min(2, Math.floor(maxIterations * 0.25)));
}

/**
 * Sleep that can be interrupted by an AbortSignal. Used for rate-limit
 * cooldowns so the user can stop a run immediately instead of waiting
 * out a 60+ second sleep.
 *
 * AUDIT-FIX [audit-3-ar#9]: Prior implementation was a bare
 * `setTimeout(resolve, ms)`. The user clicking Stop during a 60s+ rate
 * limit cooldown would update the UI to "stopped" via
 * `stopExperimentLoop()`, but the loop body would still sleep the full
 * duration before checking the abort flag on the next iteration
 * boundary — blocking async cleanup and wasting backend resources.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AutoResearchAbortedError('sleep aborted before start'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AutoResearchAbortedError('sleep aborted mid-wait'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function isBudgetExhaustedIterationSignal(agentOutput: string): boolean {
  return agentOutput.includes(TOOL_BUDGET_EXHAUSTED_MARKER);
}
