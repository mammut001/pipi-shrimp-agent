/**
 * Shared Goal Core domain types.
 *
 * Session Goal and Workflow Goal have different runtimes, but they share the
 * same objective / success-criteria vocabulary and evaluation contract. Keep
 * runtime-specific state (budgets, traces, routing, iterations) outside this
 * module.
 */

export type GoalSuccessCriteria = string[];
export type GoalSuccessCriteriaInput = string | readonly string[] | null | undefined;

export interface GoalSpec {
  objective: string;
  successCriteria: GoalSuccessCriteria;
  asciiPreview?: string;
  assumptions?: string[];
  risks?: string[];
}

export interface GoalEvaluation {
  reached: boolean;
  confidence: number;
  reasoning: string;
  evidence?: string[];
  missingItems?: string[];
  timestamp: number;
}

function normalizeCriterion(item: string): string {
  return item
    .trim()
    .replace(/^[-•*]+\s*/, '')
    .trim();
}

/**
 * Normalize any legacy/new success-criteria representation into Goal Core's
 * canonical string[] shape. This is intentionally safe for persisted data
 * written by older pipi-shrimp versions.
 */
export function normalizeSuccessCriteria(input: GoalSuccessCriteriaInput): GoalSuccessCriteria {
  const items = typeof input === 'string'
    ? input.split(/\r?\n/)
    : Array.isArray(input)
      ? input
      : [];

  return items
    .filter((item): item is string => typeof item === 'string')
    .map(normalizeCriterion)
    .filter(Boolean);
}

/** @deprecated Use normalizeSuccessCriteria. */
export const parseSuccessCriteria = normalizeSuccessCriteria;

/** Render canonical criteria for textareas/prompts without changing storage. */
export function formatSuccessCriteria(input: GoalSuccessCriteriaInput): string {
  return normalizeSuccessCriteria(input)
    .map((item) => `- ${item}`)
    .join('\n');
}

/** @deprecated UI/prompt adapter only; Goal Core storage is string[]. */
export const serializeSuccessCriteria = formatSuccessCriteria;
