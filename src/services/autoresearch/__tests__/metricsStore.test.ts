import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-metrics-'));
    installLocalInvokeMock(mockInvoke);
    await initGitRepo(workDir);
  });

  afterEach(async () => {
    clearCurrentRunDir();
    mockInvoke.mockReset();
    await fs.rm(workDir, { recursive: true, force: true });
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
    expect(metricsFile.iteration).toBe(1);
    expect(metricsFile.metricValue).toBe(0.9);
    expect(metricsFile.change).toBe('lowered lr from 1e-3 to 5e-4');
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
        startedAt: '',
        finishedAt: '',
      },
      {
        iteration: 2,
        sessionId: 'session-1',
        metricName: 'val_loss',
        metricValue: 0.8,
        status: 'IMPROVED',
        hypothesis: 'dropout',
        durationMs: 100,
        startedAt: '',
        finishedAt: '',
      },
    ], 'lower');

    expect(summary.best?.iteration).toBe(2);
    expect(summary.mean).toBeCloseTo(0.9);
    expect(summary.std).toBeGreaterThan(0);
    expect(summary.noiseFloor).toBeGreaterThanOrEqual(0);
    expect(summary.confidence).toBeGreaterThanOrEqual(0);
  });
});
