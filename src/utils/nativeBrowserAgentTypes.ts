/**
 * Public types for the native CDP browser agent (AG-07 extract from
 * `nativeBrowserAgent.ts`; re-exported there so importers are unchanged).
 */

import type { ObservationLevel } from '@/types/browserEngine';
import type { SupportedActionName } from './browserAgentActionSchema';
import type { BrowserActionPolicyContext, BrowserActionPolicyVerdict } from './browserActionPolicy';
import type { AgentLogger } from './nativeBrowserAgentHelpers';

// ─── Step timing model ─────────────────────────────────────────────────────

export interface NativeAgentStepTiming {
  step: number;
  engine: 'cdp_native';
  url: string;
  navigationId: string;
  observationLevel: ObservationLevel;
  observationMs: number;
  promptChars: number;
  llmMs: number;
  actionName: SupportedActionName | 'invalid';
  actionMs: number;
  postWaitMs: number;
  screenshotMs: number;
  totalStepMs: number;
  success: boolean;
  errorCode?: string;
  reusedCache: boolean;
}

export interface NativeAgentRunSummary {
  startedAt: number;
  finishedAt: number;
  totalMs: number;
  steps: NativeAgentStepTiming[];
  outcome: 'completed' | 'failed' | 'aborted' | 'loop_detected' | 'max_steps';
  /** How many times the policy asked the user and was approved. */
  policyApprovals: number;
  /** How many times the policy denied an action. */
  policyDenials: number;
  /** Number of full PageState captures. */
  fullSnapshots: number;
  /** Number of light observations. */
  lightObservations: number;
  /** Number of interactive observations. */
  interactiveObservations: number;
  /** Number of screenshots taken. */
  screenshots: number;
  /** Number of repeated-action loops detected. */
  loopDetections: number;
  /** Number of times the model returned malformed JSON. */
  malformedResponses: number;
  /** Number of times the LLM call was retried due to error. */
  llmRetries: number;
  /** Cache hit / miss totals for PageState. */
  cacheHits: number;
  cacheMisses: number;
  /** Final free-form text returned to the caller. */
  finalText: string;
}

// ─── Public entry point ────────────────────────────────────────────────────

export interface NativeAgentOptions {
  baseUrl?: string;
  targetUrl?: string;
  onLog?: AgentLogger;
  /** Approve or deny a sensitive action. Returns true to allow, false to deny. */
  approveAction?: (
    verdict: BrowserActionPolicyVerdict,
    context: BrowserActionPolicyContext,
  ) => Promise<boolean> | boolean;
  /** Hint to the policy layer. */
  permissionMode?: 'observe_only' | 'ask_each_action' | 'auto_safe';
  /** Force a screenshot per step regardless of flag. */
  captureScreenshotEveryStep?: boolean;
  /** Maximum number of steps (overrides flag). */
  maxSteps?: number;
  /** Stop early when a run summary callback fires. Used by debug panels. */
  onStep?: (timing: NativeAgentStepTiming) => void;
  /** Called once when the run finishes with the full summary. */
  onRunSummary?: (summary: NativeAgentRunSummary) => void;
  /** Cooperative cancellation for stopTask and diagnostics cancel hooks. */
  signal?: AbortSignal;
}
