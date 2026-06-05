import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

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

jest.mock('../notifier', () => ({
  createNotifier: () => mockNotifier,
}));

jest.mock('../expLogger', () => ({
  logExperiment: (...args: unknown[]) => mockLogExperiment(...args),
}));

jest.mock('../platformGuard', () => ({
  assertSupportedPlatform: jest.fn().mockResolvedValue(undefined),
}));

import { useAutoResearchStore } from '@/store/autoresearchStore';
import { createLocalSshConfig, initGitRepo, installLocalInvokeMock } from './helpers';
import { startExperimentLoop } from '../loopEngine';
import { parseMetricsArtifactPayload } from '../metricsSchema';
import { getCurrentRunDir } from '../terminalRunner';
import { getSessionRunPaths, listIterations, readTargetText } from '../runDir';

const DEFAULT_RUN_SCRIPT = `import json
from pathlib import Path

Path('metrics.json').write_text(json.dumps({
    'metricName': 'cv_accuracy',
    'metricValue': 0.9751,
    'status': 'IMPROVED',
    'hypothesis': 'cache fold preprocessing',
}, indent=2))

print('experiment complete')
`;

async function readIfExists(targetPath: string): Promise<string | null> {
  try {
    return await fs.readFile(targetPath, 'utf8');
  } catch {
    return null;
  }
}

async function ensureExperimentFixture(experimentDir: string): Promise<void> {
  const runScript = (await readIfExists(path.join(experimentDir, 'run_experiment.py'))) ?? DEFAULT_RUN_SCRIPT;
  const readme = (await readIfExists(path.join(experimentDir, 'README.md'))) ?? '# AutoResearch Smoke Fixture\n';
  const notes = (await readIfExists(path.join(experimentDir, 'AUTORESEARCH.md'))) ?? '# Smoke Notes\n';

  await initGitRepo(experimentDir, {
    'run_experiment.py': runScript,
    'README.md': readme,
    'AUTORESEARCH.md': notes,
  });
}

jest.setTimeout(30000);

describe('local AutoResearch smoke', () => {
  let tempRoot: string | null;

  beforeEach(async () => {
    tempRoot = null;
    installLocalInvokeMock(mockInvoke);
    mockInvoke.mockClear();
    mockLogExperiment.mockClear();
    mockNotifier.onExperimentComplete.mockClear();
    mockNotifier.onLoopStopped.mockClear();
    mockNotifier.onTrendReport.mockClear();
    useAutoResearchStore.getState().resetSession();
  });

  afterEach(async () => {
    useAutoResearchStore.getState().resetSession();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('runs a minimal local iteration and writes smoke artifacts', async () => {
    const smokeRoot = process.env.AUTORESEARCH_SMOKE_ROOT
      || await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-local-smoke-'));
    const experimentDir = process.env.AUTORESEARCH_SMOKE_EXPERIMENT_DIR
      || path.join(smokeRoot, 'experiment');
    const workDir = process.env.AUTORESEARCH_SMOKE_WORKDIR
      || path.join(smokeRoot, 'autoresearch-work');
    const resultsDir = process.env.AUTORESEARCH_SMOKE_RESULTS_DIR
      || path.join(smokeRoot, 'smoke-results');
    const sessionId = 'autoresearch-local-smoke';
    const sessionFilePath = path.join(workDir, 'session.md');
    if (!process.env.AUTORESEARCH_SMOKE_ROOT) {
      tempRoot = smokeRoot;
    }

    await fs.mkdir(experimentDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });
    await ensureExperimentFixture(experimentDir);

    const cfg = createLocalSshConfig(workDir);
    useAutoResearchStore.getState().initSession({
      id: sessionId,
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: cfg,
      experimentDir,
      sessionFilePath,
    });

    const validMetrics = {
      metricName: 'cv_accuracy',
      metricValue: 0.9751,
      status: 'IMPROVED' as const,
      hypothesis: 'cache fold preprocessing',
      change: 'reuse transformed folds',
      reasoning: 'The local smoke fixture should create a parseable metrics artifact.',
      artifactPaths: ['metrics.json'],
    };

    const sendMessage = jest.fn(async () => {
      const runDir = getCurrentRunDir();
      if (!runDir) {
        throw new Error('run dir not set');
      }

      await fs.writeFile(runDir.hypothesisPath, `${validMetrics.hypothesis}\n`, 'utf8');
      await fs.writeFile(runDir.metricsPath, JSON.stringify(validMetrics, null, 2), 'utf8');
      return JSON.stringify(validMetrics);
    });

    await startExperimentLoop(sendMessage);

    const store = useAutoResearchStore.getState();
    const run = store.runHistory.find((entry) => entry.id === sessionId);
    const sessionPaths = getSessionRunPaths(cfg, sessionId);
    const iterations = await listIterations(cfg, sessionId);
    const [firstRun] = iterations;
    const writtenMetrics = await readTargetText(cfg, firstRun.metricsPath);
    const invalidMetrics = {
      ...validMetrics,
      runId: 'stale-run',
      sessionId,
      iteration: 1,
      primaryMetric: 'cv_accuracy',
      direction: 'higher' as const,
      schemaVersion: 1 as const,
      timestamp: '2026-05-15T00:00:00.000Z',
      generator: 'agent' as const,
    };
    const invalidParse = parseMetricsArtifactPayload(invalidMetrics, {
      expectedSessionId: sessionId,
      expectedRunId: sessionId,
      expectedIteration: 1,
      expectedMetricName: 'cv_accuracy',
      expectedDirection: 'higher',
    });
    const failedArtifact = parseMetricsArtifactPayload({
      ...invalidMetrics,
      runId: sessionId,
      metricValue: null,
      status: 'FAILED',
      failReason: 'synthetic smoke failure',
    }, {
      expectedSessionId: sessionId,
      expectedRunId: sessionId,
      expectedIteration: 1,
      expectedMetricName: 'cv_accuracy',
      expectedDirection: 'higher',
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(iterations).toHaveLength(1);
    expect(store.experiments[0]?.status).toBe('IMPROVED');
    expect(run?.status).toBe('completed');
    expect(writtenMetrics).toContain('"metricValue": 0.9751');
    expect(invalidParse.value).toBeNull();
    expect(invalidParse.error).toContain('Current AutoResearch uses sessionId as runId.');
    expect(failedArtifact.error).toBeUndefined();
    expect(failedArtifact.value?.status).toBe('FAILED');
    expect(failedArtifact.value?.failReason).toBe('synthetic smoke failure');

    await fs.writeFile(path.join(resultsDir, 'metrics-valid.json'), writtenMetrics || '', 'utf8');
    await fs.writeFile(path.join(resultsDir, 'metrics-invalid.json'), JSON.stringify(invalidMetrics, null, 2), 'utf8');
    await fs.writeFile(
      path.join(resultsDir, 'parse-output.log'),
      [
        `invalid_parse_error=${invalidParse.error ?? 'missing'}`,
        `failed_artifact_status=${failedArtifact.value?.status ?? 'missing'}`,
        `failed_artifact_fail_reason=${failedArtifact.value?.failReason ?? 'missing'}`,
        `metrics_jsonl_path=${sessionPaths.metricsJsonlPath}`,
      ].join('\n') + '\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(resultsDir, 'smoke-summary.txt'),
      [
        `session_id=${sessionId}`,
        `run_status=${run?.status ?? 'missing'}`,
        `iteration_status=${store.experiments[0]?.status ?? 'missing'}`,
        `iteration_dir=${firstRun.iterDir}`,
        `metrics_path=${firstRun.metricsPath}`,
        `transcript_path=${firstRun.transcriptPath}`,
      ].join('\n') + '\n',
      'utf8',
    );

    console.log('AUTO_RESEARCH_TS_SMOKE_PASS');
  });
});