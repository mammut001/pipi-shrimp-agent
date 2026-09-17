/**
 * Unit tests for AG-02 PR2b iteration-phase helpers extracted from loopEngine.ts.
 */
import { describe, expect, it } from '@jest/globals';
import {
  AutoResearchAbortedError,
  calculateBudgetReserve,
  isBudgetExhaustedIterationSignal,
  TOOL_BUDGET_EXHAUSTED_MARKER,
  throwIfAborted,
  buildIterationWorkspaceCfg,
  getRunArtifactPaths,
  sleep,
  buildSystemPrompt,
} from '../loopEngine.iterationPhase';
import type { RunDir } from '../runDir';
import type { SshConfig } from '@/store/autoresearchStore';

describe('loopEngine.iterationPhase helpers', () => {
  it('calculateBudgetReserve clamps to [1, 2]', () => {
    expect(calculateBudgetReserve(1)).toBe(1);
    expect(calculateBudgetReserve(4)).toBe(1);
    expect(calculateBudgetReserve(8)).toBe(2);
    expect(calculateBudgetReserve(100)).toBe(2);
  });

  it('isBudgetExhaustedIterationSignal detects marker', () => {
    expect(isBudgetExhaustedIterationSignal('ok')).toBe(false);
    expect(isBudgetExhaustedIterationSignal(`x ${TOOL_BUDGET_EXHAUSTED_MARKER} y`)).toBe(true);
  });

  it('throwIfAborted throws AutoResearchAbortedError when aborted', () => {
    const c = new AbortController();
    expect(() => throwIfAborted(c.signal, 'test')).not.toThrow();
    c.abort();
    expect(() => throwIfAborted(c.signal, 'test')).toThrow(AutoResearchAbortedError);
  });

  it('sleep resolves when not aborted and rejects when aborted', async () => {
    await expect(sleep(10)).resolves.toBeUndefined();

    const c = new AbortController();
    c.abort();
    await expect(sleep(1000, c.signal)).rejects.toThrow(AutoResearchAbortedError);

    const c2 = new AbortController();
    const p = sleep(1000, c2.signal);
    c2.abort();
    await expect(p).rejects.toThrow(AutoResearchAbortedError);
  });

  it('buildIterationWorkspaceCfg points remoteWorkDir at codeDir', () => {
    const cfg = { mode: 'local', remoteWorkDir: '/old' } as SshConfig;
    const runDir = { codeDir: '/iter/code' } as RunDir;
    expect(buildIterationWorkspaceCfg(cfg, runDir).remoteWorkDir).toBe('/iter/code');
  });

  it('getRunArtifactPaths includes metrics and status', () => {
    const runDir = {
      iterDir: '/i',
      systemPromptPath: '/i/sys',
      hypothesisPath: '/i/hyp',
      diffPath: '/i/diff',
      metricsPath: '/i/metrics.json',
      statusPath: '/i/status.json',
      reflectionInputPath: '/i/ri',
      reflectionRawPath: '/i/rr',
      reflectionParsedPath: '/i/rp',
      transcriptPath: '/i/tr',
      logsDir: '/i/logs',
    } as RunDir;
    const paths = getRunArtifactPaths(runDir);
    expect(paths).toContain('/i/metrics.json');
    expect(paths).toContain('/i/status.json');
    expect(paths).toContain('/i/logs/stdout.log');
  });

  it('buildSystemPrompt generates prompt containing iteration info', () => {
    const prompt = buildSystemPrompt({
      sessionContent: 'test session',
      livingDoc: '',
      sshConfig: { mode: 'local', remoteWorkDir: '/work' } as SshConfig,
      runDir: {
        iterDir: '/work/runs/iter-1',
        codeDir: '/work/runs/iter-1/code',
        hypothesisPath: '/work/runs/iter-1/hypothesis.md',
        metricsPath: '/work/runs/iter-1/metrics.json',
        diffPath: '/work/runs/iter-1/diff.patch',
        sessionId: 's1',
        iter: 1,
      } as RunDir,
      environmentSummary: {
        experimentDir: '/orig',
        runScriptPath: '/orig/run.py',
        notesPath: '/orig/notes.md',
        repoStatus: 'clean',
        dirtyFileCount: 0,
        preferredPythonCommand: 'python3',
        recommendedRunCommand: 'python3 run.py',
        worktreeWritable: true,
      } as any,
      metricDirection: 'higher',
      metricName: 'acc',
      maxIterations: 10,
      iteration: 1,
      previousMetrics: [],
    });
    expect(prompt).toContain('AutoResearch Agent');
    expect(prompt).toContain('test session');
    expect(prompt).toContain('code/run.py');
  });
});
