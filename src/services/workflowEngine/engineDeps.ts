import { invoke } from '@tauri-apps/api/core';
import { evaluateWorkflowGoal } from '@/services/workflowGoalEvaluator';
import { notifyOnComplete } from '@/services/workflowNotifier';
import { workflowRunFileService } from '@/services/workflow/runFileService';
import { runAgentWithRetry } from './agentRunner';

export interface WorkflowEngineDeps {
  createRunDirectory: (runId: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
  writeRunFile?: (runDirectory: string, relativePath: string, content: string) => Promise<string>;
  runAgent: typeof runAgentWithRetry;
  evaluateGoal: typeof evaluateWorkflowGoal;
  notify: typeof notifyOnComplete;
  now: () => number;
}

export function defaultDeps(): WorkflowEngineDeps {
  return {
    createRunDirectory: (runId) => invoke<string>('create_workflow_run_directory', { runId }),
    writeRunFile: (runDirectory, relativePath, content) => (
      workflowRunFileService.writeRunFile(runDirectory, relativePath, content)
    ),
    runAgent: runAgentWithRetry,
    evaluateGoal: evaluateWorkflowGoal,
    notify: notifyOnComplete,
    now: () => Date.now(),
  };
}
