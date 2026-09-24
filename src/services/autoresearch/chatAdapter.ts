/**
 * AutoResearch Chat Adapter — Bridges loopEngine's sendMessage interface
 * to the core QueryEngine (runChatTurn).
 *
 * Unlike chatStore.sendMessage which renders to UI and requires permission
 * flows, this adapter auto-executes all tools (the loop is autonomous)
 * and streams live output to the AutoResearch store.
 */

import { useAutoResearchStore } from '@/store/autoresearchStore';
import {
  formatAgentConfigValidationError,
  getAgentConfigDiagnostics,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from '@/services/agentConfig';
import { runHeadlessAgentTurn } from '@/services/headless/agentRunner';
import {
  buildAutoResearchAgentErrorMessage,
  classifyAutoResearchFailure,
  formatError,
  isAutoResearchAbortError,
  isToolRoundLimitError,
} from './errors';
import {
  AutoResearchReflectionFailureError,
  buildFallbackReflectionDecision,
  buildReflectionInputFromState,
  getDeterministicRecoveryDecision,
  isAutoResearchReflectionFailureError,
  requestReflectionDecision,
  type AutoResearchObservedToolResult,
  type AutoResearchReflectionDecisionResult,
} from './reflection';
import { getCurrentRunDir } from './terminalRunner';
import { rewriteAutoResearchToolArguments } from './experimentPathRewrite';
import type { AutoResearchEnvironmentSummary } from './preflight';
import { buildAutoResearchToolCatalog } from './toolCatalog';
import type { AutoResearchRunPhase } from './history';
import {
  getRemainingToolBudget,
  getToolBudgetSummaryFromUnknown,
} from '@/services/tools/toolBudget';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';
import { parseToolResult } from './chatAdapterHelpers';
import {
  appendIterationTranscript,
  buildAutoResearchRetryConstraintState,
  buildIterationFailureOutput,
  emitBudgetNearLimitEvent,
  getLatestExperimentFailure,
  getRecentEventSummaries,
  isApiRequestFailure,
  isReflectionParserFailure,
  recordDisabledToolAttempts,
  writeIterationTranscriptHeader,
} from './chatAdapterSupport';
import {
  emitReflectionParseFailureEvents,
  emitToolBudgetEvent,
  persistReflectionArtifacts,
  persistReflectionDecision,
} from './chatAdapterReflectionEvents';
import { createReasoningBuffer } from './chatAdapterReasoning';
import {
  createAutoResearchToolHooks,
  type AutoResearchToolCallRecord,
} from './chatAdapterToolHooks';
import {
  buildIterationFailureExplanation,
  selectRecoveryAttemptPrompt,
} from './chatAdapterRecoveryPrompt';

export { buildAutoResearchRetryConstraintState } from './chatAdapterSupport';
export type { AutoResearchRetryConstraintState } from './chatAdapterSupport';

export { parseToolResult };

let adapterSessionCounter = 0;
const MAX_HISTORY = 20;
const MAX_RECOVERY_RETRIES = 1;
const MAX_REFLECTION_PASSES = 2;
const MAX_CONSECUTIVE_API_REQUEST_FAILURES = 3;

export interface AutoResearchSendMessageOptions {
  environmentSummary?: AutoResearchEnvironmentSummary;
  metricName?: string;
  direction?: 'higher' | 'lower';
  maxIterations?: number;
  reflectionConfig?: ResolvedAgentConfig | null;
  /**
   * When provided, the LLM call will be interrupted between tool iterations
   * and on the next await boundary if the signal fires. Use this to
   * cancel an in-flight AutoResearch run from the UI (e.g. on page unmount).
   */
  signal?: AbortSignal;
}

/**
 * Create a sendMessage function suitable for startExperimentLoop().
 *
 * Each call to the returned function runs one full agent turn
 * (including multi-round tool loops) and returns the final
 * assistant text output.
 */
export function createAutoResearchSendMessage(
  workDir?: string,
  fixedAgentConfig?: ResolvedAgentConfig | null,
  options: AutoResearchSendMessageOptions = {},
): (systemPrompt: string, userMessage: string) => Promise<string> {
  const signal = options.signal;
  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    // Honor abort immediately: don't even resolve the agent config or write
    // transcript headers if the user already closed the AutoResearch page.
    // We can't import the loopEngine AbortError class (would create a cycle),
    // so use a duck-typed throw that the loop catches by name.
    if (signal?.aborted) {
      const err = new Error('sendMessage called after abort signal.') as Error & { name: string };
      err.name = 'AutoResearchAbortedError';
      throw err;
    }
    const agentConfig = fixedAgentConfig ?? resolveActiveAgentConfig();
    const reflectionConfig = options.reflectionConfig ?? agentConfig;
    const validationIssues = validateResolvedAgentConfig(agentConfig);
    if (validationIssues.length > 0) {
      throw new Error(formatAgentConfigValidationError(agentConfig, validationIssues));
    }

    const turnMessages = [
      {
        role: 'user' as const,
        content: userMessage,
      },
    ];

    const store = useAutoResearchStore.getState();
    store.appendLiveOutput(`\n--- Iteration ${store.currentIteration} ---\n`);
    await writeIterationTranscriptHeader(userMessage);

    console.info('[AutoResearch] Agent request', getAgentConfigDiagnostics(agentConfig!));

    let assistantText = '';
    let lastError: unknown;
    let recoveryRetries = 0;
    let reflectionPasses = 0;
    let attemptPrompt = systemPrompt;
    const baseAllowedTools = buildAutoResearchToolCatalog(store.sshConfig);
    const toolLane: { phase: AutoResearchRunPhase } = { phase: 'READ_CONTEXT' };
    const currentRunDir = getCurrentRunDir();
    const effectiveWorkDir = store.sshConfig?.mode === 'local'
      ? (currentRunDir?.iterDir || workDir)
      : workDir;
    const experimentDirForRewrite = (
      options.environmentSummary?.experimentDir
      || store.experimentDir
      || workDir
      || ''
    ).trim();
    const rewriteExperimentPaths = Boolean(currentRunDir?.codeDir);
    const disabledToolAttemptCounts = new Map<string, number>();
    const blockedTools = new Set<string>();
    let retryConstraintState = buildAutoResearchRetryConstraintState({
      allowedTools: baseAllowedTools,
      blockedTools,
      environmentSummary: options.environmentSummary,
    });
    let consecutiveApiRequestFailures = 0;

    while (true) {
      const toolCallsById = new Map<string, AutoResearchToolCallRecord>();
      const toolResults: AutoResearchObservedToolResult[] = [];
      const failedCommands: string[] = [];
      const reasoning = createReasoningBuffer();

      try {
        adapterSessionCounter++;
        const attemptSessionId = `autoresearch-${adapterSessionCounter}-${Date.now()}`;
        const toolHooks = createAutoResearchToolHooks({
          toolLane,
          toolCallsById,
          toolResults,
          failedCommands,
          environmentSummary: options.environmentSummary,
        });

        const result = await runHeadlessAgentTurn({
          sessionId: attemptSessionId,
          initialMessages: [...turnMessages, ...retryConstraintState.retryMessages],
          systemPrompt: attemptPrompt,
          workDir: effectiveWorkDir,
          agentConfig: agentConfig!,
          allowedTools: retryConstraintState.allowedTools,
          toolExecutionSource: 'autoresearch_phase',
          permissionMode: 'bypass',
          executionMode: 'bypass',
          rewriteToolArguments: rewriteExperimentPaths
            ? (args) => rewriteAutoResearchToolArguments(args, {
              experimentDir: experimentDirForRewrite,
              codeDir: currentRunDir?.codeDir,
              iterDir: currentRunDir?.iterDir,
            })
            : undefined,
          signal,
          onTextDelta: (chunk) => {
            useAutoResearchStore.getState().appendLiveOutput(chunk);
          },
          onReasoningDelta: (chunk) => {
            reasoning.append(chunk);
          },
          onStatus: (message) => {
            useAutoResearchStore.getState().appendLiveOutput(`[status] ${message}\n`);
          },
          onToolSummary: (toolName, preview) => {
            useAutoResearchStore.getState().appendLiveOutput(`  → ${toolName}: ${preview}\n`);
          },
          onAssistantMessage: async (text) => {
            if (!text.trim()) {
              return;
            }
            await appendIterationTranscript(`\n## Assistant\n${text.trim()}\n`);
          },
          allowToolExecution: toolHooks.allowToolExecution,
          onToolCall: toolHooks.onToolCall,
          onToolResult: toolHooks.onToolResult,
        });

        reasoning.flush(result.finalReasoning);
        emitToolBudgetEvent(result.toolBudgetSummary);
        emitBudgetNearLimitEvent(result.toolBudgetSummary);
        consecutiveApiRequestFailures = 0;
        assistantText = result.finalText;
        lastError = undefined;
        break;
      } catch (error) {
        reasoning.flush();
        if (isAutoResearchAbortError(error) || signal?.aborted) {
          const abortError = new Error('sendMessage aborted by user.') as Error & { name: string };
          abortError.name = 'AutoResearchAbortedError';
          throw abortError;
        }
        lastError = error;
        const apiRequestFailure = isApiRequestFailure(error);
        if (apiRequestFailure) {
          consecutiveApiRequestFailures += 1;
          setAutoResearchPhase('FAILED', {
            level: 'warn',
            summary: `Provider request failed (${consecutiveApiRequestFailures}/${MAX_CONSECUTIVE_API_REQUEST_FAILURES}).`,
          });
          emitAutoResearchRuntimeEvent({
            level: 'warn',
            phase: 'FAILED',
            type: 'provider_error',
            message: `API request failed (${consecutiveApiRequestFailures}/${MAX_CONSECUTIVE_API_REQUEST_FAILURES}): ${formatError(error)}`,
            summary: `Provider request failed (${consecutiveApiRequestFailures}/${MAX_CONSECUTIVE_API_REQUEST_FAILURES}).`,
            metadata: {
              provider: agentConfig?.provider,
              model: agentConfig?.model,
              configName: agentConfig?.name,
            },
          });
          if (consecutiveApiRequestFailures >= MAX_CONSECUTIVE_API_REQUEST_FAILURES) {
            const failReason = `Provider API request failed ${MAX_CONSECUTIVE_API_REQUEST_FAILURES} times consecutively: ${formatError(error)}`;
            lastError = new Error(failReason);
            break;
          }
          continue;
        }
        consecutiveApiRequestFailures = 0;
        const storeState = useAutoResearchStore.getState();
        const toolBudgetSummary = getToolBudgetSummaryFromUnknown(error);
        emitToolBudgetEvent(toolBudgetSummary);
        emitBudgetNearLimitEvent(toolBudgetSummary);
        const newlyBlockedTools = recordDisabledToolAttempts(toolResults, disabledToolAttemptCounts);
        newlyBlockedTools.forEach((tool) => blockedTools.add(tool));
        if (newlyBlockedTools.length > 0) {
          emitAutoResearchRuntimeEvent({
            level: 'warn',
            phase: 'EDIT_CODE',
            type: 'raw',
            message: `Escalated disabled tool constraint: ${newlyBlockedTools.join(', ')}`,
            summary: `Disabled tools escalated: ${newlyBlockedTools.join(', ')}`,
            metadata: { tools: newlyBlockedTools },
          });
        }
        const reflectionInput = buildReflectionInputFromState({
          systemPrompt,
          metric: options.metricName ?? storeState.metricName,
          direction: options.direction ?? storeState.metricDirection,
          cwd: effectiveWorkDir ?? '',
          iteration: storeState.currentIteration,
          maxIterations: options.maxIterations ?? storeState.maxIterations,
          environmentSummary: options.environmentSummary,
          recentEvents: getRecentEventSummaries(),
          recentToolResults: toolResults,
          failedCommands,
          lastError: formatError(error),
          remainingToolBudget: toolBudgetSummary
            ? getRemainingToolBudget(toolBudgetSummary)
            : (isToolRoundLimitError(error) ? 0 : undefined),
        });
        const failureKind = classifyAutoResearchFailure(error);
        const experimentFailure = getLatestExperimentFailure(toolResults, options.environmentSummary);

        let decision = getDeterministicRecoveryDecision(reflectionInput);
        let reflectionResult: AutoResearchReflectionDecisionResult | null = null;
        if (!decision && reflectionPasses < MAX_REFLECTION_PASSES) {
          const shouldReflect = isToolRoundLimitError(error)
            || toolResults.some((item) => (typeof item.exitCode === 'number' && item.exitCode !== 0) || Boolean(item.stderr));

          if (shouldReflect) {
            reflectionPasses += 1;
            try {
              reflectionResult = await requestReflectionDecision(reflectionConfig!, reflectionInput);
              decision = reflectionResult.decision;
            } catch (reflectionError) {
              decision = buildFallbackReflectionDecision(reflectionInput, reflectionError);
            }
          }
        }

        if (!decision && isToolRoundLimitError(error)) {
          decision = buildFallbackReflectionDecision(reflectionInput, error);
        }

        if (!decision && experimentFailure) {
          assistantText = buildIterationFailureOutput({
            metricName: options.metricName ?? storeState.metricName,
            failReason: experimentFailure.stderr?.trim() || formatError(error),
            hypothesis: 'experiment command failed before evaluation completed',
            reasoning: experimentFailure.stderr?.trim() || formatError(error),
            budgetExhausted: false,
          });
          lastError = undefined;
          break;
        }

        if (decision) {
          if (reflectionResult) {
            emitReflectionParseFailureEvents(reflectionResult);
            await persistReflectionArtifacts(reflectionResult);
          }
          await persistReflectionDecision(decision, toolBudgetSummary);
          const reflectionParserFailure = isReflectionParserFailure(reflectionResult);
          const shouldFinalizeAsIterationFailure = isToolRoundLimitError(error)
            || Boolean(experimentFailure)
            || (decision.action === 'mark_iteration_failed' && !reflectionParserFailure)
            || decision.action === 'stop_tool_exhausted';

          if (shouldFinalizeAsIterationFailure) {
            const failureExplanation = buildIterationFailureExplanation({
              error,
              decision,
              experimentFailure,
            });

            assistantText = buildIterationFailureOutput({
              metricName: options.metricName ?? storeState.metricName,
              failReason: failureExplanation.failReason,
              hypothesis: isToolRoundLimitError(error)
                ? 'tool budget exhausted before evaluation completed'
                : 'experiment command failed before evaluation completed',
              reasoning: failureExplanation.reasoning,
              budgetExhausted: isToolRoundLimitError(error),
            });
            lastError = undefined;
            break;
          }

          if (decision.shouldRetry && recoveryRetries < MAX_RECOVERY_RETRIES) {
            recoveryRetries += 1;
            retryConstraintState = buildAutoResearchRetryConstraintState({
              allowedTools: baseAllowedTools,
              blockedTools,
              decision,
              environmentSummary: options.environmentSummary,
            });
            attemptPrompt = selectRecoveryAttemptPrompt({
              systemPrompt,
              decision,
              failureKind,
              allowedTools: retryConstraintState.allowedTools,
              hardConstraintLines: retryConstraintState.hardConstraintLines,
              error,
            });
            continue;
          }

          lastError = (decision.action === 'mark_iteration_failed' || decision.action === 'finish') && reflectionResult
            ? new AutoResearchReflectionFailureError(decision.userMessage || decision.summary, reflectionResult)
            : new Error(decision.userMessage || decision.summary);
        }

        break;
      }
    }

    if (lastError) {
      if (isAutoResearchReflectionFailureError(lastError)) {
        throw lastError;
      }
      const diagnosticMessage = buildAutoResearchAgentErrorMessage({
        phase: 'agent_execution',
        config: agentConfig!,
        cwd: workDir,
        error: lastError,
      });
      console.error('[AutoResearch] Agent execution failed', {
        ...getAgentConfigDiagnostics(agentConfig!),
        cwd: effectiveWorkDir,
        diagnosticMessage,
      });
      throw new Error(diagnosticMessage);
    }

    return assistantText;
  };
}
