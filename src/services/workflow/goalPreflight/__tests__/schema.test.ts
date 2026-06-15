/**
 * Workflow Goal Preflight — schema & parser tests
 *
 * Coverage:
 *  - `GoalPreflightResultSchema` accepts a fully-populated `ready` result.
 *  - The schema rejects malformed `readinessScore` and `status`.
 *  - `serializeSuccessCriteria` produces the newline-separated form that
 *    `WorkflowInstance.successCriteria` expects.
 *  - `tryParseGoalPreflightResult` strips a ```json fence, extracts a
 *    leading prose / trailing prose envelope, and returns `null` on
 *    malformed input instead of throwing.
 */

import { describe, it, expect } from '@jest/globals';
import {
  GoalPreflightResultSchema,
  tryParseGoalPreflightResult,
  serializeSuccessCriteria,
} from '../schema';

const readyResult = {
  status: 'ready' as const,
  finalGoal: 'Build a modern login page with email+password auth.',
  successCriteria: [
    'Form validates email format',
    'Password field has visibility toggle',
    'Forgot password link is visible',
  ],
  assumptions: [
    'We are not implementing MFA in v1',
  ],
  openQuestions: [
    'Do we need SSO support?',
  ],
  suggestedAgents: [
    {
      role: 'writer' as const,
      name: 'Spec Writer',
      task: 'Produce a UX spec for the login page',
      reason: 'Specs unblock downstream dev work',
    },
    {
      role: 'developer' as const,
      name: 'Frontend Dev',
      task: 'Implement the login form component',
      reason: 'Frontend dev implements the form',
    },
  ],
  asciiPreview: '┌────────┐\n│ Login  │\n└────────┘',
  risks: [
    'Browser autofill may interfere with validation',
  ],
  readinessScore: 85,
  schemaVersion: 1 as const,
};

describe('GoalPreflightResultSchema', () => {
  it('accepts a valid ready result', () => {
    const parsed = GoalPreflightResultSchema.safeParse(readyResult);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('ready');
      expect(parsed.data.readinessScore).toBe(85);
      expect(parsed.data.successCriteria).toHaveLength(3);
    }
  });

  it('accepts a needs_more_info result', () => {
    const parsed = GoalPreflightResultSchema.safeParse({
      ...readyResult,
      status: 'needs_more_info',
      finalGoal: '',
      readinessScore: 30,
    });
    expect(parsed.success).toBe(false);
    // finalGoal must be non-empty even when status is needs_more_info
    // (the schema is the same).
  });

  it('rejects readinessScore above 100', () => {
    const parsed = GoalPreflightResultSchema.safeParse({
      ...readyResult,
      readinessScore: 150,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects negative readinessScore', () => {
    const parsed = GoalPreflightResultSchema.safeParse({
      ...readyResult,
      readinessScore: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown status', () => {
    const parsed = GoalPreflightResultSchema.safeParse({
      ...readyResult,
      status: 'pending',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown agent roles', () => {
    const parsed = GoalPreflightResultSchema.safeParse({
      ...readyResult,
      suggestedAgents: [
        { ...readyResult.suggestedAgents[0], role: 'unicorn' },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('serializeSuccessCriteria', () => {
  it('joins a list into a newline-bulleted string', () => {
    expect(serializeSuccessCriteria(['a', 'b', 'c'])).toBe('- a\n- b\n- c');
  });

  it('preserves existing leading dashes', () => {
    expect(serializeSuccessCriteria(['- already', 'b'])).toBe('- already\n- b');
  });

  it('drops empty and whitespace-only entries', () => {
    expect(serializeSuccessCriteria(['a', '   ', '', 'b'])).toBe('- a\n- b');
  });

  it('returns an empty string for an empty list', () => {
    expect(serializeSuccessCriteria([])).toBe('');
  });
});

describe('tryParseGoalPreflightResult', () => {
  it('parses a raw JSON string', () => {
    const result = tryParseGoalPreflightResult(JSON.stringify(readyResult));
    expect(result).not.toBeNull();
    expect(result?.status).toBe('ready');
    expect(result?.readinessScore).toBe(85);
  });

  it('strips a ```json code fence', () => {
    const fenced = '```json\n' + JSON.stringify(readyResult) + '\n```';
    const result = tryParseGoalPreflightResult(fenced);
    expect(result?.finalGoal).toBe(readyResult.finalGoal);
  });

  it('extracts JSON from a leading-prose / trailing-prose envelope', () => {
    const noisy = 'Here you go:\n' + JSON.stringify(readyResult) + '\nLet me know!';
    const result = tryParseGoalPreflightResult(noisy);
    expect(result?.status).toBe('ready');
  });

  it('returns null for empty input', () => {
    expect(tryParseGoalPreflightResult('')).toBeNull();
    expect(tryParseGoalPreflightResult('   ')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(tryParseGoalPreflightResult('not json {')).toBeNull();
  });

  it('returns null for valid JSON that does not match the schema', () => {
    const wrongShape = JSON.stringify({ status: 'ready', finalGoal: '', successCriteria: [] });
    expect(tryParseGoalPreflightResult(wrongShape)).toBeNull();
  });

  it('does not throw on garbage input', () => {
    expect(() => tryParseGoalPreflightResult('\\u0000\\u0000{')).not.toThrow();
  });
});
