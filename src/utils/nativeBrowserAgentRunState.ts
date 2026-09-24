/**
 * Pure run-summary / step-recording / loop-detection helpers for the native
 * browser agent (AG-07 extract from `nativeBrowserAgent.ts`; same semantics).
 */

import { entriesEqual, type LoopSignature } from './nativeBrowserAgentHelpers';
import type { NativeAgentRunSummary, NativeAgentStepTiming } from './nativeBrowserAgentTypes';

export const emptySummary = (): Omit<
  NativeAgentRunSummary,
  'startedAt' | 'finishedAt' | 'totalMs' | 'outcome' | 'finalText'
> => ({
  steps: [],
  policyApprovals: 0,
  policyDenials: 0,
  fullSnapshots: 0,
  lightObservations: 0,
  interactiveObservations: 0,
  screenshots: 0,
  loopDetections: 0,
  malformedResponses: 0,
  llmRetries: 0,
  cacheHits: 0,
  cacheMisses: 0,
});

export function recordStepTiming(
  stepTiming: NativeAgentStepTiming,
  stepStartedAt: number,
  summary: NativeAgentRunSummary,
  onStep?: (timing: NativeAgentStepTiming) => void,
): void {
  stepTiming.totalStepMs = Date.now() - stepStartedAt;
  summary.steps.push(stepTiming);
  onStep?.(stepTiming);
}

export function countLoopRepeats(
  loopHistory: LoopSignature[],
  signature: LoopSignature,
  loopWindow: number,
): number {
  loopHistory.push(signature);
  if (loopHistory.length > loopWindow) loopHistory.shift();
  return loopHistory.filter((entry) =>
    entriesEqual(entry, signature) &&
    entry.actionName !== 'wait' &&
    entry.actionName !== 'wait_for_selector' &&
    entry.actionName !== 'refresh_page_state',
  ).length;
}

export function resolveIncompleteRunOutcome(
  summary: NativeAgentRunSummary,
  maxSteps: number,
): NativeAgentRunSummary['outcome'] {
  if (summary.steps.length >= maxSteps) {
    return 'max_steps';
  } else if (summary.loopDetections > 0) {
    return 'loop_detected';
  } else if (summary.policyDenials > 0) {
    return 'aborted';
  } else {
    return 'aborted';
  }
}
