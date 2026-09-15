/**
 * Soak runner types (GPT soak P0 knife 1).
 * Deterministic Manual D–style loop + failure-bundle metadata.
 */

import type { Message } from '../../../types/chat';

export type SoakInvariantName =
  | 'no_cross_session_cancel'
  | 'no_orphan_tool_calls'
  | 'no_cancelled_as_success'
  | 'no_stale_replay_late_a_discarded';

export type SoakAssertionFailure = {
  invariant: SoakInvariantName | 'setup' | 'scenario';
  message: string;
};

export type SoakHistorySource = 'manual_d_harness' | 'injected' | 'synthetic';

export type SoakIterationOptions = {
  /**
   * Optional session A/B message histories to assert orphan/terminalize against.
   * When omitted, the iteration uses histories produced by the Manual D product
   * harness (cancel terminalize on A + successful tool result on B).
   */
  historyA?: Message[];
  historyB?: Message[];
};

export type SoakIterationResult = {
  ok: boolean;
  iteration: number;
  sessionA: string;
  sessionB: string;
  failures: SoakAssertionFailure[];
  /** Orphan tool_call count remaining on session A history after terminalize (expect 0). */
  orphanCount?: number;
  /** A history asserted this iteration (harness-produced unless injected). */
  historyA?: Message[];
  /** B history asserted this iteration (harness-produced unless injected). */
  historyB?: Message[];
  /** Where histories came from — default path must be `manual_d_harness`. */
  historySource?: SoakHistorySource;
};

export type RunSoakOptions = {
  /** Number of iterations. Default 50 (CI-friendly). Override with env PIPI_SOAK_ITERS. */
  iterations?: number;
  /** Directory root for failure bundles (default: artifacts/soak or /tmp). */
  artifactRoot?: string;
  /**
   * Stop after first failure (default true).
   * When false, continue remaining iterations while still recording failures + bundles.
   */
  stopOnFailure?: boolean;
  /** Unique prefix for session ids (default soak). */
  sessionPrefix?: string;
  /**
   * Optional iteration runner override (tests / composition).
   * Defaults to runSoakIteration.
   */
  runIteration?: (
    iteration: number,
    sessionPrefix: string,
  ) => Promise<SoakIterationResult>;
};

export type SoakRunSummary = {
  ok: boolean;
  iterationsRequested: number;
  iterationsCompleted: number;
  failedAt?: number;
  failureBundleDir?: string;
  /** All failure bundle dirs written this run (useful when stopOnFailure=false). */
  failureBundleDirs?: string[];
  results: SoakIterationResult[];
};

export type FailureBundlePaths = {
  dir: string;
  metaPath: string;
  diagnosticsPath: string;
  traceAPath: string;
  traceBPath: string;
  fullTracePath: string;
};
