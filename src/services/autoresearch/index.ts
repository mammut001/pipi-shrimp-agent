/**
 * AutoResearch service barrel exports
 */

export { startExperimentLoop, stopExperimentLoop, pauseExperimentLoop, resumeExperimentLoop } from './loopEngine';
export { logExperiment, appendMarkdownLog, saveExperimentToDb } from './expLogger';
export { rollback, commitExperiment, isRemoteClean, getRemoteDiff } from './rollback';
export { createNotifier } from './notifier';
export { createAutoResearchSendMessage } from './chatAdapter';
export type { AutoResearchNotifier } from './notifier';
