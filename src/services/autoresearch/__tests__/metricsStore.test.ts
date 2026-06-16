import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const PROJECT_TMP_DIR = path.resolve(process.cwd(), 'src/services/autoresearch/__tests__/.tmp');

function projectTmpDir(): string {
  return PROJECT_TMP_DIR;
}

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { createLocalSshConfig, initGitRepo, installLocalInvokeMock } from './helpers';
import { appendIterationMetrics, readAllMetrics, summarize } from '../metricsStore';
import { createRunDir } from '../runDir';
import { clearCurrentRunDir, setCurrentRunDir } from '../terminalRunner';

describe('metricsStore', () => {
  let workDir: string;

  beforeEach(async () => {
    await fs.mkdir(projectTmpDir(), { recursive: true });
    workDir = await fs.mkdtemp(path.join(projectTmpDir(), 'autoresearch-metrics-'));
    installLocalInvokeMock(mockInvoke);
    await initGitRepo(workDir);
  });

  afterEach(async () => {
    clearCurrentRunDir();
    mockInvoke.mockReset();
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Best-effort: never let cleanup mask the actual test failure.
    }
  });

  afterAll(async () => {
    try {
      await fs.rm(PROJECT_TMP_DIR, { recursive: true, force: true });
    } catch {
      // Best-effort sweep; failures here are non-fatal.
    }
  });

  it('round-trips append/read and writes the iteration metrics file for the active run', async () => {
    const cfg = createLocalSshConfig(workDir);
    const runDir = await createRunDir(cfg, 'session-1', 1);
    setCurrentRunDir(runDir);

    await appendIterationMetrics(cfg, 'session-1', {
      iteration: 1,
      sessionId: 'session-1',
      metricName: 'val_loss',
      metricValue: 0.9,
      status: 'IMPROVED',
      hypothesis: 'lower learning rate',
      change: 'lowered lr from 1e-3 to 5e-4',
      reasoning: 'The prior run overfit early, so a smaller lr should stabilize validation loss.',
      artifactPaths: ['/tmp/session-1/iter-1/plot.png'],
      durationMs: 1000,
      startedAt: '2026-05-05T00:00:00.000Z',
      finishedAt: '2026-05-05T00:00:01.000Z',
    });

    await appendIterationMetrics(cfg, 'session-1', {
      iteration: 2,
      sessionId: 'session-1',
      metricName: 'val_loss',
      metricValue: 1.1,
      status: 'NOT_IMPROVED',
      hypothesis: 'larger batch size',
      durationMs: 1200,
      startedAt: '2026-05-05T00:01:00.000Z',
      finishedAt: '2026-05-05T00:01:01.200Z',
    });

    const metrics = await readAllMetrics(cfg, 'session-1');
    expect(metrics).toHaveLength(2);
    expect(metrics[0].hypothesis).toBe('lower learning rate');
    expect(metrics[0].change).toBe('lowered lr from 1e-3 to 5e-4');
    expect(metrics[0].reasoning).toContain('smaller lr');
    expect(metrics[0].artifactPaths).toEqual(['/tmp/session-1/iter-1/plot.png']);

    const metricsFile = JSON.parse(await fs.readFile(runDir.metricsPath, 'utf8'));
    expect(metricsFile.schemaVersion).toBe(1);
    expect(metricsFile.runId).toBe('session-1');
    expect(metricsFile.primaryMetric).toBe('val_loss');
    expect(metricsFile.direction).toBe('lower');
    expect(metricsFile.generator).toBe('loop_engine');
    expect(metricsFile.iteration).toBe(1);
    expect(metricsFile.metricValue).toBe(0.9);
    expect(metricsFile.change).toBe('lowered lr from 1e-3 to 5e-4');
  });

  it('rejects malformed metrics artifacts before hydrating run history', async () => {
    const cfg = createLocalSshConfig(workDir);
    const metricsPath = path.join(workDir, 'runs', 'session-1', 'metrics.jsonl');
    await fs.mkdir(path.dirname(metricsPath), { recursive: true });
    await fs.writeFile(metricsPath, `${JSON.stringify({
      schemaVersion: 1,
      sessionId: 'session-1',
      runId: 'session-1',
      iteration: 1,
      primaryMetric: 'val_loss',
      direction: 'lower',
      timestamp: '2026-05-05T00:00:01.000Z',
      generator: 'loop_engine',
      metricName: 'val_loss',
      metricValue: null,
      status: 'FAILED',
      hypothesis: 'bad payload',
      durationMs: 1000,
      startedAt: '2026-05-05T00:00:00.000Z',
      finishedAt: '2026-05-05T00:00:01.000Z',
    })}\n`, 'utf8');

    await expect(readAllMetrics(cfg, 'session-1', 'lower')).rejects.toThrow(
      'FAILED metrics artifacts must include a failReason.',
    );
  });

  it('summarizes numeric metrics', () => {
    const summary = summarize([
      {
        iteration: 1,
        sessionId: 'session-1',
        metricName: 'val_loss',
        metricValue: 1.0,
        status: 'IMPROVED',
        hypothesis: 'baseline',
        durationMs: 100,
        startedAt: '2026-05-05T00:00:00.000Z',
        finishedAt: '2026-05-05T00:00:00.100Z',
      },
      {
        iteration: 2,
        sessionId: 'session-1',
        metricName: 'val_loss',
        metricValue: 0.8,
        status: 'IMPROVED',
        hypothesis: 'dropout',
        durationMs: 100,
        startedAt: '2026-05-05T00:01:00.000Z',
        finishedAt: '2026-05-05T00:01:00.100Z',
      },
    ], 'lower');

    expect(summary.best?.iteration).toBe(2);
    expect(summary.mean).toBeCloseTo(0.9);
    expect(summary.std).toBeGreaterThan(0);
    expect(summary.noiseFloor).toBeGreaterThanOrEqual(0);
    expect(summary.confidence).toBeGreaterThanOrEqual(0);
  });
});
