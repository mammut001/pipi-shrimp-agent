/**
 * AutoResearch service barrel exports
 */

export { startExperimentLoop, stopExperimentLoop, pauseExperimentLoop, resumeExperimentLoop } from './loopEngine';
export { logExperiment, appendMarkdownLog, saveExperimentToDb } from './expLogger';
export { rollback, commitExperiment, isRemoteClean, getRemoteDiff } from './rollback';
export { createNotifier, getLastNotifierDelivery, subscribeNotifierDelivery } from './notifier';
export { createAutoResearchSendMessage } from './chatAdapter';
export { assertSupportedPlatform } from './platformGuard';
export { ensureSessionDir, createRunDir, listIterations, getSessionRunPaths } from './runDir';
export { appendIterationMetrics, readAllMetrics, summarize } from './metricsStore';
export { rebuildLivingDoc, readLivingDoc, renderLivingDoc } from './livingDoc';
export { resumeInterruptedAutoResearchRun } from './setupFlow';
export type { AutoResearchNotifier, NotifierDeliveryStatus } from './notifier';
