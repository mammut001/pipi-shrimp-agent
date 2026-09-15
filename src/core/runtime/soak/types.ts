/**
 * Soak runner types (GPT soak P0 knife 1).
 * Deterministic Manual D–style loop + failure-bundle metadata.
 */

export type SoakInvariantName =
  | 'no_cross_session_cancel'
  | 'no_orphan_tool_calls'
  | 'no_cancelled_as_success'
  | 'no_stale_replay_late_a_discarded';

export type SoakAssertionFailure = {
  invariant: SoakInvariantName | 'setup' | 'scenario';
  message: string;
};

export type SoakIterationResult = {
  ok: boolean;
  iteration: number;
  sessionA: string;
  sessionB: string;
  failures: SoakAssertionFailure[];
  /** Optional synthetic history check summary (orphan tool_calls). */
  orphanCount?: number;
};

export type RunSoakOptions = {
  /** Number of iterations. Default 50 (CI-friendly). Override with env PIPI_SOAK_ITERS. */
  iterations?: number;
  /** Directory root for failure bundles (default: artifacts/soak or /tmp). */
  artifactRoot?: string;
  /** Stop after first failure (default true). */
  stopOnFailure?: boolean;
  /** Unique prefix for session ids (default soak). */
  sessionPrefix?: string;
};

export type SoakRunSummary = {
  ok: boolean;
  iterationsRequested: number;
  iterationsCompleted: number;
  failedAt?: number;
  failureBundleDir?: string;
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
