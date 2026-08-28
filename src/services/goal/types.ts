/**
 * Shared Goal Core domain types.
 *
 * Session Goal and Workflow Goal have different runtimes, but they share the
 * same objective / success criteria vocabulary and evaluation contract. Keep
 * runtime-specific state (budgets, traces, agent routing, iterations) outside
 * this module.
 */

export interface GoalSpec {
  objective: string;
  successCriteria: string[];
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

/**
 * Convert Workflow's legacy newline-separated success-criteria storage into
 * the canonical Goal Core representation. Storage migration is intentionally
 * deferred so this extraction does not change persisted workflow behaviour.
 */
export function parseSuccessCriteria(criteria: string): string[] {
  return criteria
    .split(/\r?\n/)
    .map((item) => item.replace(/^[-•\s]+/, '').trim())
    .filter(Boolean);
}

/** Serialize canonical criteria for Workflow's current string storage. */
export function serializeSuccessCriteria(criteria: string[]): string {
  return criteria
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('- ') ? item : `- ${item}`))
    .join('\n');
}
