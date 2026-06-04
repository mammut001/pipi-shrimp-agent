import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  countDiffLines,
  derivePatchGatePaths,
  diffHasChanges,
  writePatchGateArtifacts,
} from '../patchGate';
import type { SelfImproveResultV2 } from '../selfImprove/schemaV2';

describe('patchGate utilities', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'patch-gate-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('derives expected paths', () => {
    const paths = derivePatchGatePaths(dir);
    expect(paths.diffPath.endsWith('diff.patch')).toBe(true);
    expect(paths.resultPath.endsWith('result.json')).toBe(true);
    expect(paths.eventsPath.endsWith('events.jsonl')).toBe(true);
    expect(paths.applyInstructionsPath.endsWith('apply.md')).toBe(true);
    expect(paths.revertInstructionsPath.endsWith('revert.md')).toBe(true);
    expect(paths.logsDir.endsWith('logs')).toBe(true);
  });

  it('counts added and deleted diff lines', () => {
    const diff = [
      'diff --git a/foo b/foo',
      'index 1234..5678 100644',
      '--- a/foo',
      '+++ b/foo',
      '@@ -1 +1 @@',
      '-old line',
      '+new line 1',
      '+new line 2',
    ].join('\n');
    expect(diffHasChanges(diff)).toBe(true);
    expect(countDiffLines(diff)).toEqual({ added: 2, deleted: 1 });
  });

  it('reports no changes for empty diff', () => {
    expect(diffHasChanges('')).toBe(false);
  });

  it('writes all patch gate artifacts', async () => {
    const eventsPath = path.join(dir, 'run.jsonl');
    await fs.writeFile(eventsPath, '{"ts":"2026-01-01T00:00:00.000Z","runId":"r","iteration":1,"phase":"INIT","type":"run.started","status":"ok"}\n', 'utf8');

    const v2: SelfImproveResultV2 = {
      schemaVersion: 2,
      mode: 'repo_self_improve',
      iteration: 1,
      phaseResults: { VERIFY: { phase: 'VERIFY', success: true } },
      changedFiles: ['src/foo.ts'],
      commandsRun: ['pnpm test'],
      buildPassed: true,
      testsPassed: true,
      typecheckPassed: true,
      riskLevel: 'low',
      status: 'IMPROVED',
      summary: 'fix foo',
      nextRecommendation: 'next',
      patch: { diffPath: 'diff.patch', addedLines: 1, deletedLines: 0, reverted: false },
      verification: [{ command: 'pnpm test', exitCode: 0, durationMs: 100, status: 'pass', stdoutPath: null, stderrPath: null }],
      workspace: { dirtyBefore: false, dirtyAfter: false },
    };

    const diff = 'diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n-old\n+new\n';
    const written = await writePatchGateArtifacts({
      iterDir: dir,
      diff,
      result: v2,
      eventsPath,
      verificationLogs: [{ command: 'pnpm test', stdout: 'all good', stderr: '' }],
      originalRepoPath: '/tmp/orig',
    });

    expect(written.diffPath).toBe(path.join(dir, 'diff.patch'));
    const diffContent = await fs.readFile(written.diffPath, 'utf8');
    expect(diffContent).toContain('+new');

    const resultContent = await fs.readFile(written.resultPath, 'utf8');
    const parsed = JSON.parse(resultContent);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.summary).toBe('fix foo');

    const apply = await fs.readFile(written.applyInstructionsPath, 'utf8');
    expect(apply).toContain('Patch Gate');
    expect(apply).toContain('Default behavior');
    expect(apply).toContain('does **NOT** auto-apply');

    const revert = await fs.readFile(written.revertInstructionsPath, 'utf8');
    expect(revert).toContain('git apply -R');

    const stdoutLog = await fs.readFile(path.join(dir, 'logs', 'verify-pnpm-test.stdout.log'), 'utf8');
    expect(stdoutLog).toBe('all good');

    const eventsContent = await fs.readFile(written.eventsPath, 'utf8');
    expect(eventsContent).toContain('run.started');
  });
});
