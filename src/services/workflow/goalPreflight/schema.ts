/**
 * Workflow Goal Preflight — Clarifier Schema
 *
 * The Goal Preflight is a *clarification* loop. Before a Workflow Goal run starts,
 * the user describes a rough natural-language goal and a clarifier assistant
 * asks short follow-up questions until it can produce a `GoalPreflightResult`
 * that downstream code can map onto `WorkflowInstance.projectGoal` /
 * `successCriteria` and (optionally) the workflow topology.
 *
 * This module is purely about *parsing* and *defensive* validation. The
 * clarifier prompt lives in `@/services/agents/templates/workflowGoalClarifier`.
 * The UI lives in `@/components/workflow/WorkflowGoalPreflightPanel`.
 */

import { z } from 'zod';

export const GOAL_PREFLIGHT_AGENT_ROLES = [
  'planner',
  'writer',
  'developer',
  'reviewer',
  'qa',
  'security',
  'devops',
  'custom',
] as const;

export type GoalPreflightAgentRole = typeof GOAL_PREFLIGHT_AGENT_ROLES[number];

export const GoalPreflightAgentSuggestionSchema = z.object({
  role: z.enum(GOAL_PREFLIGHT_AGENT_ROLES),
  name: z.string().min(1),
  task: z.string().min(1),
  reason: z.string().min(1),
}).strict();

export type GoalPreflightAgentSuggestion = z.infer<typeof GoalPreflightAgentSuggestionSchema>;

/**
 * The GoalPreflightResult is the structured output the clarifier returns when
 * it has enough information. `status: 'ready'` means the goal is good enough to
 * apply to a Workflow instance; `status: 'needs_more_info'` means the
 * clarifier is still asking follow-up questions.
 */
export const GoalPreflightResultSchema = z.object({
  status: z.enum(['needs_more_info', 'ready']),
  finalGoal: z.string().min(1),
  successCriteria: z.array(z.string().min(1)),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  suggestedAgents: z.array(GoalPreflightAgentSuggestionSchema),
  asciiPreview: z.string(),
  risks: z.array(z.string()),
  readinessScore: z.number().int().min(0).max(100),
  schemaVersion: z.literal(1).optional(),
}).strict();

export type GoalPreflightResult = z.infer<typeof GoalPreflightResultSchema>;

/**
 * The conversation also produces a free-form `assistantQuestion` string when
 * the clarifier is asking follow-up questions. We keep it loosely typed
 * because it is just rendered as chat text — only the `status: 'ready'`
 * branch must round-trip through `GoalPreflightResultSchema` strictly.
 */
export interface GoalPreflightAssistantTurn {
  status: 'needs_more_info' | 'ready';
  questionText: string;
  result: GoalPreflightResult | null;
}

/**
 * Convert a list of success-criteria strings into the newline-separated format
 * stored in `WorkflowInstance.successCriteria` (a single string field).
 *
 * The list may contain items that already include leading "- " or "• "; we
 * normalize and re-emit with a leading "- " so the existing manual UI in
 * `WorkflowGoalPanel` continues to read the same way.
 */
export function serializeSuccessCriteria(criteria: string[]): string {
  return criteria
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => (item.startsWith('- ') ? item : `- ${item}`))
    .join('\n');
}

/**
 * Defensive parser used by the UI. The clarifier LLM is asked to emit strict
 * JSON, but it may still produce extra prose or wrap the JSON in a code
 * fence. This helper:
 *
 *  1. trims the input,
 *  2. strips ```json ... ``` fences if present,
 *  3. finds the outermost `{ ... }` substring,
 *  4. attempts `JSON.parse` followed by `GoalPreflightResultSchema.parse`.
 *
 * Returns `null` for any failure so the UI can degrade gracefully and
 * surface a non-blocking warning to the user.
 */
export function tryParseGoalPreflightResult(raw: string): GoalPreflightResult | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  const cleaned = extractJsonObject(raw);
  if (!cleaned) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const result = GoalPreflightResultSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function extractJsonObject(input: string): string | null {
  let text = input.trim();

  // Strip a single ```json ... ``` (or ``` ... ```) fence.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}
