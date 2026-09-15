/**
 * Soak runner + failure bundle (GPT soak P0 knife 1).
 * @see docs/soak-runner.md
 */
export {
  runSoak,
  runSoakIteration,
  resolveSoakIterations,
  buildSoakScenarioHistories,
  assertSoakHistoryInvariants,
} from './runSoak';
export {
  writeSoakFailureBundle,
  resolveSoakArtifactRoot,
  createFailureBundleDir,
} from './failureBundle';
export type {
  SoakInvariantName,
  SoakAssertionFailure,
  SoakHistorySource,
  SoakIterationOptions,
  SoakIterationResult,
  RunSoakOptions,
  SoakRunSummary,
  FailureBundlePaths,
} from './types';
