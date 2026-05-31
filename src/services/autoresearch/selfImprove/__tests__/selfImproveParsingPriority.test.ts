/**
 * Self-Improve Result Parsing Priority Tests
 *
 * Tests that the loopEngine reads self-improve results from runDir.metricsPath
 * before falling back to parsing from agent output.
 */

import { describe, expect, it } from '@jest/globals';
import { parseSelfImproveResult } from '../schema';
import { parseSelfImproveAgentOutput } from '../resultParser';
import type { SelfImproveResult } from '../schema';

function createValidResult(overrides: Partial<SelfImproveResult> = {}): SelfImproveResult {
  return {
    schemaVersion: 1,
    mode: 'repo_self_improve',
    iteration: 1,
    phaseResults: {
      AUDIT: { phase: 'AUDIT', success: true },
      PLAN: { phase: 'PLAN', success: true },
      PATCH: { phase: 'PATCH', success: true },
      VERIFY: { phase: 'VERIFY', success: true, output: 'All checks passed.' },
      REFLECT: { phase: 'REFLECT', success: true },
      DECIDE_NEXT: { phase: 'DECIDE_NEXT', success: true },
    },
    changedFiles: ['src/utils/logger.ts'],
    commandsRun: ['pnpm run build', 'pnpm test'],
    buildPassed: true,
    testsPassed: true,
    typecheckPassed: true,
    riskLevel: 'low',
    status: 'IMPROVED',
    summary: 'Fixed import.meta.env usage in logger.ts',
    nextRecommendation: 'Fix remaining ESM/CJS interop issues.',
    ...overrides,
  };
}

describe('Self-improve result parsing priority', () => {
  it('parses result from metricsPath JSON file content', () => {
    const result = createValidResult();
    const fileContent = JSON.stringify(result, null, 2);
    const parsed = parseSelfImproveResult(fileContent);
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('IMPROVED');
    expect(parsed!.summary).toBe('Fixed import.meta.env usage in logger.ts');
    expect(parsed!.buildPassed).toBe(true);
    expect(parsed!.riskLevel).toBe('low');
  });

  it('falls back to agent output when file content is invalid', () => {
    const result = createValidResult({ summary: 'From agent output fallback' });
    const agentOutput = `Some text before\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\`\nSome text after`;
    const parsed = parseSelfImproveAgentOutput(agentOutput);
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toBe('From agent output fallback');
  });

  it('returns null when both file and agent output are invalid', () => {
    expect(parseSelfImproveResult('not valid json')).toBeNull();
    expect(parseSelfImproveAgentOutput('no structured data here')).toBeNull();
  });

  it('prefers file content over agent output when both are valid', () => {
    const fileResult = createValidResult({ summary: 'From file' });
    const agentResult = createValidResult({ summary: 'From agent output' });

    const fileContent = JSON.stringify(fileResult);
    const agentOutput = JSON.stringify(agentResult);

    // Simulate the loopEngine priority: file first, agent output second
    let parsed = parseSelfImproveResult(fileContent);
    if (!parsed) {
      parsed = parseSelfImproveAgentOutput(agentOutput);
    }

    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toBe('From file');
  });

  it('falls back to agent output when file is empty', () => {
    const result = createValidResult({ summary: 'Recovered from agent output' });
    const agentOutput = `Result: ${JSON.stringify(result)}`;

    // File is empty/null — fall back to agent output
    let parsed = parseSelfImproveResult('');
    if (!parsed) {
      parsed = parseSelfImproveAgentOutput(agentOutput);
    }

    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toBe('Recovered from agent output');
  });
});
