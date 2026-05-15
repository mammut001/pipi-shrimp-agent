import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockPathExistsOnTarget = jest.fn();
const mockReadTargetText = jest.fn();
const mockWriteTargetText = jest.fn();
const mockGetSessionRunPaths = jest.fn(() => ({
  sessionDir: '/tmp/workdir/runs/run-1',
  sessionFilePath: '/tmp/workdir/runs/run-1/session.md',
  livingDocPath: '/tmp/workdir/runs/run-1/autoresearch.md',
  metricsJsonlPath: '/tmp/workdir/runs/run-1/metrics.jsonl',
  runConfigPath: '/tmp/workdir/runs/run-1/run_config.json',
}));
const mockSeedFromBootstrap = jest.fn();
const mockInitFromBootstrap = jest.fn();

const storeState = {
  setSuccessCriteria: jest.fn(),
  setPrimaryMetric: jest.fn(),
  setBootstrapKind: jest.fn(),
  setBestMetric: jest.fn(),
  updateRunPaths: jest.fn(),
};

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: () => storeState,
  },
}));

jest.mock('@/services/autoresearch/runDir', () => ({
  pathExistsOnTarget: (...args: unknown[]) => mockPathExistsOnTarget(...args),
  readTargetText: (...args: unknown[]) => mockReadTargetText(...args),
  writeTargetText: (...args: unknown[]) => mockWriteTargetText(...args),
  getSessionRunPaths: (...args: unknown[]) => mockGetSessionRunPaths(...args),
}));

jest.mock('@/services/autoresearch/livingDoc', () => ({
  seedFromBootstrap: (...args: unknown[]) => mockSeedFromBootstrap(...args),
}));

jest.mock('@/services/autoresearch/metricsStore', () => ({
  initFromBootstrap: (...args: unknown[]) => mockInitFromBootstrap(...args),
}));

import { applyBootstrapIfPresent } from '../applyBootstrap';

function createResultJson() {
  return JSON.stringify({
    status: 'ready',
    plan: {
      researchGoal: 'Improve CIFAR10 accuracy.',
      successCriteria: 'Beat the baseline by 1 point.',
      primaryMetric: 'accuracy',
      secondaryMetrics: [],
      papers: [{ source: 'manual', title: 'Baseline Paper' }],
      baselines: [{
        name: 'ResNet50',
        task: 'classification',
        dataset: 'CIFAR10',
        reportedMetrics: [{ name: 'accuracy', value: 95.1 }],
        method: { summary: 'A baseline.' },
        reproducibility: { hasOfficialCode: true },
      }],
      scaffold: {
        templateId: 'python-ml-baseline',
        workDir: '/tmp/workdir',
        language: 'python',
        entryCommand: 'python3 run_experiment.py',
        vars: { project_name: 'demo' },
        files: [{ path: 'run_experiment.py', purpose: 'Loop entrypoint' }],
      },
      gitInitialized: true,
      conversationalTemplateId: 'beat-baseline',
    },
    warnings: [],
    unresolvedQuestions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
  });
}

describe('applyBootstrapIfPresent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadTargetText.mockResolvedValue(null);
  });

  it('applies a ready bootstrap file exactly once to session artifacts', async () => {
    mockPathExistsOnTarget.mockResolvedValue(true);
    mockReadTargetText.mockResolvedValue(createResultJson());
    mockSeedFromBootstrap.mockResolvedValue(true);
    mockInitFromBootstrap.mockResolvedValue(true);

    const applied = await applyBootstrapIfPresent({
      mode: 'local',
      host: '',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/tmp/workdir',
      authMode: 'agent',
      password: '',
    }, 'run-1');

    expect(applied).toBe(true);
    expect(storeState.setSuccessCriteria).toHaveBeenCalledTimes(1);
    expect(storeState.setPrimaryMetric).toHaveBeenCalledTimes(1);
    expect(mockSeedFromBootstrap).toHaveBeenCalledTimes(1);
    expect(mockInitFromBootstrap).toHaveBeenCalledTimes(1);
    expect(mockWriteTargetText).toHaveBeenCalledTimes(1);
  });

  it('skips reapplying the same bootstrap result once the session receipt exists', async () => {
    mockPathExistsOnTarget.mockResolvedValue(true);
    mockReadTargetText.mockImplementation(async (_cfg: unknown, targetPath: string) => {
      if (String(targetPath).endsWith('bootstrap.applied.json')) {
        return JSON.stringify({
          schemaVersion: 1,
          sessionId: 'run-1',
          bootstrapCreatedAt: '2026-01-01T00:00:00.000Z',
          bootstrapPath: '/tmp/workdir/.pipi-shrimp/autoresearch.bootstrap.json',
          appliedAt: '2026-01-01T00:05:00.000Z',
        });
      }

      return createResultJson();
    });

    const applied = await applyBootstrapIfPresent({
      mode: 'local',
      host: '',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/tmp/workdir',
      authMode: 'agent',
      password: '',
    }, 'run-1');

    expect(applied).toBe(false);
    expect(mockSeedFromBootstrap).not.toHaveBeenCalled();
    expect(mockInitFromBootstrap).not.toHaveBeenCalled();
    expect(mockWriteTargetText).not.toHaveBeenCalled();
  });

  it('returns false when the bootstrap file is absent', async () => {
    mockPathExistsOnTarget.mockResolvedValue(false);

    const applied = await applyBootstrapIfPresent({
      mode: 'local',
      host: '',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/tmp/workdir',
      authMode: 'agent',
      password: '',
    }, 'run-1');

    expect(applied).toBe(false);
    expect(mockSeedFromBootstrap).not.toHaveBeenCalled();
    expect(mockInitFromBootstrap).not.toHaveBeenCalled();
  });
});