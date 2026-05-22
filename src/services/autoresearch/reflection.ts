import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { buildResolvedChatRequest } from '@/services/resolvedChatRequest';
import { getCapability } from '@/services/llm/capabilities';
import { invokeRustAPIStream } from '@/core/streamAdapter';
import { extractErrorDetails } from '@/utils/errorFormat';
import type { AutoResearchEnvironmentSummary } from './preflight';
import { buildAutoResearchToolCatalog } from './toolCatalog';
import {
  formatError,
  getToolRoundLimit,
  isCommandNotFoundText,
  isRateLimitError,
  isToolRoundLimitError,
} from './errors';

export type AutoResearchReflectionAction =
  | 'continue'
  | 'finish'
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

export type AutoResearchReflectionParserPath = 'json' | 'json_block' | 'markdown_heading' | 'first_paragraph';

export interface AutoResearchReflectionRequestMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AutoResearchReflectionContractPayload {
  summary: string;
  decision: 'continue' | 'mark_iteration_failed' | 'finish';
  next_action: string;
}

export interface AutoResearchReflectionParseFailureAttempt {
  retryCount: number;
  rawText: string;
  preview: string;
}

export interface AutoResearchReflectionDecisionResult {
  decision: AutoResearchReflectionDecision;
  rawText: string;
  parserPath: AutoResearchReflectionParserPath | null;
  retryCount: number;
  request: {
    systemPrompt: string;
    messages: AutoResearchReflectionRequestMessage[];
    responseFormat: { type: 'json_object' } | null;
  };
  parseFailedAttempts: AutoResearchReflectionParseFailureAttempt[];
}

export class AutoResearchReflectionFailureError extends Error {
  readonly decisionResult: AutoResearchReflectionDecisionResult;

  constructor(message: string, decisionResult: AutoResearchReflectionDecisionResult) {
    super(message);
    this.name = 'AutoResearchReflectionFailureError';
    this.decisionResult = decisionResult;
  }
}

export function isAutoResearchReflectionFailureError(error: unknown): error is AutoResearchReflectionFailureError {
  return error instanceof AutoResearchReflectionFailureError;
}

const MAX_OBJECTIVE_CHARS = 700;
const MAX_CONTEXT_CHARS = 400;
const MAX_COMMAND_CHARS = 240;
const MAX_EVENT_COUNT = 6;
const MAX_TOOL_RESULT_COUNT = 4;
const MAX_REFLECTION_RETRIES = 2;
const INVALID_JSON_RETRY_PROMPT = 'Your previous output was not valid JSON matching the required schema. Output ONLY the JSON object, no prose.';
const LOCAL_ALLOWED_TOOLS = new Set(buildAutoResearchToolCatalog({ mode: 'local' }));
const SSH_ALLOWED_TOOLS = new Set(buildAutoResearchToolCatalog({ mode: 'ssh' }));

function sanitizeSensitiveText(value: string, maxChars: number): string {
  const truncated = value.length > maxChars
    ? `${value.slice(0, Math.max(0, maxChars - 16))}...[truncated]`
    : value;

  return truncated
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, '$1[redacted]')
    .replace(/(x-api-key\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(api[_ -]?key\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(token\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/)[^\s"']+/ig, '$1[redacted]')
    .replace(/((?:database_url|db_uri|redis_url|mongodb_uri|postgres_url|mysql_url)\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DB_URI)[A-Z0-9_]*)\s*[:=]\s*)[^\s"']+/g, '$1[redacted]');
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

function parseAllowedToolsFromDisabledMessage(text: string): Set<string> {
  const match = text.match(/Allowed tools:\s*(.+)$/i);
  if (!match) {
    return new Set();
  }

  return new Set(
    match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function setHasIntersection(source: Set<string>, target: Set<string>): boolean {
  for (const value of source) {
    if (target.has(value)) {
      return true;
    }
  }
  return false;
}

function isLocalLaneTool(tool?: string): boolean {
  return typeof tool === 'string' && LOCAL_ALLOWED_TOOLS.has(tool);
}

function isSshLaneTool(tool?: string): boolean {
  return typeof tool === 'string' && SSH_ALLOWED_TOOLS.has(tool);
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

function buildReflectionParseFailurePreview(text: string): string {
  const compact = compactWhitespace(text || '');
  if (!compact) {
    return '<empty>';}
  return compact.length <= 200 ? compact : `${compact.slice(0, 200)}...`;
}

function extractFirstBalancedJsonObject(text: string): string | null {
  const source = text.trim();
  if (!source) {
    return null;
  }

  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function normalizeContractPayload(candidate: unknown): AutoResearchReflectionContractPayload | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const summary = sanitizeString(record.summary, MAX_OBJECTIVE_CHARS);
  const decision = typeof record.decision === 'string' ? record.decision : null;
  const nextAction = typeof record.next_action === 'string'
    ? sanitizeSensitiveText(compactWhitespace(record.next_action), MAX_CONTEXT_CHARS)
    : typeof record.nextAction === 'string'
      ? sanitizeSensitiveText(compactWhitespace(record.nextAction), MAX_CONTEXT_CHARS)
      : '';

  if (!summary || !decision || !['continue', 'mark_iteration_failed', 'finish'].includes(decision)) {
    return null;
  }

  return {
    summary,
    decision: decision as AutoResearchReflectionContractPayload['decision'],
    next_action: nextAction,
  };
}

function parseReflectionJson(text: string): AutoResearchReflectionContractPayload | null {
  try {
    return normalizeContractPayload(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function extractMarkdownSummary(text: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const inlineMatch = line.match(/^summary\s*:\s*(.+)$/i);
    if (inlineMatch) {
      return sanitizeString(inlineMatch[1], MAX_OBJECTIVE_CHARS) || null;
    }

    if (!/^#{2,3}\s*summary\s*$/i.test(line) && !/^summary\s*:\s*$/i.test(line)) {
      continue;
    }

    const contentLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (/^#{1,6}\s+/.test(candidate.trim())) {
        break;
      }
      contentLines.push(candidate);
    }

    const summary = sanitizeString(contentLines.join('\n'), MAX_OBJECTIVE_CHARS);
    if (summary) {
      return summary;
    }
  }

  return null;
}

function extractFirstParagraph(text: string): string | null {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => compactWhitespace(paragraph))
    .filter(Boolean);

  return paragraphs.length > 0
    ? sanitizeSensitiveText(paragraphs[0], MAX_OBJECTIVE_CHARS)
    : null;
}

function toReflectionDecision(
  payload: AutoResearchReflectionContractPayload,
  parserPath: AutoResearchReflectionParserPath,
): AutoResearchReflectionDecision {
  const confidence = parserPath === 'json'
    ? 'high'
    : parserPath === 'json_block'
      ? 'medium'
      : 'low';

  return {
    action: payload.decision,
    summary: payload.summary,
    nextPlan: payload.next_action || undefined,
    userMessage: payload.decision === 'mark_iteration_failed' ? payload.summary : undefined,
    shouldRetry: payload.decision === 'continue',
    confidence,
  };
}

export function parseReflectionDecisionText(text: string): {
  decision: AutoResearchReflectionDecision;
  parserPath: AutoResearchReflectionParserPath;
  payload: AutoResearchReflectionContractPayload;
} | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const directJson = parseReflectionJson(trimmed);
  if (directJson) {
    return {
      decision: toReflectionDecision(directJson, 'json'),
      parserPath: 'json',
      payload: directJson,
    };
  }

  const jsonBlock = extractFirstBalancedJsonObject(trimmed);
  if (jsonBlock) {
    const parsed = parseReflectionJson(jsonBlock);
    if (parsed) {
      return {
        decision: toReflectionDecision(parsed, 'json_block'),
        parserPath: 'json_block',
        payload: parsed,
      };
    }
  }

  const markdownSummary = extractMarkdownSummary(trimmed);
  if (markdownSummary) {
    const payload: AutoResearchReflectionContractPayload = {
      summary: markdownSummary,
      decision: 'continue',
      next_action: '',
    };
    return {
      decision: toReflectionDecision(payload, 'markdown_heading'),
      parserPath: 'markdown_heading',
      payload,
    };
  }

  const firstParagraph = extractFirstParagraph(trimmed);
  if (firstParagraph) {
    const payload: AutoResearchReflectionContractPayload = {
      summary: firstParagraph,
      decision: 'continue',
      next_action: '',
    };
    return {
      decision: toReflectionDecision(payload, 'first_paragraph'),
      parserPath: 'first_paragraph',
      payload,
    };
  }

  return null;
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
    'Diagnose why the current AutoResearch iteration is stuck and decide whether the loop should continue, fail the iteration, or finish.',
    'Return EXACTLY one JSON object with this shape and no extra text:',
    '{"summary": string, "decision": "continue"|"mark_iteration_failed"|"finish", "next_action": string}',
    'Rules:',
    '- Output JSON only. No markdown, no prose, no code fences.',
    '- summary must be a short, concrete sentence.',
    '- decision must be one of continue, mark_iteration_failed, finish.',
    '- next_action must be a short action string. Use an empty string if there is no next action.',
    '- Do not include any keys other than summary, decision, next_action.',
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
  const allowedTools = parseAllowedToolsFromDisabledMessage(stderr);

  if (stderr.includes('disabled for this AutoResearch run')) {
    const localLaneAllowed = setHasIntersection(allowedTools, LOCAL_ALLOWED_TOOLS) || isLocalLaneTool(failedToolResult.tool);
    const sshLaneAllowed = setHasIntersection(allowedTools, SSH_ALLOWED_TOOLS) || isSshLaneTool(failedToolResult.tool);

    if (localLaneAllowed && !sshLaneAllowed) {
      return {
        action: 'retry_with_plan',
        summary: 'The previous attempt drifted onto SSH-only tools during a local AutoResearch run.',
        rootCause: 'disallowed ssh tool usage',
        nextPlan: 'Use execute_command for the experiment command and read_file/write_file/create_directory for file access. Do not call ssh_exec, ssh_read_file, or ssh_upload_file.',
        shouldRetry: true,
        confidence: 'high',
      };
    }

    if (sshLaneAllowed && !localLaneAllowed) {
      return {
        action: 'retry_with_plan',
        summary: 'The previous attempt drifted onto local-only tools during an SSH AutoResearch run.',
        rootCause: 'disallowed local tool usage',
        nextPlan: 'Use ssh_exec for the experiment command and ssh_read_file/ssh_upload_file for file access. Do not call execute_command, read_file, write_file, or create_directory.',
        shouldRetry: true,
        confidence: 'high',
      };
    }
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
): Promise<AutoResearchReflectionDecisionResult> {
  const compactInput = buildCompactReflectionInput(input);
  const capability = getCapability(agentConfig.provider);
  const systemPrompt = buildReflectionSystemPrompt();
  const requestMessages: AutoResearchReflectionRequestMessage[] = [
    {
      role: 'user',
      content: JSON.stringify(compactInput, null, 2),
    },
  ];
  const parseFailedAttempts: AutoResearchReflectionParseFailureAttempt[] = [];
  const responseFormat = capability.jsonMode
    ? { type: 'json_object' as const }
    : null;

  for (let attempt = 0; attempt <= MAX_REFLECTION_RETRIES; attempt += 1) {
    const sessionId = `autoresearch-reflection-${Date.now()}-${attempt}`;
    const request = buildResolvedChatRequest(agentConfig, {
      messages: requestMessages as unknown as Record<string, unknown>[],
      systemPrompt,
      sessionId,
      allowBrowserTools: false,
      noTools: true,
      responseFormat: responseFormat ?? undefined,
    });

    let text = '';
    for await (const chunk of invokeRustAPIStream(request.params)) {
      if (chunk.type === 'text_delta') {
        text += chunk.content;
      }
    }

    const parsed = parseReflectionDecisionText(text);
    if (parsed) {
      return {
        decision: parsed.decision,
        rawText: text,
        parserPath: parsed.parserPath,
        retryCount: attempt,
        request: {
          systemPrompt,
          messages: requestMessages.map((message) => ({ ...message })),
          responseFormat,
        },
        parseFailedAttempts,
      };
    }

    parseFailedAttempts.push({
      retryCount: attempt,
      rawText: text,
      preview: buildReflectionParseFailurePreview(text),
    });

    if (attempt < MAX_REFLECTION_RETRIES) {
      requestMessages.push({
        role: 'user',
        content: INVALID_JSON_RETRY_PROMPT,
      });
      continue;
    }

    const summary = 'Reflection did not provide a summary.';
    return {
      decision: {
        action: 'mark_iteration_failed',
        summary,
        rootCause: `Reflection output could not be parsed after ${MAX_REFLECTION_RETRIES + 1} attempts.`,
        userMessage: summary,
        shouldRetry: false,
        confidence: 'low',
      },
      rawText: text,
      parserPath: null,
      retryCount: attempt,
      request: {
        systemPrompt,
        messages: requestMessages.map((message) => ({ ...message })),
        responseFormat,
      },
      parseFailedAttempts,
    };
  }

  return {
    decision: {
      action: 'mark_iteration_failed',
      summary: 'Reflection did not provide a summary.',
      rootCause: 'Reflection retries exhausted unexpectedly.',
      userMessage: 'Reflection did not provide a summary.',
      shouldRetry: false,
      confidence: 'low',
    },
    rawText: '',
    parserPath: null,
    retryCount: MAX_REFLECTION_RETRIES,
    request: {
      systemPrompt,
      messages: requestMessages.map((message) => ({ ...message })),
      responseFormat,
    },
    parseFailedAttempts,
  };
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
