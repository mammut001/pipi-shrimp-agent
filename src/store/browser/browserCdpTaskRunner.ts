import type {
  BrowserActionPolicyContext,
  BrowserActionPolicyVerdict,
} from '../../utils/browserActionPolicy';
import {
  executeNativeBrowserTask,
  type NativeAgentOptions,
  type NativeAgentRunSummary,
} from '../../utils/nativeBrowserAgent';
import type { NativeAgentRunStatsPayload } from '../../types/browserObservability';
import {
  createBrowserActionApprovalId,
  summarizeBrowserActionApproval,
  waitForBrowserActionApproval,
  type BrowserPendingActionApproval,
} from './browserActionApproval';

export interface BrowserCdpTaskRunnerBridge {
  getPendingTaskId: () => string | null;
  getPendingApproval: () => BrowserPendingActionApproval | null;
  setPendingApproval: (approval: BrowserPendingActionApproval | null) => void;
  setNativeRunStats: (stats: NativeAgentRunStatsPayload) => void;
}

export interface BrowserCdpTaskRunnerInput {
  task: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  targetUrl?: string;
  signal: AbortSignal;
  permissionMode: NonNullable<NativeAgentOptions['permissionMode']>;
  taskRunToken: number;
  shouldAcceptTaskCompletion: () => boolean;
  onLog: NonNullable<NativeAgentOptions['onLog']>;
  publishRunSummary: boolean;
  bridge: BrowserCdpTaskRunnerBridge;
}

export interface BrowserCdpTaskRunnerDependencies {
  executeNativeBrowserTask: typeof executeNativeBrowserTask;
  createBrowserActionApprovalId: typeof createBrowserActionApprovalId;
  summarizeBrowserActionApproval: typeof summarizeBrowserActionApproval;
  waitForBrowserActionApproval: typeof waitForBrowserActionApproval;
}

const defaultDependencies: BrowserCdpTaskRunnerDependencies = {
  executeNativeBrowserTask,
  createBrowserActionApprovalId,
  summarizeBrowserActionApproval,
  waitForBrowserActionApproval,
};

const buildRunSummaryHandler = (
  input: BrowserCdpTaskRunnerInput,
): NonNullable<NativeAgentOptions['onRunSummary']> => (summary: NativeAgentRunSummary) => {
  if (!input.shouldAcceptTaskCompletion()) {
    return;
  }

  try {
    input.bridge.setNativeRunStats({
      total_steps: summary.steps.length,
      full_snapshots: summary.fullSnapshots,
      light_observations: summary.lightObservations,
      interactive_observations: summary.interactiveObservations,
      screenshots: summary.screenshots,
      loop_detections: summary.loopDetections,
      malformed_responses: summary.malformedResponses,
      llm_retries: summary.llmRetries,
      cache_hits: summary.cacheHits,
      cache_misses: summary.cacheMisses,
      policy_approvals: summary.policyApprovals,
      policy_denials: summary.policyDenials,
      average_step_ms: summary.steps.length > 0
        ? Math.round(summary.steps.reduce((acc, step) => acc + step.totalStepMs, 0) / summary.steps.length)
        : null,
      slowest_step_ms: summary.steps.reduce((max, step) => Math.max(max, step.totalStepMs), 0) || null,
      total_runtime_ms: summary.totalMs,
      outcome: summary.outcome,
      steps: summary.steps.map((step) => ({
        step: step.step,
        engine: step.engine,
        url: step.url,
        navigation_id: step.navigationId,
        observation_level: step.observationLevel,
        observation_ms: step.observationMs,
        prompt_chars: step.promptChars,
        llm_ms: step.llmMs,
        action_name: step.actionName,
        action_ms: step.actionMs,
        post_wait_ms: step.postWaitMs,
        screenshot_ms: step.screenshotMs,
        total_step_ms: step.totalStepMs,
        success: step.success,
        error_code: step.errorCode ?? null,
        reused_cache: step.reusedCache,
      })),
    });
  } catch (error) {
    input.onLog('warning', '[NativeAgent] Failed to publish run summary: ' + String(error));
  }
};

export function createBrowserCdpTaskRunner(
  dependencies: BrowserCdpTaskRunnerDependencies = defaultDependencies,
): (input: BrowserCdpTaskRunnerInput) => Promise<string> {
  return async (input) => {
    const approveAction: NonNullable<NativeAgentOptions['approveAction']> = async (
      verdict: BrowserActionPolicyVerdict,
      context: BrowserActionPolicyContext,
    ): Promise<boolean> => {
      if (!input.shouldAcceptTaskCompletion() || input.signal.aborted) {
        return false;
      }

      const taskId = input.bridge.getPendingTaskId() ?? 'browser-task';
      const id = dependencies.createBrowserActionApprovalId();
      const summaryFields = dependencies.summarizeBrowserActionApproval(verdict, context);

      input.bridge.setPendingApproval({
        id,
        taskId,
        taskRunToken: input.taskRunToken,
        ...summaryFields,
        createdAt: Date.now(),
      });

      try {
        return await dependencies.waitForBrowserActionApproval({
          id,
          signal: input.signal,
          isStillValid: () => (
            input.shouldAcceptTaskCompletion()
            && input.bridge.getPendingApproval()?.id === id
            && input.bridge.getPendingApproval()?.taskRunToken === input.taskRunToken
          ),
        });
      } finally {
        if (input.bridge.getPendingApproval()?.id === id) {
          input.bridge.setPendingApproval(null);
        }
      }
    };

    return dependencies.executeNativeBrowserTask(input.task, input.apiKey, input.model, {
      baseUrl: input.baseUrl,
      onLog: input.onLog,
      targetUrl: input.targetUrl,
      signal: input.signal,
      permissionMode: input.permissionMode,
      approveAction,
      onRunSummary: input.publishRunSummary ? buildRunSummaryHandler(input) : undefined,
    });
  };
}

export const runBrowserCdpTask = createBrowserCdpTaskRunner();
