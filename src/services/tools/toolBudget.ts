export type ToolBudgetCategory =
  | 'tool_not_found'
  | 'tool_disabled'
  | 'argument_invalid'
  | 'transient_failure'
  | 'successful_call';

export interface ToolBudgetEntry {
  name: string;
  content: string;
}

export interface ToolBudgetSummary {
  toolBudgetUsed: number;
  toolBudgetUsedRaw: number;
  toolBudgetMax: number;
  failedCalls: number;
  successfulCalls: number;
  categoryCounts: Record<ToolBudgetCategory, number>;
}

interface StructuredToolErrorPayload {
  error?: unknown;
  error_kind?: unknown;
  message?: unknown;
}

const ZERO_CATEGORY_COUNTS: Record<ToolBudgetCategory, number> = {
  tool_not_found: 0,
  tool_disabled: 0,
  argument_invalid: 0,
  transient_failure: 0,
  successful_call: 0,
};

function roundBudget(value: number): number {
  return Number(value.toFixed(1));
}

function roundBudgetUsed(value: number): number {
  return Math.ceil(roundBudget(value));
}

function parseStructuredToolError(content: string): StructuredToolErrorPayload | null {
  try {
    const parsed = JSON.parse(content) as StructuredToolErrorPayload;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeErrorKind(errorKind: string | null | undefined): ToolBudgetCategory | null {
  switch (errorKind) {
    case 'tool_not_found':
      return 'tool_not_found';
    case 'tool_disabled':
      return 'tool_disabled';
    case 'argument_invalid':
      return 'argument_invalid';
    case 'access_denied':
    case 'not_found':
    case 'io_error':
    case 'tool_execution_failed':
    case 'transient_failure':
      return 'transient_failure';
    default:
      return null;
  }
}

export function classifyToolBudgetEntry(entry: ToolBudgetEntry): ToolBudgetCategory {
  const structuredError = parseStructuredToolError(entry.content);
  const normalizedKind = normalizeErrorKind(
    typeof structuredError?.error_kind === 'string' ? structuredError.error_kind : undefined,
  );
  if (normalizedKind) {
    return normalizedKind;
  }

  if (structuredError?.error === true) {
    return 'transient_failure';
  }

  const normalized = entry.content.trim();
  if (!normalized) {
    return 'transient_failure';
  }

  if (/^Error:\s*Tool\s+["'][^"']+["']\s+is disabled/i.test(normalized)) {
    return 'tool_disabled';
  }

  if (
    /Unknown tool:/i.test(normalized)
    || /工具\s+["'][^"']+["']\s+不存在/i.test(normalized)
    || /暂不支持/i.test(normalized)
    || /not exist/i.test(normalized)
  ) {
    return 'tool_not_found';
  }

  if (
    /Schema validation failed/i.test(normalized)
    || /Missing required parameter/i.test(normalized)
    || /Missing '[^']+' argument/i.test(normalized)
    || /Invalid JSON arguments/i.test(normalized)
    || /Empty path/i.test(normalized)
  ) {
    return 'argument_invalid';
  }

  if (/^(Error|ERROR):/i.test(normalized)) {
    return 'transient_failure';
  }

  return 'successful_call';
}

export function getToolBudgetCost(category: ToolBudgetCategory): number {
  switch (category) {
    case 'tool_not_found':
    case 'tool_disabled':
      return 0;
    case 'argument_invalid':
    case 'transient_failure':
      return 0.5;
    case 'successful_call':
    default:
      return 1;
  }
}

export function createToolBudgetSummary(toolBudgetMax: number): ToolBudgetSummary {
  return {
    toolBudgetUsed: 0,
    toolBudgetUsedRaw: 0,
    toolBudgetMax,
    failedCalls: 0,
    successfulCalls: 0,
    categoryCounts: { ...ZERO_CATEGORY_COUNTS },
  };
}

export function appendToolBudgetEntries(
  summary: ToolBudgetSummary,
  entries: ToolBudgetEntry[],
): ToolBudgetSummary {
  let toolBudgetUsedRaw = summary.toolBudgetUsedRaw;
  let failedCalls = summary.failedCalls;
  let successfulCalls = summary.successfulCalls;
  const categoryCounts = { ...summary.categoryCounts };

  for (const entry of entries) {
    const category = classifyToolBudgetEntry(entry);
    categoryCounts[category] += 1;
    toolBudgetUsedRaw += getToolBudgetCost(category);
    if (category === 'successful_call') {
      successfulCalls += 1;
    } else {
      failedCalls += 1;
    }
  }

  return {
    toolBudgetMax: summary.toolBudgetMax,
    toolBudgetUsedRaw: roundBudget(toolBudgetUsedRaw),
    toolBudgetUsed: roundBudgetUsed(toolBudgetUsedRaw),
    failedCalls,
    successfulCalls,
    categoryCounts,
  };
}

export function getRemainingToolBudget(summary: ToolBudgetSummary): number {
  return roundBudget(Math.max(0, summary.toolBudgetMax - summary.toolBudgetUsedRaw));
}

export function withToolBudgetSummary<T extends Error>(error: T, summary: ToolBudgetSummary): T & {
  toolBudgetSummary: ToolBudgetSummary;
} {
  return Object.assign(error, {
    toolBudgetSummary: {
      ...summary,
      categoryCounts: { ...summary.categoryCounts },
    },
  });
}

export function getToolBudgetSummaryFromUnknown(error: unknown): ToolBudgetSummary | undefined {
  if (!error || typeof error !== 'object' || !('toolBudgetSummary' in error)) {
    return undefined;
  }

  const candidate = (error as { toolBudgetSummary?: unknown }).toolBudgetSummary;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return undefined;
  }

  const summary = candidate as Partial<ToolBudgetSummary> & {
    categoryCounts?: Partial<Record<ToolBudgetCategory, number>>;
  };
  if (
    typeof summary.toolBudgetUsed !== 'number'
    || typeof summary.toolBudgetUsedRaw !== 'number'
    || typeof summary.toolBudgetMax !== 'number'
    || typeof summary.failedCalls !== 'number'
    || typeof summary.successfulCalls !== 'number'
  ) {
    return undefined;
  }

  return {
    toolBudgetUsed: roundBudgetUsed(summary.toolBudgetUsedRaw),
    toolBudgetUsedRaw: roundBudget(summary.toolBudgetUsedRaw),
    toolBudgetMax: roundBudget(summary.toolBudgetMax),
    failedCalls: summary.failedCalls,
    successfulCalls: summary.successfulCalls,
    categoryCounts: {
      ...ZERO_CATEGORY_COUNTS,
      ...(summary.categoryCounts ?? {}),
    },
  };
}
