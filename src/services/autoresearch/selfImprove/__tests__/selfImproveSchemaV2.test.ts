import { describe, expect, it } from '@jest/globals';
import {
  normalizeV1ToV2,
  parseSelfImproveResultAny,
  parseSelfImproveResultV2,
  SelfImproveResultV2Schema,
  type SelfImproveResultV2,
} from '../schemaV2';
import type { SelfImproveResult } from '../schema';

function createV1(overrides: Partial<SelfImproveResult> = {}): SelfImproveResult {
  return {
    schemaVersion: 1,
    mode: 'repo_self_improve',
    iteration: 7,
    phaseResults: {
      AUDIT: { phase: 'AUDIT', success: true, output: 'build failed: missing import' },
    },
    changedFiles: ['src/foo.ts'],
    commandsRun: ['pnpm run build'],
    buildPassed: false,
    testsPassed: null,
    typecheckPassed: true,
    riskLevel: 'medium',
    status: 'NEEDS_REVIEW',
    summary: 'Fix missing import in src/foo.ts',
    nextRecommendation: 'Continue with other files.',
    ...overrides,
  };
}

function createV2(overrides: Partial<SelfImproveResultV2> = {}): SelfImproveResultV2 {
  return {
    schemaVersion: 2,
    mode: 'repo_self_improve',
    iteration: 7,
    phaseResults: {
      AUDIT: { phase: 'AUDIT', success: true },
      VERIFY: { phase: 'VERIFY', success: true },
    },
    changedFiles: ['src/foo.ts'],
    commandsRun: ['pnpm run build'],
    buildPassed: true,
    testsPassed: true,
    typecheckPassed: true,
    riskLevel: 'low',
    status: 'IMPROVED',
    summary: 'Fix import',
    nextRecommendation: 'Next: …',
    issue: { summary: 'fix import', evidence: ['err x'], category: 'build', severity: 'minor' },
    patch: { diffPath: 'diff.patch', addedLines: 3, deletedLines: 1, reverted: false },
    verification: [
      { command: 'pnpm run build', exitCode: 0, durationMs: 1200, status: 'pass', stdoutPath: 'logs/build.stdout', stderrPath: 'logs/build.stderr' },
    ],
    workspace: { dirtyBefore: false, dirtyAfter: false },
    decision: { status: 'IMPROVED', score: 80, nextRecommendation: 'next' },
    ...overrides,
  };
}

describe('SelfImproveResultV2Schema', () => {
  it('accepts a valid v2 result', () => {
    const result = SelfImproveResultV2Schema.safeParse(createV2());
    expect(result.success).toBe(true);
  });

  it('rejects a v1 result (schemaVersion must be 2)', () => {
    const v1 = createV1() as unknown;
    const result = SelfImproveResultV2Schema.safeParse(v1);
    expect(result.success).toBe(false);
  });

  it('rejects invalid category', () => {
    const result = SelfImproveResultV2Schema.safeParse(createV2({
      issue: { summary: 'x', evidence: [], category: 'unknown' as never, severity: 'minor' },
    }));
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity', () => {
    const result = SelfImproveResultV2Schema.safeParse(createV2({
      issue: { summary: 'x', evidence: [], category: 'other', severity: 'fatal' as never },
    }));
    expect(result.success).toBe(false);
  });

  it('accepts a v2 result missing optional sections', () => {
    const partial = createV2();
    delete (partial as { issue?: unknown }).issue;
    delete (partial as { patch?: unknown }).patch;
    delete (partial as { verification?: unknown }).verification;
    delete (partial as { workspace?: unknown }).workspace;
    delete (partial as { decision?: unknown }).decision;
    const result = SelfImproveResultV2Schema.safeParse(partial);
    expect(result.success).toBe(true);
  });
});

describe('parseSelfImproveResultV2', () => {
  it('parses a v2 JSON block', () => {
    const v2 = createV2();
    const text = `Result:\n\n\`\`\`json\n${JSON.stringify(v2)}\n\`\`\`\n`;
    const parsed = parseSelfImproveResultV2(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.sourceSchema).toBe(2);
    expect(parsed!.result.schemaVersion).toBe(2);
    expect(parsed!.result.issue?.summary).toBe('fix import');
  });

  it('upgrades a v1 JSON block to v2', () => {
    const v1 = createV1();
    const text = JSON.stringify(v1);
    const parsed = parseSelfImproveResultV2(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.sourceSchema).toBe(1);
    expect(parsed!.originalV1).toBeDefined();
    expect(parsed!.result.schemaVersion).toBe(2);
    expect(parsed!.result.summary).toBe(v1.summary);
    expect(parsed!.result.issue?.category).toBe('build'); // buildPassed=false → build
  });

  it('returns null when no JSON is found', () => {
    expect(parseSelfImproveResultV2('nothing here')).toBeNull();
  });

  it('prefers the last valid v2 over earlier junk', () => {
    const v2 = createV2({ summary: 'last' });
    const v2First = createV2({ summary: 'first' });
    const text = `${JSON.stringify(v2First)}\nGarbage in between\n${JSON.stringify(v2)}`;
    const parsed = parseSelfImproveResultV2(text);
    expect(parsed?.result.summary).toBe('last');
  });
});

describe('normalizeV1ToV2', () => {
  it('infers category from verification failures', () => {
    const v1 = createV1({ buildPassed: false, testsPassed: null, typecheckPassed: null });
    const v2 = normalizeV1ToV2(v1);
    expect(v2.issue?.category).toBe('build');
  });

  it('infers test category when only tests failed', () => {
    const v1 = createV1({ buildPassed: true, testsPassed: false, typecheckPassed: true });
    const v2 = normalizeV1ToV2(v1);
    expect(v2.issue?.category).toBe('test');
  });

  it('infers typecheck category when only typecheck failed', () => {
    const v1 = createV1({ buildPassed: true, testsPassed: true, typecheckPassed: false });
    const v2 = normalizeV1ToV2(v1);
    expect(v2.issue?.category).toBe('typecheck');
  });

  it('maps riskLevel to severity', () => {
    expect(normalizeV1ToV2(createV1({ riskLevel: 'high' })).issue?.severity).toBe('major');
    expect(normalizeV1ToV2(createV1({ riskLevel: 'medium' })).issue?.severity).toBe('minor');
    expect(normalizeV1ToV2(createV1({ riskLevel: 'low' })).issue?.severity).toBe('info');
  });

  it('marks workspace.dirtyAfter when files changed', () => {
    const v2 = normalizeV1ToV2(createV1({ changedFiles: ['src/foo.ts'] }));
    expect(v2.workspace?.dirtyAfter).toBe(true);
  });

  it('does not mark dirtyAfter when no files changed', () => {
    const v2 = normalizeV1ToV2(createV1({ changedFiles: [] }));
    expect(v2.workspace?.dirtyAfter).toBe(false);
  });
});

describe('parseSelfImproveResultAny', () => {
  it('parses v2 directly', () => {
    const v2 = createV2();
    const text = JSON.stringify(v2);
    const result = parseSelfImproveResultAny(text);
    expect(result?.schemaVersion).toBe(2);
  });

  it('upgrades v1 transparently', () => {
    const v1 = createV1();
    const result = parseSelfImproveResultAny(JSON.stringify(v1));
    expect(result?.schemaVersion).toBe(2);
  });

  it('returns null on invalid input', () => {
    expect(parseSelfImproveResultAny('nope')).toBeNull();
  });
});
