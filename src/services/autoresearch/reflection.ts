import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import { invokeRustAPIStream } from '@/core/streamAdapter';
import { extractErrorDetails } from '@/utils/errorFormat';
import type { AutoResearchEnvironmentSummary } from './preflight';
import {
  formatError,
  getToolRoundLimit,
  isCommandNotFoundText,
  isRateLimitError,
  isToolRoundLimitError,
} from './errors';

export type AutoResearchReflectionAction =
  | 'continue'
  | 'retry_with_plan'
  | 'switch_command'
  | 'stop_environment_error'
  | 'stop_rate_limited'
  | 'stop_tool_exhausted'
  | 'mark_iteration_failed'
  | 'ask_user';

export interface AutoResearchObservedToolResult {
  tool: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

export interface AutoResearchReflectionInput {
  objective: string;
  metric: string;
  direction: 'higher' | 'lower';
  cwd: string;
  iteration: number;
  maxIterations: number;
  preflightSummary?: string;
  environmentSummary?: string;
  recommendedCommand?: string;
  detectedPythonCommand?: string;
  recentEvents: string[];
  recentToolResults: AutoResearchObservedToolResult[];
  failedCommands: string[];
  lastError?: string;
  remainingToolBudget?: number;
}

export interface AutoResearchReflectionDecision {
  action: AutoResearchReflectionAction;
  summary: string;
  rootCause?: string;
  nextCommand?: string;
  nextPlan?: string;
  userMessage?: string;
  shouldRetry: boolean;
  confidence: 'low' | 'medium' | 'high';
}

const MAX_OBJECTIVE_CHARS = 700;
const MAX_CONTEXT_CHARS = 400;
const MAX_COMMAND_CHARS = 240;
const MAX_EVENT_COUNT = 6;
const MAX_TOOL_RESULT_COUNT = 4;

function sanitizeSensitiveText(value: string, maxChars: number): string {
  const truncated = value.length > maxChars
    ? `${value.slice(0, Math.max(0, maxChars - 16))}...[truncated]`
    : value;

  return truncated
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, '$1[redacted]')
    .replace(/(x-api-key\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(api[_ -]?key\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(token\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]');
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const compact = compactWhitespace(value);
  return compact ? sanitizeSensitiveText(compact, maxChars) : undefined;
}

function extractFirstSection(source: string, startHeading: string, endHeading?: string): string {
  const startIndex = source.indexOf(startHeading);
  if (startIndex < 0) {
    return '';
  }
  const tail = source.slice(startIndex + startHeading.length);
  const endIndex = endHeading ? tail.indexOf(endHeading) : -1;
  return (endIndex >= 0 ? tail.slice(0, endIndex) : tail).trim();
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) {
    return null;
  }
  return trimmed.slice(first, last + 1);
}

function normalizeDecision(candidate: unknown): AutoResearchReflectionDecision {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Reflection returned an invalid JSON payload.');
  }

  const record = candidate as Record<string, unknown>;
  const action = typeof record.action === 'string' ? record.action as AutoResearchReflectionAction : 'mark_iteration_failed';
  const summary = sanitizeString(record.summary, MAX_OBJECTIVE_CHARS) || 'Reflection did not provide a summary.';
  const shouldRetry = Boolean(record.shouldRetry);
  const confidence = record.confidence === 'high' || record.confidence === 'medium' || record.confidence === 'low'
    ? record.confidence
    : 'low';

  return {
    action,
    summary,
    rootCause: sanitizeString(record.rootCause, MAX_CONTEXT_CHARS),
    nextCommand: sanitizeString(record.nextCommand, MAX_COMMAND_CHARS),
    nextPlan: sanitizeString(record.nextPlan, MAX_CONTEXT_CHARS),
    userMessage: sanitizeString(record.userMessage, MAX_CONTEXT_CHARS),
    shouldRetry,
    confidence,
  };
}

function formatEnvironmentSummary(summary?: AutoResearchEnvironmentSummary): string | undefined {
  if (!summary) {
    return undefined;
  }
  return [
    `experimentDir=${summary.experimentDir}`,
    `git=${summary.repoStatus}`,
    `dirtyFiles=${summary.dirtyFileCount}`,
    `python=${summary.preferredPythonCommand || '<missing>'}`,
    `recommended=${summary.recommendedRunCommand}`,
  ].join('; ');
}

export function summarizePreflight(summary?: AutoResearchEnvironmentSummary): string | undefined {
  return formatEnvironmentSummary(summary);
}

export function extractCompactObjective(systemPrompt: string): string {
  const sessionSection = extractFirstSection(systemPrompt, '## Session File', '## Living AutoResearch Notes');
  return sanitizeString(sessionSection || systemPrompt, MAX_OBJECTIVE_CHARS) || 'AutoResearch experiment iteration';
}

export function buildCompactReflectionInput(
  input: AutoResearchReflectionInput,
): AutoResearchReflectionInput {
  return {
    objective: sanitizeString(input.objective, MAX_OBJECTIVE_CHARS) || 'AutoResearch experiment iteration',
    metric: sanitizeString(input.metric, 120) || 'metric',
    direction: input.direction,
    cwd: sanitizeString(input.cwd, MAX_CONTEXT_CHARS) || '',
    iteration: input.iteration,
    maxIterations: input.maxIterations,
    preflightSummary: sanitizeString(input.preflightSummary, MAX_CONTEXT_CHARS),
    environmentSummary: sanitizeString(input.environmentSummary, MAX_CONTEXT_CHARS),
    recommendedCommand: sanitizeString(input.recommendedCommand, MAX_COMMAND_CHARS),
    detectedPythonCommand: sanitizeString(input.detectedPythonCommand, 32),
    recentEvents: input.recentEvents
      .slice(-MAX_EVENT_COUNT)
      .map((item) => sanitizeString(item, MAX_CONTEXT_CHARS))
      .filter((item): item is string => Boolean(item)),
    recentToolResults: input.recentToolResults
      .slice(-MAX_TOOL_RESULT_COUNT)
      .map((item) => ({
        tool: sanitizeString(item.tool, 60) || 'unknown',
        command: sanitizeString(item.command, MAX_COMMAND_CHARS),
        stdout: sanitizeString(item.stdout, MAX_CONTEXT_CHARS),
        stderr: sanitizeString(item.stderr, MAX_CONTEXT_CHARS),
        exitCode: typeof item.exitCode === 'number' || item.exitCode === null ? item.exitCode : undefined,
      })),
    failedCommands: input.failedCommands
      .slice(-MAX_TOOL_RESULT_COUNT)
      .map((item) => sanitizeString(item, MAX_COMMAND_CHARS))
      .filter((item): item is string => Boolean(item)),
    lastError: sanitizeString(input.lastError, MAX_CONTEXT_CHARS),
    remainingToolBudget: typeof input.remainingToolBudget === 'number' ? input.remainingToolBudget : undefined,
  };
}

function buildReflectionSystemPrompt(): string {
  return [
    'You are the AutoResearch recovery critic.',
    'You are not executing commands directly.',
    'Diagnose why the current AutoResearch iteration is stuck and choose the safest next action.',
    'Return JSON only.',
    'Do not provide hidden chain-of-thought.',
    'Allowed actions: continue, retry_with_plan, switch_command, stop_environment_error, stop_rate_limited, stop_tool_exhausted, mark_iteration_failed, ask_user.',
    'Rules:',
    '- If a command failed because it was not found, do not recommend repeating the same command.',
    '- If preflight detected python3 but the failed command used python, recommend switching to python3.',
    '- If no Python interpreter is available, stop with environment error.',
    '- If the issue is a provider rate limit, prefer a stop/wait decision over repeated retries.',
    '- Keep the next plan short, specific, and execution-focused.',
  ].join('\n');
}

export function buildFallbackReflectionDecision(
  input: AutoResearchReflectionInput,
  error: unknown,
): AutoResearchReflectionDecision {
  const compact = buildCompactReflectionInput(input);
  const lastToolError = compact.recentToolResults
    .slice()
    .reverse()
    .find((item) => item.stderr || (typeof item.exitCode === 'number' && item.exitCode !== 0));
  const lastError = compact.lastError || extractErrorDetails(error).message;
  const detail = lastToolError?.stderr || lastError;

  if (isRateLimitError(error)) {
    return {
      action: 'stop_rate_limited',
      summary: 'Provider rate limit prevented the iteration from completing.',
      rootCause: detail,
      userMessage: detail,
      shouldRetry: false,
      confidence: 'medium',
    };
  }

  if (isToolRoundLimitError(error)) {
    const limit = getToolRoundLimit(error);
    const limitSuffix = limit ? ` (${limit})` : '';
    return {
      action: 'stop_tool_exhausted',
      summary: `The agent exhausted the tool budget${limitSuffix} without producing the target metric.`,
      rootCause: detail,
      userMessage: detail,
      shouldRetry: false,
      confidence: 'medium',
    };
  }

  return {
    action: 'mark_iteration_failed',
    summary: 'The iteration failed after repeated command or agent execution errors.',
    rootCause: detail,
    userMessage: detail,
    shouldRetry: false,
    confidence: 'medium',
  };
}

export function getDeterministicRecoveryDecision(
  input: AutoResearchReflectionInput,
): AutoResearchReflectionDecision | null {
  const compact = buildCompactReflectionInput(input);
  const failedToolResult = compact.recentToolResults
    .slice()
    .reverse()
    .find((item) => item.stderr || (typeof item.exitCode === 'number' && item.exitCode !== 0));

  if (!failedToolResult) {
    return null;
  }

  const stderr = failedToolResult.stderr || '';
  const command = failedToolResult.command || compact.failedCommands.slice(-1)[0];
  const detectedPython = compact.detectedPythonCommand;

  if (failedToolResult.tool === 'execute_command' || stderr.includes('disabled for this AutoResearch run')) {
    return {
      action: 'retry_with_plan',
      summary: 'The agent attempted a disallowed local command tool. It must stay on the ssh_exec tool lane.',
      rootCause: 'disallowed local tool usage',
      nextPlan: 'Use ssh_exec for the experiment command and ssh_read_file/ssh_upload_file for file access. Do not call execute_command.',
      shouldRetry: true,
      confidence: 'high',
    };
  }

  if (isCommandNotFoundText(stderr) && command && /\bpython\b/.test(command) && detectedPython && detectedPython !== 'python') {
    return {
      action: 'switch_command',
      summary: `The failed command used python, but preflight detected ${detectedPython}.`,
      rootCause: 'python command not found',
      nextCommand: command.replace(/\bpython\b/g, detectedPython),
      nextPlan: `Retry the experiment with ${detectedPython} and do not repeat the failing python command.`,
      shouldRetry: true,
      confidence: 'high',
    };
  }

  if (isCommandNotFoundText(stderr) && (!detectedPython || detectedPython === '<missing>')) {
    return {
      action: 'stop_environment_error',
      summary: 'No usable Python interpreter is available in the experiment environment.',
      rootCause: 'missing Python interpreter',
      userMessage: '未检测到可用的 Python 解释器。请安装 Python，或在 AutoResearch 设置中配置 pythonCommand。',
      shouldRetry: false,
      confidence: 'high',
    };
  }

  return null;
}

export async function requestReflectionDecision(
  agentConfig: ResolvedAgentConfig,
  input: AutoResearchReflectionInput,
): Promise<AutoResearchReflectionDecision> {
  const compactInput = buildCompactReflectionInput(input);
  const sessionId = `autoresearch-reflection-${Date.now()}`;
  const request = buildResolvedChatRequest(agentConfig, {
    messages: [
      {
        role: 'user',
        content: JSON.stringify(compactInput, null, 2),
      },
    ],
    systemPrompt: buildReflectionSystemPrompt(),
    sessionId,
    allowBrowserTools: false,
    noTools: true,
  });

  let text = '';
  for await (const chunk of invokeRustAPIStream(request.params)) {
    if (chunk.type === 'text_delta') {
      text += chunk.content;
    }
  }

  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new Error(`Reflection returned non-JSON output: ${sanitizeSensitiveText(text, MAX_CONTEXT_CHARS)}`);
  }

  return normalizeDecision(JSON.parse(jsonText) as unknown);
}

export function buildReflectionInputFromState(input: {
  systemPrompt: string;
  metric: string;
  direction: 'higher' | 'lower';
  cwd: string;
  iteration: number;
  maxIterations: number;
  environmentSummary?: AutoResearchEnvironmentSummary;
  recentEvents: string[];
  recentToolResults: AutoResearchObservedToolResult[];
  failedCommands: string[];
  lastError?: string;
  remainingToolBudget?: number;
}): AutoResearchReflectionInput {
  return buildCompactReflectionInput({
    objective: extractCompactObjective(input.systemPrompt),
    metric: input.metric,
    direction: input.direction,
    cwd: input.cwd,
    iteration: input.iteration,
    maxIterations: input.maxIterations,
    preflightSummary: summarizePreflight(input.environmentSummary),
    environmentSummary: formatEnvironmentSummary(input.environmentSummary),
    recommendedCommand: input.environmentSummary?.recommendedRunCommand,
    detectedPythonCommand: input.environmentSummary?.preferredPythonCommand,
    recentEvents: input.recentEvents,
    recentToolResults: input.recentToolResults,
    failedCommands: input.failedCommands,
    lastError: input.lastError ? formatError(input.lastError) : undefined,
    remainingToolBudget: input.remainingToolBudget,
  });
}
