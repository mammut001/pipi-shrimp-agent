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
  getToolRoundLimit,
  isToolRoundLimitError,
  type AutoResearchFailureKind,
} from './errors';
import {
  AutoResearchReflectionFailureError,
  buildFallbackReflectionDecision,
  buildReflectionInputFromState,
  getDeterministicRecoveryDecision,
  isAutoResearchReflectionFailureError,
  requestReflectionDecision,
  type AutoResearchObservedToolResult,
  type AutoResearchReflectionDecision,
  type AutoResearchReflectionDecisionResult,
} from './reflection';
import { appendTargetText, writeTargetText } from './runDir';
import { getCurrentRunDir } from './terminalRunner';
import type { AutoResearchEnvironmentSummary } from './preflight';
import { buildAutoResearchToolCatalog } from './toolCatalog';

let adapterSessionCounter = 0;
const MAX_HISTORY = 20;
const MAX_RECOVERY_RETRIES = 1;
const MAX_REFLECTION_PASSES = 2;

export interface AutoResearchSendMessageOptions {
  environmentSummary?: AutoResearchEnvironmentSummary;
  metricName?: string;
  direction?: 'higher' | 'lower';
  maxIterations?: number;
}

function truncateTranscriptResult(result: string, limit = 4000): string {
  if (result.length <= limit) {
    return result;
  }
  return `${result.slice(0, limit)}\n...[truncated ${result.length - limit} chars]`;
}

async function writeIterationTranscriptHeader(userMessage: string): Promise<void> {
  const state = useAutoResearchStore.getState();
  const runDir = getCurrentRunDir();
  if (!state.sshConfig || !runDir) {
    return;
  }

  await writeTargetText(
    state.sshConfig,
    runDir.transcriptPath,
    `# AutoResearch Iteration ${runDir.iter}\n\n## User Message\n${userMessage}\n`,
  );
}

async function appendIterationTranscript(section: string): Promise<void> {
  const state = useAutoResearchStore.getState();
  const runDir = getCurrentRunDir();
  if (!state.sshConfig || !runDir) {
    return;
  }

  await appendTargetText(state.sshConfig, runDir.transcriptPath, section);
}

function buildConvergenceRetryPrompt(systemPrompt: string, maxRounds: number | null): string {
  const store = useAutoResearchStore.getState();
  const allowedTools = buildAutoResearchToolCatalog(store.sshConfig);
  const limitLine = maxRounds
    ? `The previous attempt failed because it exceeded the tool-round budget (${maxRounds}).`
    : 'The previous attempt failed because it exceeded the tool-round budget.';
  const toolDetourGuard = store.sshConfig?.mode === 'local'
    ? 'Do not switch to SSH-only tools.'
    : 'Do not switch to local file tools.';

  return `${systemPrompt}

## Strict Convergence Retry
- ${limitLine}
- Restart this SAME iteration from scratch.
- Use only these tools: ${allowedTools.join(', ')}.
- Do at most one batched inspection step before editing or running the experiment.
- If the environment is still unclear after that inspection step, immediately write ${getCurrentRunDir()?.metricsPath ?? 'metrics.json'} with status FAILED and failReason "Exceeded tool-round budget while inspecting environment", then emit EXPERIMENT_RESULT and stop.
- Do not keep exploring, do not ask for help, and ${toolDetourGuard}`;
}

function buildRecoveryPrompt(
  systemPrompt: string,
  decision: AutoResearchReflectionDecision,
  failureKind: AutoResearchFailureKind,
): string {
  const nextCommand = decision.nextCommand ? `- If you run the experiment again, use this exact command: ${decision.nextCommand}` : '';
  const nextPlan = decision.nextPlan ? `- Recovery plan: ${decision.nextPlan}` : '';

  return `${systemPrompt}

## AutoResearch Recovery Plan
- Failure kind: ${failureKind}
- Reflection decision: ${decision.action}
- Summary: ${decision.summary}
${decision.rootCause ? `- Root cause: ${decision.rootCause}` : ''}
${nextCommand}
${nextPlan}
- Do not repeat the failed command/tool choice if a better recovery path is already specified above.
- Keep the retry bounded: one focused recovery attempt only.`;
}

function parseToolCommand(call: { name: string; arguments: string }): string | undefined {
  try {
    const parsed = JSON.parse(call.arguments) as Record<string, unknown>;
    return typeof parsed.command === 'string' ? parsed.command : undefined;
  } catch {
    return undefined;
  }
}

function parseToolResult(
  call: { id: string; name: string; result: string; durationMs: number },
  toolCommand?: string,
): AutoResearchObservedToolResult {
  let stdout: string | undefined;
  let stderr: string | undefined;
  let exitCode: number | null | undefined;

  try {
    const parsed = JSON.parse(call.result) as Record<string, unknown>;
    stdout = typeof parsed.stdout === 'string' ? parsed.stdout : undefined;
    stderr = typeof parsed.stderr === 'string' ? parsed.stderr : undefined;
    const rawExitCode = parsed.exitCode ?? parsed.exit_code;
    exitCode = typeof rawExitCode === 'number' ? rawExitCode : null;
  } catch {
    stderr = call.result;
    exitCode = null;
  }

  return {
    tool: call.name,
    command: toolCommand,
    stdout,
    stderr,
    exitCode,
  };
}

function getRecentEventSummaries(): string[] {
  const state = useAutoResearchStore.getState() as ReturnType<typeof useAutoResearchStore.getState> & {
    runHistory?: Array<{ id: string; events: Array<{ phase: string; message: string }> }>;
    id?: string;
  };
  const currentRun = state.runHistory?.find((run) => run.id === state.id);
  return (currentRun?.events ?? [])
    .slice(-6)
    .map((event) => `${event.phase}: ${event.message}`);
}

async function persistReflectionDecision(decision: AutoResearchReflectionDecision): Promise<void> {
  useAutoResearchStore.getState().addRunEvent?.({
    level: decision.shouldRetry ? 'info' : 'warn',
    phase: 'agent_execution',
    message: `Reflection decision: ${decision.action} — ${decision.summary}`,
    metadata: {
      action: decision.action,
      rootCause: decision.rootCause,
      confidence: decision.confidence,
    },
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

async function persistReflectionArtifacts(result: AutoResearchReflectionDecisionResult): Promise<void> {
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

function emitReflectionParseFailureEvents(result: AutoResearchReflectionDecisionResult): void {
  result.parseFailedAttempts.forEach((attempt) => {
    useAutoResearchStore.getState().addRunEvent?.({
      level: 'warn',
      phase: 'reflection_parse_failed',
      message: `Reflection parse failed (${attempt.retryCount + 1}/${result.retryCount + 1}): ${attempt.preview}`,
      metadata: {
        retryCount: attempt.retryCount,
        preview: attempt.preview,
      },
    });
  });
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
  // Persistent message history across iterations within one loop session
  const messageHistory: any[] = [];

  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    const agentConfig = fixedAgentConfig ?? resolveActiveAgentConfig();
    const validationIssues = validateResolvedAgentConfig(agentConfig);
    if (validationIssues.length > 0) {
      throw new Error(formatAgentConfigValidationError(agentConfig, validationIssues));
    }

    // Build messages for this iteration. Keep a sliding window to avoid unbounded growth.
    if (messageHistory.length > MAX_HISTORY * 2) {
      messageHistory.splice(0, messageHistory.length - MAX_HISTORY);
    }

    const turnMessages = [
      ...messageHistory,
      {
        role: 'user',
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
    const allowedTools = buildAutoResearchToolCatalog(store.sshConfig);

    while (true) {
      const toolCallsById = new Map<string, { name: string; command?: string }>();
      const toolResults: AutoResearchObservedToolResult[] = [];
      const failedCommands: string[] = [];

      try {
        adapterSessionCounter++;
        const attemptSessionId = `autoresearch-${adapterSessionCounter}-${Date.now()}`;
        const result = await runHeadlessAgentTurn({
          sessionId: attemptSessionId,
          initialMessages: turnMessages,
          systemPrompt: attemptPrompt,
          workDir,
          agentConfig: agentConfig!,
          allowedTools,
          onTextDelta: (chunk) => {
            useAutoResearchStore.getState().appendLiveOutput(chunk);
          },
          onReasoningDelta: (chunk) => {
            useAutoResearchStore.getState().appendLiveOutput(`💭 ${chunk}`);
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
          onToolCall: async (call) => {
            toolCallsById.set(call.id, {
              name: call.name,
              command: parseToolCommand(call),
            });
            await appendIterationTranscript(
              `\n## Tool Call: ${call.name}\n\`\`\`json\n${call.arguments || '{}'}\n\`\`\`\n`,
            );
          },
          onToolResult: async (call) => {
            const observed = parseToolResult(call, toolCallsById.get(call.id)?.command);
            toolResults.push(observed);
            if (observed.command && ((typeof observed.exitCode === 'number' && observed.exitCode !== 0) || observed.stderr)) {
              failedCommands.push(observed.command);
            }
            await appendIterationTranscript(
              `\n## Tool Result: ${call.name} (${call.durationMs}ms)\n\`\`\`text\n${truncateTranscriptResult(call.result)}\n\`\`\`\n`,
            );
          },
        });

        assistantText = result.finalText;
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        const storeState = useAutoResearchStore.getState();
        const reflectionInput = buildReflectionInputFromState({
          systemPrompt,
          metric: options.metricName ?? storeState.metricName,
          direction: options.direction ?? storeState.metricDirection,
          cwd: workDir ?? '',
          iteration: storeState.currentIteration,
          maxIterations: options.maxIterations ?? storeState.maxIterations,
          environmentSummary: options.environmentSummary,
          recentEvents: getRecentEventSummaries(),
          recentToolResults: toolResults,
          failedCommands,
          lastError: formatError(error),
          remainingToolBudget: isToolRoundLimitError(error) ? 0 : undefined,
        });
        const failureKind = classifyAutoResearchFailure(error);

        let decision = getDeterministicRecoveryDecision(reflectionInput);
        let reflectionResult: AutoResearchReflectionDecisionResult | null = null;
        if (!decision && reflectionPasses < MAX_REFLECTION_PASSES) {
          const shouldReflect = isToolRoundLimitError(error)
            || toolResults.some((item) => (typeof item.exitCode === 'number' && item.exitCode !== 0) || Boolean(item.stderr));

          if (shouldReflect) {
            reflectionPasses += 1;
            try {
              reflectionResult = await requestReflectionDecision(agentConfig!, reflectionInput);
              decision = reflectionResult.decision;
            } catch (reflectionError) {
              decision = buildFallbackReflectionDecision(reflectionInput, reflectionError);
            }
          }
        }

        if (!decision && isToolRoundLimitError(error)) {
          decision = buildFallbackReflectionDecision(reflectionInput, error);
        }

        if (decision) {
          if (reflectionResult) {
            emitReflectionParseFailureEvents(reflectionResult);
            await persistReflectionArtifacts(reflectionResult);
          }
          await persistReflectionDecision(decision);
          if (decision.shouldRetry && recoveryRetries < MAX_RECOVERY_RETRIES) {
            recoveryRetries += 1;
            attemptPrompt = decision.action === 'switch_command'
              ? buildRecoveryPrompt(systemPrompt, decision, failureKind)
              : (isToolRoundLimitError(error)
                ? buildRecoveryPrompt(buildConvergenceRetryPrompt(systemPrompt, getToolRoundLimit(error)), decision, failureKind)
                : buildRecoveryPrompt(systemPrompt, decision, failureKind));
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
        cwd: workDir,
        diagnosticMessage,
      });
      throw new Error(diagnosticMessage);
    }

    // Record assistant response in history for context continuity
    messageHistory.push({
      role: 'user',
      content: userMessage,
    });
    messageHistory.push({
      role: 'assistant',
      content: assistantText,
    });

    return assistantText;
  };
}
