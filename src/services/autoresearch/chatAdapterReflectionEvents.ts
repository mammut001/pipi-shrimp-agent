import { useAutoResearchStore } from '@/store/autoresearchStore';
import type { ToolBudgetSummary } from '@/services/tools/toolBudget';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';
import { appendIterationTranscript } from './chatAdapterSupport';
import type {
  AutoResearchReflectionDecision,
  AutoResearchReflectionDecisionResult,
} from './reflection';
import { writeTargetText } from './runDir';
import { getCurrentRunDir } from './terminalRunner';

export function emitToolBudgetEvent(summary: ToolBudgetSummary | undefined): void {
  if (!summary || (summary.successfulCalls === 0 && summary.failedCalls === 0)) {
    return;
  }

  useAutoResearchStore.getState().addRunEvent?.({
    level: summary.failedCalls > 0 ? 'warn' : 'info',
    phase: 'agent_execution',
    message: `Tool budget ${summary.toolBudgetUsed}/${summary.toolBudgetMax} used (${summary.successfulCalls} successful, ${summary.failedCalls} failed).`,
    metadata: {
      tool_budget_used: summary.toolBudgetUsed,
      tool_budget_max: summary.toolBudgetMax,
      failed_calls: summary.failedCalls,
      successful_calls: summary.successfulCalls,
      category_counts: summary.categoryCounts,
    },
  });
}

export async function persistReflectionDecision(
  decision: AutoResearchReflectionDecision,
  toolBudgetSummary?: ToolBudgetSummary,
): Promise<void> {
  setAutoResearchPhase('REFLECT', {
    summary: `Reflection generated a ${decision.action} decision.`,
  });
  emitAutoResearchRuntimeEvent({
    level: decision.shouldRetry ? 'info' : 'warn',
    phase: 'REFLECT',
    type: 'reflection_generated',
    message: `Reflection decision: ${decision.action} — ${decision.summary}`,
    summary: decision.summary,
    metadata: {
      action: decision.action,
      rootCause: decision.rootCause,
      confidence: decision.confidence,
      ...(toolBudgetSummary ? {
        tool_budget_used: toolBudgetSummary.toolBudgetUsed,
        tool_budget_max: toolBudgetSummary.toolBudgetMax,
        failed_calls: toolBudgetSummary.failedCalls,
        successful_calls: toolBudgetSummary.successfulCalls,
      } : {}),
    },
  });
  useAutoResearchStore.getState().patchIterationRecord({
    iteration: useAutoResearchStore.getState().currentIteration,
    reflectionSummary: decision.summary,
  });
  useAutoResearchStore.getState().appendLiveOutput(
    `[status] Reflection decision: ${decision.action} — ${decision.summary}\n`,
  );
  await appendIterationTranscript(
    `\n## Reflection Decision\n\`\`\`json\n${JSON.stringify({
      action: decision.action,
      summary: decision.summary,
      rootCause: decision.rootCause,
      nextCommand: decision.nextCommand,
      nextPlan: decision.nextPlan,
      userMessage: decision.userMessage,
      shouldRetry: decision.shouldRetry,
      confidence: decision.confidence,
    }, null, 2)}\n\`\`\`\n`,
  );
}

export async function persistReflectionArtifacts(result: AutoResearchReflectionDecisionResult): Promise<void> {
  const state = useAutoResearchStore.getState();
  const runDir = getCurrentRunDir();
  if (!state.sshConfig || !runDir) {
    return;
  }

  await Promise.all([
    writeTargetText(
      state.sshConfig,
      runDir.reflectionInputPath,
      `${JSON.stringify(result.request, null, 2)}\n`,
    ),
    writeTargetText(
      state.sshConfig,
      runDir.reflectionRawPath,
      result.rawText,
    ),
    writeTargetText(
      state.sshConfig,
      runDir.reflectionParsedPath,
      `${JSON.stringify({
        decision: result.decision.action,
        summary: result.decision.summary,
        next_action: result.decision.nextPlan ?? '',
        parser_path: result.parserPath,
        retry_count: result.retryCount,
      }, null, 2)}\n`,
    ),
  ]);
}

export function emitReflectionParseFailureEvents(result: AutoResearchReflectionDecisionResult): void {
  result.parseFailedAttempts.forEach((attempt) => {
    emitAutoResearchRuntimeEvent({
      level: 'warn',
      phase: 'REFLECT',
      type: 'raw',
      message: `Reflection parse failed (${attempt.retryCount + 1}/${result.retryCount + 1}): ${attempt.preview}`,
      summary: `Reflection parse failed on retry ${attempt.retryCount + 1}.`,
      metadata: {
        retryCount: attempt.retryCount,
        preview: attempt.preview,
      },
    });
  });
}
