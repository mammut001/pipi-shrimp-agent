/**
 * AutoResearch Harness — Backward Compatibility Tests
 *
 * Confirms the v1 SelfImproveResult parser still works, and that v1
 * results are auto-upgraded to v2 by the new parser.
 */

import { describe, expect, it } from '@jest/globals';
import {
  SelfImproveResultSchema,
  parseSelfImproveResult,
} from '../selfImprove/schema';
import {
  parseSelfImproveResultAny,
  parseSelfImproveResultV2,
} from '../selfImprove/schemaV2';
import type { SelfImproveResult } from '../selfImprove/schema';

function createV1(overrides: Partial<SelfImproveResult> = {}): SelfImproveResult {
  return {
    schemaVersion: 1,
    mode: 'repo_self_improve',
    iteration: 1,
    phaseResults: {},
    changedFiles: ['src/a.ts'],
    commandsRun: ['pnpm test'],
    buildPassed: true,
    testsPassed: true,
    typecheckPassed: true,
    riskLevel: 'low',
    status: 'IMPROVED',
    summary: 'fix a',
    nextRecommendation: 'next',
    ...overrides,
  };
}

describe('v1 parser remains backward compatible', () => {
  it('parses a v1 result that has no v2 fields', () => {
    const v1 = createV1();
    const text = JSON.stringify(v1);
    const parsed = parseSelfImproveResult(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(1);
    expect(parsed!.summary).toBe('fix a');
  });

  it('v1 schema is still strict about its literal schemaVersion', () => {
    const result = SelfImproveResultSchema.safeParse({ ...createV1(), schemaVersion: 2 as never });
    expect(result.success).toBe(false);
  });
});

describe('v2 parser auto-upgrades v1', () => {
  it('parses v1 text and returns a v2 with sourceSchema=1', () => {
    const v1 = createV1();
    const parsed = parseSelfImproveResultV2(JSON.stringify(v1));
    expect(parsed).not.toBeNull();
    expect(parsed!.sourceSchema).toBe(1);
    expect(parsed!.result.schemaVersion).toBe(2);
    expect(parsed!.originalV1?.summary).toBe('fix a');
  });

  it('parseSelfImproveResultAny returns a v2 representation regardless of input schema', () => {
    const v1 = createV1();
    const result = parseSelfImproveResultAny(JSON.stringify(v1));
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(2);
  });

  it('does not crash on malformed v1 input', () => {
    expect(parseSelfImproveResultAny('garbage')).toBeNull();
    expect(parseSelfImproveResultAny('')).toBeNull();
  });
});
