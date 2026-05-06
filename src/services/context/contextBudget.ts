import { extractErrorDetails } from '@/utils/errorFormat';

export interface ContextBudgetOptions {
  maxChars?: number;
  maxSingleReferenceChars?: number;
  maxToolOutputChars?: number;
  maxMessages?: number;
  strict?: boolean;
}

export interface BudgetedContextResult<TMessage = unknown> {
  messages: TMessage[];
  droppedCount: number;
  droppedReasons: string[];
  estimatedChars: number;
  wasPruned: boolean;
}

export interface BudgetedTextResult {
  text: string;
  droppedReasons: string[];
  estimatedChars: number;
  wasPruned: boolean;
}

const DEFAULT_CONTEXT_BUDGET = {
  maxChars: 120_000,
  maxSingleReferenceChars: 20_000,
  maxToolOutputChars: 12_000,
  maxMessages: 40,
} as const;

const STRICT_CONTEXT_BUDGET = {
  maxChars: 60_000,
  maxSingleReferenceChars: 12_000,
  maxToolOutputChars: 8_000,
  maxMessages: 20,
} as const;

const CONTEXT_OVERFLOW_PATTERNS = [
  /context compression check failed/i,
  /context too large/i,
  /maximum context length/i,
  /maximum context size/i,
  /token limit exceeded/i,
  /context window/i,
  /payload too large/i,
  /request entity too large/i,
  /input is too long/i,
  /too many tokens/i,
  /prompt is too long/i,
];

function resolveBudget(options?: ContextBudgetOptions) {
  const base = options?.strict ? STRICT_CONTEXT_BUDGET : DEFAULT_CONTEXT_BUDGET;
  return {
    maxChars: options?.maxChars ?? base.maxChars,
    maxSingleReferenceChars: options?.maxSingleReferenceChars ?? base.maxSingleReferenceChars,
    maxToolOutputChars: options?.maxToolOutputChars ?? base.maxToolOutputChars,
    maxMessages: options?.maxMessages ?? base.maxMessages,
  };
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, maxChars: number, note: string): string {
  if (value.length <= maxChars) {
    return value;
  }
  const suffix = `\n\n[${note}]`;
  const budget = Math.max(0, maxChars - suffix.length);
  return `${value.slice(0, budget)}${suffix}`;
}

function clampToolResultContent(content: string, maxChars: number): string {
  const match = content.match(/^(__TOOL_RESULT__:[^:]+:)([\s\S]*)$/);
  if (!match) {
    return truncateText(content, maxChars, 'tool output truncated');
  }
  const prefix = match[1];
  const truncatedBody = truncateText(match[2], Math.max(0, maxChars - prefix.length), 'tool output truncated');
  return `${prefix}${truncatedBody}`;
}

function clampToolCalls(toolCalls: unknown, maxChars: number): unknown {
  if (!Array.isArray(toolCalls)) {
    return toolCalls;
  }

  return toolCalls.map((toolCall) => {
    if (!toolCall || typeof toolCall !== 'object') {
      return toolCall;
    }
    const record = toolCall as Record<string, unknown>;
    const argumentsText = stringifyUnknown(record.arguments);
    if (argumentsText.length <= maxChars) {
      return toolCall;
    }
    return {
      ...record,
      arguments: truncateText(argumentsText, maxChars, 'tool arguments truncated'),
    };
  });
}

export function estimateContextChars(value: unknown): number {
  if (typeof value === 'string') {
    return value.length;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + estimateContextChars(item), 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((sum, item) => sum + estimateContextChars(item), 0);
  }
  return stringifyUnknown(value).length;
}

export function pruneTextForBudget(
  text: string,
  maxChars: number,
  label = 'content',
): BudgetedTextResult {
  if (text.length <= maxChars) {
    return {
      text,
      droppedReasons: [],
      estimatedChars: text.length,
      wasPruned: false,
    };
  }

  return {
    text: truncateText(text, maxChars, `${label} truncated`),
    droppedReasons: [`${label} exceeded budget`],
    estimatedChars: maxChars,
    wasPruned: true,
  };
}

export function pruneMessagesForBudget<TMessage extends Record<string, any>>(
  messages: TMessage[],
  options?: ContextBudgetOptions,
): BudgetedContextResult<TMessage> {
  const budget = resolveBudget(options);
  const droppedReasons: string[] = [];
  const recentMessages = messages.slice(-budget.maxMessages);

  if (recentMessages.length < messages.length) {
    droppedReasons.push('dropped older messages beyond maxMessages');
  }

  const normalizedMessages = recentMessages.map((message) => {
    const clone: Record<string, unknown> = { ...message };
    const content = stringifyUnknown(clone.content);
    const isToolOutput = typeof content === 'string' && content.startsWith('__TOOL_RESULT__:');
    const contentLimit = isToolOutput ? budget.maxToolOutputChars : budget.maxSingleReferenceChars;
    const nextContent = isToolOutput
      ? clampToolResultContent(content, contentLimit)
      : truncateText(content, contentLimit, 'message content truncated');

    if (nextContent !== content) {
      droppedReasons.push(isToolOutput ? 'truncated oversized tool output' : 'truncated oversized message content');
      clone.content = nextContent;
    }

    if (clone.tool_calls) {
      const nextToolCalls = clampToolCalls(clone.tool_calls, budget.maxSingleReferenceChars);
      if (JSON.stringify(nextToolCalls) !== JSON.stringify(clone.tool_calls)) {
        droppedReasons.push('truncated oversized tool arguments');
        clone.tool_calls = nextToolCalls;
      }
    }

    return clone as TMessage;
  });

  const kept: TMessage[] = [];
  let estimatedChars = 0;

  for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
    const message = normalizedMessages[index];
    const messageChars = estimateContextChars(message);
    const mustKeep = index === normalizedMessages.length - 1;
    if (mustKeep || estimatedChars + messageChars <= budget.maxChars) {
      kept.unshift(message);
      estimatedChars += messageChars;
      continue;
    }
    droppedReasons.push('dropped older messages to fit context budget');
  }

  return {
    messages: kept,
    droppedCount: messages.length - kept.length,
    droppedReasons: [...new Set(droppedReasons)],
    estimatedChars,
    wasPruned: kept.length !== messages.length || droppedReasons.length > 0,
  };
}

export function isContextOverflowError(error: unknown): boolean {
  const details = extractErrorDetails(error);
  const probe = [details.httpCode, details.message].filter(Boolean).join(' ');
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(probe));
}

export const DEFAULT_CONTEXT_BUDGET_LIMITS = DEFAULT_CONTEXT_BUDGET;
