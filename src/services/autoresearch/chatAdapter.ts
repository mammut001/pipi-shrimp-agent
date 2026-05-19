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
import type { AutoResearchRunPhase } from './history';
import {
  buildAutoResearchToolLaneError,
  classifyAutoResearchToolPhase,
  getAutoResearchAllowedToolsForPhase,
  isAutoResearchToolLaneTransitionAllowed,
} from './toolLanes';
import {
  getRemainingToolBudget,
  getToolBudgetSummaryFromUnknown,
  type ToolBudgetSummary,
} from '@/services/tools/toolBudget';
import { extractErrorDetails } from '@/utils/errorFormat';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';

let adapterSessionCounter = 0;
const MAX_HISTORY = 20;
const MAX_RECOVERY_RETRIES = 1;
const MAX_REFLECTION_PASSES = 2;
const MAX_CONSECUTIVE_API_REQUEST_FAILURES = 3;
const TOOL_BUDGET_RESERVE = 4;
const TOOL_BUDGET_EXHAUSTED_MARKER = '__AUTORESEARCH_TOOL_BUDGET_EXHAUSTED__';
const TOOL_BUDGET_EXHAUSTION_FAIL_REASON = 'tool budget exhausted before evaluation completed';

export interface AutoResearchSendMessageOptions {
  environmentSummary?: AutoResearchEnvironmentSummary;
  metricName?: string;
  direction?: 'higher' | 'lower';
  maxIterations?: number;
  reflectionConfig?: ResolvedAgentConfig | null;
}

export interface AutoResearchRetryConstraintState {
  allowedTools: string[];
  retryMessages: Array<{ role: 'user'; content: string }>;
  hardConstraintLines: string[];
}

function truncateTranscriptResult(result: string, limit = 4000): string {
  if (result.length <= limit) {
    return result;
  }
  return `${result.slice(0, limit)}\n...[truncated ${result.length - limit} chars]`;
}

function previewFirstLines(text: string, maxLines = 10): string {
  return text
    .split('\n')
    .slice(0, maxLines)
    .join('\n')
    .trim();
}

function summarizeToolInput(argumentsText: string): string {
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    const command = typeof parsed.command === 'string' ? parsed.command : null;
    const path = typeof parsed.path === 'string' ? parsed.path : null;
    const filePath = typeof parsed.filePath === 'string' ? parsed.filePath : null;
    return command || filePath || path || truncateTranscriptResult(JSON.stringify(parsed), 240);
  } catch {
    return truncateTranscriptResult(argumentsText || '{}', 240);
  }
}

function readToolPath(argumentsText: string): string | undefined {
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    const path = typeof parsed.path === 'string' ? parsed.path : null;
    const filePath = typeof parsed.filePath === 'string' ? parsed.filePath : null;
    return filePath || path || undefined;
  } catch {
    return undefined;
  }
}

function isNearToolBudgetLimit(summary: ToolBudgetSummary | undefined): boolean {
  if (!summary) {
    return false;
  }
  return summary.toolBudgetUsedRaw >= Math.max(0, summary.toolBudgetMax - TOOL_BUDGET_RESERVE);
}

function emitBudgetNearLimitEvent(summary: ToolBudgetSummary | undefined): void {
  if (!isNearToolBudgetLimit(summary)) {
    return;
  }

  useAutoResearchStore.getState().addRunEvent?.({
    level: 'warn',
    phase: 'agent_execution',
    message: `budget_near_limit: ${summary!.toolBudgetUsed}/${summary!.toolBudgetMax} used; reserving ${TOOL_BUDGET_RESERVE} tool calls for evaluation and cleanup.`,
    metadata: {
      tool_budget_used: summary!.toolBudgetUsed,
      tool_budget_max: summary!.toolBudgetMax,
      reserve: TOOL_BUDGET_RESERVE,
      remaining: getRemainingToolBudget(summary!),
    },
  });
}

function isExperimentRunCommand(command: string | undefined, environmentSummary?: AutoResearchEnvironmentSummary): boolean {
  const normalized = command?.trim();
  if (!normalized) {
    return false;
  }

  const recommended = environmentSummary?.recommendedRunCommand?.trim();
  if (recommended && (normalized.includes(recommended) || recommended.includes(normalized))) {
    return true;
  }

  const runScriptPath = environmentSummary?.runScriptPath?.trim();
  if (runScriptPath && normalized.includes(runScriptPath)) {
    return true;
  }

  return /\brun_experiment\.py\b/.test(normalized);
}

function getLatestExperimentFailure(
  toolResults: AutoResearchObservedToolResult[],
  environmentSummary?: AutoResearchEnvironmentSummary,
): AutoResearchObservedToolResult | null {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const result = toolResults[index];
    const failed = Boolean(result.stderr) || (typeof result.exitCode === 'number' && result.exitCode !== 0);
    if (!failed) {
      continue;
    }
    if (isExperimentRunCommand(result.command, environmentSummary)) {
      return result;
    }
  }
  return null;
}

function isReflectionParserFailure(result: AutoResearchReflectionDecisionResult | null): boolean {
  return Boolean(result && result.parserPath === null && result.parseFailedAttempts.length > 0);
}

function isDisabledToolFailure(result: AutoResearchObservedToolResult): boolean {
  return (result.stderr ?? '').includes('disabled for this AutoResearch run');
}

function recordDisabledToolAttempts(
  toolResults: AutoResearchObservedToolResult[],
  counts: Map<string, number>,
): string[] {
  const newlyBlocked: string[] = [];

  for (const result of toolResults) {
    if (!isDisabledToolFailure(result)) {
      continue;
    }

    const nextCount = (counts.get(result.tool) ?? 0) + 1;
    counts.set(result.tool, nextCount);
    if (nextCount === 2) {
      newlyBlocked.push(result.tool);
    }
  }

  return newlyBlocked;
}

function isApiRequestFailure(error: unknown): boolean {
  const envelope = extractErrorDetails(error);
  const message = envelope.message.toLowerCase();

  return Boolean(envelope.httpCode)
    || message.includes('chat request failed')
    || message.includes('streaming request failed')
    || message.includes('invalid request')
    || message.includes('reasoning_content')
    || message.includes('response_format');
}

export function buildAutoResearchRetryConstraintState(input: {
  allowedTools: string[];
  blockedTools: Iterable<string>;
  decision?: Pick<AutoResearchReflectionDecision, 'nextCommand' | 'nextPlan'> | null;
  environmentSummary?: AutoResearchEnvironmentSummary;
}): AutoResearchRetryConstraintState {
  const blockedTools = Array.from(new Set([...input.blockedTools].filter(Boolean)));
  const blockedToolSet = new Set(blockedTools);
  const allowedTools = input.allowedTools.filter((tool) => !blockedToolSet.has(tool));
  const hardConstraintLines = blockedTools.map((tool) => `HARD CONSTRAINT: do not call ${tool}.`);

  if (blockedToolSet.has('list_files')) {
    if (allowedTools.includes('execute_command')) {
      hardConstraintLines.push('Use execute_command with `ls -la` or `ls -la <path>` instead.');
    } else if (allowedTools.includes('ssh_exec')) {
      hardConstraintLines.push('Use ssh_exec with `ls -la` or `ls -la <path>` instead.');
    }
  }

  if (hardConstraintLines.length > 0) {
    if (input.decision?.nextCommand) {
      hardConstraintLines.push(`Use this exact recovery command instead: ${input.decision.nextCommand}`);
    } else if (input.decision?.nextPlan) {
      hardConstraintLines.push(`Follow this recovery plan instead: ${input.decision.nextPlan}`);
    } else if (input.environmentSummary?.recommendedRunCommand) {
      hardConstraintLines.push(`Use this exact recovery command instead: ${input.environmentSummary.recommendedRunCommand}`);
    }
  }

  return {
    allowedTools,
    retryMessages: hardConstraintLines.length > 0
      ? [{ role: 'user', content: hardConstraintLines.join(' ') }]
      : [],
    hardConstraintLines,
  };
}

function buildIterationFailureOutput(input: {
  metricName: string;
  failReason: string;
  hypothesis: string;
  reasoning: string;
  budgetExhausted?: boolean;
}): string {
  const payload = {
    schemaVersion: 1,
    sessionId: useAutoResearchStore.getState().id,
    runId: useAutoResearchStore.getState().id,
    iteration: useAutoResearchStore.getState().currentIteration,
    primaryMetric: input.metricName,
    direction: useAutoResearchStore.getState().metricDirection,
    timestamp: new Date().toISOString(),
    generator: 'agent',
    metricName: input.metricName,
    metricValue: null,
    status: 'FAILED',
    hypothesis: input.hypothesis,
    change: '',
    reasoning: input.reasoning,
    artifactPaths: [],
    failReason: input.failReason,
  };

  return input.budgetExhausted
    ? `${TOOL_BUDGET_EXHAUSTED_MARKER}\n${JSON.stringify(payload, null, 2)}`
    : JSON.stringify(payload, null, 2);
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

function buildConvergenceRetryPrompt(
  systemPrompt: string,
  maxRounds: number | null,
  allowedToolsOverride?: string[],
  hardConstraintLines: string[] = [],
): string {
  const store = useAutoResearchStore.getState();
  const allowedTools = allowedToolsOverride ?? buildAutoResearchToolCatalog(store.sshConfig);
  const limitLine = maxRounds
    ? `The previous attempt failed because it exceeded the tool-round budget (${maxRounds}).`
    : 'The previous attempt failed because it exceeded the tool-round budget.';
  const toolDetourGuard = store.sshConfig?.mode === 'local'
    ? 'Do not switch to SSH-only tools.'
    : 'Do not switch to local file tools.';
  const hardConstraintBlock = hardConstraintLines.length > 0
    ? `\n- ${hardConstraintLines.join('\n- ')}`
    : '';

  return `${systemPrompt}

## Strict Convergence Retry
- ${limitLine}
- Restart this SAME iteration from scratch.
- Use only these tools: ${allowedTools.join(', ')}.
- Do at most one batched inspection step before editing or running the experiment.
- Reserve the last ${TOOL_BUDGET_RESERVE} tool calls for reading metrics/logs, writing the final result, and cleanup.
- Run the expensive experiment command at most once in this iteration. If it fails, read logs/metrics and emit FAILED instead of retrying.
- If the environment is still unclear after that inspection step, immediately write ${getCurrentRunDir()?.metricsPath ?? 'metrics.json'} with status FAILED and failReason "Exceeded tool-round budget while inspecting environment", then emit EXPERIMENT_RESULT and stop.
- Do not keep exploring, do not ask for help, and ${toolDetourGuard}${hardConstraintBlock}`;
}

function buildRecoveryPrompt(
  systemPrompt: string,
  decision: AutoResearchReflectionDecision,
  failureKind: AutoResearchFailureKind,
  allowedToolsOverride?: string[],
  hardConstraintLines: string[] = [],
): string {
  const store = useAutoResearchStore.getState();
  const allowedTools = allowedToolsOverride ?? buildAutoResearchToolCatalog(store.sshConfig);
  const metricsPath = getCurrentRunDir()?.metricsPath ?? 'metrics.json';
  const nextCommand = decision.nextCommand ? `- If you run the experiment again, use this exact command: ${decision.nextCommand}` : '';
  const nextPlan = decision.nextPlan ? `- Recovery plan: ${decision.nextPlan}` : '';
  const toolLaneGuard = store.sshConfig?.mode === 'local'
    ? 'Stay on the local tool lane only: execute_command, read_file, write_file, create_directory, get_current_workspace. Do not call ssh_exec, ssh_read_file, or ssh_upload_file.'
    : 'Stay on the SSH tool lane only: ssh_exec, ssh_read_file, ssh_upload_file. Do not call execute_command, read_file, write_file, or create_directory.';
  const hardConstraintBlock = hardConstraintLines.length > 0
    ? `\n- ${hardConstraintLines.join('\n- ')}`
    : '';

  return `${systemPrompt}

## AutoResearch Recovery Plan
- Failure kind: ${failureKind}
- Reflection decision: ${decision.action}
- Summary: ${decision.summary}
${decision.rootCause ? `- Root cause: ${decision.rootCause}` : ''}
- Allowed tools for this retry: ${allowedTools.join(', ')}.
${nextCommand}
${nextPlan}
- Before finishing the retry, write ${metricsPath} with a single valid JSON object matching the metrics contract, even on FAILED/null-metric outcomes.
- Do not repeat the failed command/tool choice if a better recovery path is already specified above.
- Reserve the last ${TOOL_BUDGET_RESERVE} tool calls for metrics/log reads, final result writing, and rollback/cleanup.
- If the expensive experiment command already failed once in this iteration, do not patch and rerun it. Read logs/metrics and finalize FAILED.
- ${toolLaneGuard}${hardConstraintBlock}
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
    if (!stderr && parsed.error === true) {
      const message = typeof parsed.message === 'string' ? parsed.message : null;
      const cause = typeof parsed.cause === 'string' ? parsed.cause : null;
      stderr = [message, cause].filter((value): value is string => Boolean(value)).join(' | ') || call.result;
    }
    const rawExitCode = parsed.exitCode ?? parsed.exit_code;
    exitCode = typeof rawExitCode === 'number'
      ? rawExitCode
      : parsed.error === true
        ? 1
        : null;
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

function emitToolBudgetEvent(summary: ToolBudgetSummary | undefined): void {
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

async function persistReflectionDecision(
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
  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    const agentConfig = fixedAgentConfig ?? resolveActiveAgentConfig();
    const reflectionConfig = options.reflectionConfig ?? agentConfig;
    const validationIssues = validateResolvedAgentConfig(agentConfig);
    if (validationIssues.length > 0) {
      throw new Error(formatAgentConfigValidationError(agentConfig, validationIssues));
    }

    const turnMessages = [
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
    const baseAllowedTools = buildAutoResearchToolCatalog(store.sshConfig);
    let toolLanePhase: AutoResearchRunPhase = 'READ_CONTEXT';
    const currentRunDir = getCurrentRunDir();
    const effectiveWorkDir = store.sshConfig?.mode === 'local'
      ? (currentRunDir?.codeDir || workDir)
      : workDir;
    const disabledToolAttemptCounts = new Map<string, number>();
    const blockedTools = new Set<string>();
    let retryConstraintState = buildAutoResearchRetryConstraintState({
      allowedTools: baseAllowedTools,
      blockedTools,
      environmentSummary: options.environmentSummary,
    });
    let consecutiveApiRequestFailures = 0;

    while (true) {
      const toolCallsById = new Map<string, {
        name: string;
        command?: string;
        argumentsText: string;
        path?: string;
        phase?: AutoResearchRunPhase;
      }>();
      const toolResults: AutoResearchObservedToolResult[] = [];
      const failedCommands: string[] = [];
      let reasoningBuffer = '';
      let reasoningFlushed = false;

      const flushBufferedReasoning = (fallbackReasoning?: string) => {
        if (!reasoningBuffer && fallbackReasoning) {
          reasoningBuffer = fallbackReasoning;
        }

        const reasoningText = reasoningBuffer.trim();
        if (!reasoningText || reasoningFlushed) {
          return;
        }

        useAutoResearchStore.getState().appendLiveOutput(`[thinking]\n${reasoningText}\n`);
        emitAutoResearchRuntimeEvent({
          level: 'debug',
          phase: 'PLAN_HYPOTHESIS',
          type: 'thinking',
          message: reasoningText,
          summary: previewFirstLines(reasoningText, 2) || 'Thinking',
          detail: reasoningText,
        });
        emitAutoResearchRuntimeEvent({
          level: 'info',
          phase: 'PLAN_HYPOTHESIS',
          type: 'agent_plan',
          message: previewFirstLines(reasoningText, 6) || 'Agent plan recorded.',
          summary: previewFirstLines(reasoningText, 2) || 'Agent plan recorded.',
          detail: reasoningText,
        });
        reasoningFlushed = true;
      };

      try {
        adapterSessionCounter++;
        const attemptSessionId = `autoresearch-${adapterSessionCounter}-${Date.now()}`;
        const result = await runHeadlessAgentTurn({
          sessionId: attemptSessionId,
          initialMessages: [...turnMessages, ...retryConstraintState.retryMessages],
          systemPrompt: attemptPrompt,
          workDir: effectiveWorkDir,
          agentConfig: agentConfig!,
          allowedTools: retryConstraintState.allowedTools,
          toolExecutionSource: 'autoresearch_phase',
          onTextDelta: (chunk) => {
            useAutoResearchStore.getState().appendLiveOutput(chunk);
          },
          onReasoningDelta: (chunk) => {
            reasoningBuffer += chunk;
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
          allowToolExecution: (call) => {
            const command = parseToolCommand(call);
            const nextPhase = classifyAutoResearchToolPhase({
              currentPhase: toolLanePhase,
              toolName: call.name,
              isExperimentRun: isExperimentRunCommand(command, options.environmentSummary),
              config: useAutoResearchStore.getState().sshConfig,
            });
            const phaseAllowedTools = getAutoResearchAllowedToolsForPhase(
              useAutoResearchStore.getState().sshConfig,
              nextPhase,
            );

            if (!phaseAllowedTools.includes(call.name)) {
              return {
                allowed: false,
                reason: buildAutoResearchToolLaneError(call.name, nextPhase, phaseAllowedTools),
              };
            }

            if (!isAutoResearchToolLaneTransitionAllowed(toolLanePhase, nextPhase)) {
              return {
                allowed: false,
                reason: `Tool lane transition ${toolLanePhase} -> ${nextPhase} is not allowed in the same iteration.`,
              };
            }

            toolLanePhase = nextPhase;
            return { allowed: true };
          },
          onToolCall: async (call) => {
            const command = parseToolCommand(call);
            const path = readToolPath(call.arguments);
            const parameterSummary = summarizeToolInput(call.arguments);
            const toolPhase = classifyAutoResearchToolPhase({
              currentPhase: toolLanePhase,
              toolName: call.name,
              isExperimentRun: isExperimentRunCommand(command, options.environmentSummary),
              config: useAutoResearchStore.getState().sshConfig,
            });
            toolCallsById.set(call.id, {
              name: call.name,
              command,
              argumentsText: call.arguments,
              path,
              phase: toolPhase,
            });
            if (toolPhase === 'RUN_EXPERIMENT') {
              setAutoResearchPhase('RUN_EXPERIMENT', {
                summary: `Running experiment command for iteration ${useAutoResearchStore.getState().currentIteration}.`,
              });
              useAutoResearchStore.getState().patchIterationRecord({
                iteration: useAutoResearchStore.getState().currentIteration,
                executionCommand: command,
              });
              emitAutoResearchRuntimeEvent({
                level: 'info',
                phase: 'RUN_EXPERIMENT',
                type: 'experiment_command_started',
                message: command,
                summary: parameterSummary,
                metadata: {
                  toolName: call.name,
                  command,
                },
              });
            } else {
              setAutoResearchPhase(toolPhase, {
                summary: `Tool ${call.name} is running in ${toolPhase}.`,
              });
            }
            emitAutoResearchRuntimeEvent({
              level: 'info',
              phase: toolPhase,
              type: 'tool_call_started',
              message: `${call.name} started.`,
              summary: parameterSummary,
              metadata: {
                toolName: call.name,
                arguments: call.arguments,
                command,
                path,
                phase: toolPhase,
                parameterSummary,
              },
            });
            await appendIterationTranscript(
              `\n## Tool Call: ${call.name}\n\`\`\`json\n${call.arguments || '{}'}\n\`\`\`\n`,
            );
          },
          onToolResult: async (call) => {
            const toolCall = toolCallsById.get(call.id);
            const observed = parseToolResult(call, toolCall?.command);
            toolResults.push(observed);
            if (observed.command && ((typeof observed.exitCode === 'number' && observed.exitCode !== 0) || observed.stderr)) {
              failedCommands.push(observed.command);
            }
            const toolFailed = (typeof observed.exitCode === 'number' && observed.exitCode !== 0) || Boolean(observed.stderr);
            const toolPhase = toolCall?.phase ?? classifyAutoResearchToolPhase({
              currentPhase: toolLanePhase,
              toolName: call.name,
              isExperimentRun: isExperimentRunCommand(observed.command, options.environmentSummary),
              config: useAutoResearchStore.getState().sshConfig,
            });
            emitAutoResearchRuntimeEvent({
              level: toolFailed ? 'warn' : 'info',
              phase: toolPhase,
              type: toolFailed ? 'tool_call_failed' : 'tool_call_completed',
              message: `${call.name} ${toolFailed ? 'failed' : 'completed'}.`,
              summary: toolFailed
                ? (observed.stderr || `Exit code ${observed.exitCode ?? 'unknown'}`)
                : `${call.name} completed in ${call.durationMs} ms.`,
              metadata: {
                toolName: call.name,
                command: observed.command,
                durationMs: call.durationMs,
                exitCode: observed.exitCode,
                phase: toolPhase,
                path: toolCall?.path,
              },
            });
            emitAutoResearchRuntimeEvent({
              level: toolFailed ? 'warn' : 'debug',
              phase: toolPhase,
              type: 'tool_result',
              message: previewFirstLines(call.result, 10) || '(empty tool result)',
              summary: `${call.name} output`,
              detail: call.result,
              metadata: {
                toolName: call.name,
                durationMs: call.durationMs,
                exitCode: observed.exitCode,
              },
            });
            if (toolCall?.path && !toolFailed && ['write_file', 'ssh_upload_file'].includes(call.name)) {
              emitAutoResearchRuntimeEvent({
                level: 'info',
                phase: 'EDIT_CODE',
                type: 'file_changed',
                message: toolCall.path,
                summary: `Updated ${toolCall.path}`,
                metadata: {
                  toolName: call.name,
                  path: toolCall.path,
                },
              });
            }
            if (observed.command && isExperimentRunCommand(observed.command, options.environmentSummary)) {
              useAutoResearchStore.getState().patchIterationRecord({
                iteration: useAutoResearchStore.getState().currentIteration,
                executionCommand: observed.command,
                exitCode: observed.exitCode,
                durationMs: call.durationMs,
              });
              emitAutoResearchRuntimeEvent({
                level: toolFailed ? 'warn' : 'info',
                phase: 'RUN_EXPERIMENT',
                type: 'experiment_command_completed',
                message: observed.command,
                summary: toolFailed
                  ? `Experiment command failed${typeof observed.exitCode === 'number' ? ` with exit code ${observed.exitCode}` : ''}.`
                  : 'Experiment command completed.',
                metadata: {
                  toolName: call.name,
                  command: observed.command,
                  durationMs: call.durationMs,
                  exitCode: observed.exitCode,
                  stderrPreview: observed.stderr ? previewFirstLines(observed.stderr, 10) : undefined,
                },
              });
            }
            await appendIterationTranscript(
              `\n## Tool Result: ${call.name} (${call.durationMs}ms)\n\`\`\`text\n${truncateTranscriptResult(call.result)}\n\`\`\`\n`,
            );
          },
        });

        flushBufferedReasoning(result.finalReasoning);
        emitToolBudgetEvent(result.toolBudgetSummary);
        emitBudgetNearLimitEvent(result.toolBudgetSummary);
        consecutiveApiRequestFailures = 0;
        assistantText = result.finalText;
        lastError = undefined;
        break;
      } catch (error) {
        flushBufferedReasoning();
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
            assistantText = buildIterationFailureOutput({
              metricName: options.metricName ?? store.metricName,
              failReason,
              hypothesis: 'provider request repeatedly failed before execution completed',
              reasoning: failReason,
            });
            lastError = undefined;
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
            const failReason = isToolRoundLimitError(error)
              ? TOOL_BUDGET_EXHAUSTION_FAIL_REASON
              : experimentFailure?.stderr?.trim()
                || decision.userMessage
                || decision.summary;
            const reasoning = isToolRoundLimitError(error)
              ? `${decision.summary}${decision.rootCause ? ` Root cause: ${decision.rootCause}` : ''}`.trim()
              : experimentFailure?.stderr?.trim()
                || decision.summary
                || formatError(error);

            assistantText = buildIterationFailureOutput({
              metricName: options.metricName ?? storeState.metricName,
              failReason,
              hypothesis: isToolRoundLimitError(error)
                ? 'tool budget exhausted before evaluation completed'
                : 'experiment command failed before evaluation completed',
              reasoning,
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
            attemptPrompt = decision.action === 'switch_command'
              ? buildRecoveryPrompt(
                systemPrompt,
                decision,
                failureKind,
                retryConstraintState.allowedTools,
                retryConstraintState.hardConstraintLines,
              )
              : (isToolRoundLimitError(error)
                ? buildRecoveryPrompt(
                  buildConvergenceRetryPrompt(
                    systemPrompt,
                    getToolRoundLimit(error),
                    retryConstraintState.allowedTools,
                    retryConstraintState.hardConstraintLines,
                  ),
                  decision,
                  failureKind,
                  retryConstraintState.allowedTools,
                  retryConstraintState.hardConstraintLines,
                )
                : buildRecoveryPrompt(
                  systemPrompt,
                  decision,
                  failureKind,
                  retryConstraintState.allowedTools,
                  retryConstraintState.hardConstraintLines,
                ));
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
