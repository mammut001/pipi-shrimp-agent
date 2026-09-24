import { useAutoResearchStore } from '@/store/autoresearchStore';
import { getRemainingToolBudget, type ToolBudgetSummary } from '@/services/tools/toolBudget';
import { extractErrorDetails } from '@/utils/errorFormat';
import type { AutoResearchFailureKind } from './errors';
import type { AutoResearchObservedToolResult, AutoResearchReflectionDecision, AutoResearchReflectionDecisionResult } from './reflection';
import { appendTargetText, writeTargetText } from './runDir';
import { getCurrentRunDir } from './terminalRunner';
import type { AutoResearchEnvironmentSummary } from './preflight';
import { buildAutoResearchToolCatalog } from './toolCatalog';
import type { AutoResearchRunPhase } from './history';

export const TOOL_BUDGET_RESERVE = 4;
export const TOOL_BUDGET_EXHAUSTED_MARKER = '__AUTORESEARCH_TOOL_BUDGET_EXHAUSTED__';

export interface AutoResearchRetryConstraintState {
  allowedTools: string[];
  retryMessages: Array<{ role: 'user'; content: string }>;
  hardConstraintLines: string[];
}

export function truncateTranscriptResult(result: string, limit = 4000): string {
  if (result.length <= limit) {
    return result;
  }
  return `${result.slice(0, limit)}\n...[truncated ${result.length - limit} chars]`;
}

export function previewFirstLines(text: string, maxLines = 10): string {
  return text
    .split('\n')
    .slice(0, maxLines)
    .join('\n')
    .trim();
}

export function summarizeToolInput(argumentsText: string): string {
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

export function readToolPath(argumentsText: string): string | undefined {
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

export function emitBudgetNearLimitEvent(summary: ToolBudgetSummary | undefined): void {
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

export function isExperimentRunCommand(command: string | undefined, environmentSummary?: AutoResearchEnvironmentSummary): boolean {
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

export function getLatestExperimentFailure(
  toolResults: AutoResearchObservedToolResult[],
  environmentSummary?: AutoResearchEnvironmentSummary,
): AutoResearchObservedToolResult | null {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const result = toolResults[index];
    const failed = Boolean(result.stderr) || (typeof result.exitCode === 'number' && result.exitCode !== 0);
    if (!failed) {
      continue;
    }
    if (
      isExperimentRunCommand(result.command, environmentSummary)
      || /\brun_experiment\.py\b/.test(result.command ?? '')
    ) {
      return result;
    }
  }
  return null;
}

export function isReflectionParserFailure(result: AutoResearchReflectionDecisionResult | null): boolean {
  return Boolean(result && result.parserPath === null && result.parseFailedAttempts.length > 0);
}

function isDisabledToolFailure(result: AutoResearchObservedToolResult): boolean {
  return (result.stderr ?? '').includes('disabled for this AutoResearch run');
}

export function recordDisabledToolAttempts(
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

export function isApiRequestFailure(error: unknown): boolean {
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

export function buildIterationFailureOutput(input: {
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

export async function writeIterationTranscriptHeader(userMessage: string): Promise<void> {
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

export async function appendIterationTranscript(section: string): Promise<void> {
  const state = useAutoResearchStore.getState();
  const runDir = getCurrentRunDir();
  if (!state.sshConfig || !runDir) {
    return;
  }

  await appendTargetText(state.sshConfig, runDir.transcriptPath, section);
}

export function buildConvergenceRetryPrompt(
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

export function buildRecoveryPrompt(
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
    ? 'Stay on the local tool lane only: execute_command, read_file, write_file, create_directory, get_current_workspace. On Windows, respect the active shell profile: use PowerShell for Windows paths, npm/Cargo/Tauri Windows builds, and WSL only for WSL/Linux workspaces or explicit bash workflows. Do not call ssh_exec, ssh_read_file, or ssh_upload_file.'
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

export function getRecentEventSummaries(): string[] {
  const state = useAutoResearchStore.getState() as ReturnType<typeof useAutoResearchStore.getState> & {
    runHistory?: Array<{ id: string; events: Array<{ phase: string; message: string }> }>;
    id?: string;
  };
  const currentRun = state.runHistory?.find((run) => run.id === state.id);
  return (currentRun?.events ?? [])
    .slice(-6)
    .map((event) => `${event.phase}: ${event.message}`);
}
