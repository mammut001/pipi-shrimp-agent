import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mockInvoke = jest.fn();
const mockLogExperiment = jest.fn().mockResolvedValue(undefined);
const mockNotifier = {
  onExperimentComplete: jest.fn().mockResolvedValue(undefined),
  onLoopStopped: jest.fn().mockResolvedValue(undefined),
  onTrendReport: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('../expLogger', () => ({
  logExperiment: (...args: unknown[]) => mockLogExperiment(...args),
}));

jest.mock('../notifier', () => ({
  createNotifier: () => mockNotifier,
}));

jest.mock('../platformGuard', () => ({
  assertSupportedPlatform: jest.fn().mockResolvedValue(undefined),
}));

import { createLocalSshConfig, initGitRepo, installLocalInvokeMock } from './helpers';
import { startExperimentLoop } from '../loopEngine';
import { getCurrentRunDir } from '../terminalRunner';
import { getSessionRunPaths, readTargetText } from '../runDir';
import { useAutoResearchStore } from '@/store/autoresearchStore';

describe('loopEngine integration', () => {
  let workDir: string;
  let sessionFilePath: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-loop-'));
    sessionFilePath = path.join(workDir, 'session.md');
    installLocalInvokeMock(mockInvoke);
    await initGitRepo(workDir, {
      'train.py': 'print("train")\n',
      'session.md': '# Objective\nImprove validation loss.\n',
    });
    await fs.writeFile(sessionFilePath, '# Objective\nImprove validation loss.\n', 'utf8');
    useAutoResearchStore.getState().resetSession();
  });

  afterEach(async () => {
    mockInvoke.mockReset();
    mockLogExperiment.mockClear();
    mockNotifier.onExperimentComplete.mockClear();
    mockNotifier.onLoopStopped.mockClear();
    mockNotifier.onTrendReport.mockClear();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('records iterations, rebuilds autoresearch.md, and stops after three consecutive failures', async () => {
    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-integration',
      maxIterations: 10,
      metricName: 'val_loss',
      metricDirection: 'lower',
      sshConfig: cfg,
      sessionFilePath,
    });

    const sequence = [
      { status: 'IMPROVED', metricValue: 0.9, hypothesis: 'lower learning rate' },
      { status: 'NOT_IMPROVED', metricValue: 1.0, hypothesis: 'bigger batch size' },
      { status: 'FAILED', metricValue: null, hypothesis: 'remove warmup', failReason: 'NaN' },
      { status: 'FAILED', metricValue: null, hypothesis: 'remove warmup more', failReason: 'timeout' },
      { status: 'FAILED', metricValue: null, hypothesis: 'remove warmup again', failReason: 'OOM' },
    ] as const;

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }
      const next = sequence[runDir.iter - 1];
      await fs.writeFile(runDir.hypothesisPath, `${next.hypothesis}\n`, 'utf8');
      await fs.writeFile(
        runDir.metricsPath,
        JSON.stringify({
          metricName: 'val_loss',
          metricValue: next.metricValue,
          status: next.status,
          hypothesis: next.hypothesis,
          failReason: next.failReason,
        }, null, 2),
        'utf8',
      );
      return `EXPERIMENT_RESULT: metric_value=${next.metricValue ?? 'null'} status=${next.status}${next.failReason ? ` fail_reason="${next.failReason}"` : ''} hypothesis="${next.hypothesis}"`;
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    expect(store.experiments).toHaveLength(5);
    expect(store.consecutiveFailures).toBe(3);
    expect(store.loopState).toBe('stopped');

    const sessionPaths = getSessionRunPaths(cfg, 'autoresearch-integration');
    const metricsJsonl = await readTargetText(cfg, sessionPaths.metricsJsonlPath);
    const metricRows = (metricsJsonl || '').trim().split('\n').filter(Boolean);
    expect(metricRows).toHaveLength(5);

    const livingDoc = await readTargetText(cfg, sessionPaths.livingDocPath);
    expect(livingDoc).toContain('## Tried (kept)');
    expect(livingDoc).toContain('- iter-001: lower learning rate - IMPROVED');
    expect(livingDoc).toContain('## Tried (reverted)');

    expect(mockNotifier.onLoopStopped).toHaveBeenCalledWith('3 consecutive failures', expect.any(Object));
  });
});
