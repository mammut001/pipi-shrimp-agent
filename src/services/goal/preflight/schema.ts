/**
 * Goal Core Preflight — shared clarification schema.
 *
 * Both Session Goal and Workflow Goal can start from a rough natural-language
 * objective. The clarifier turns that input into a structured, reviewable
 * result before either runtime begins executing it.
 */

import { z } from 'zod';
import { serializeSuccessCriteria } from '@/services/goal/types';

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

export interface GoalPreflightAssistantTurn {
  status: 'needs_more_info' | 'ready';
  questionText: string;
  result: GoalPreflightResult | null;
}

/**
 * Workflow still persists success criteria as newline-separated text. Export
 * the adapter here to preserve the existing preflight API while the canonical
 * Goal Core representation remains string[].
 */
export { serializeSuccessCriteria };

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
