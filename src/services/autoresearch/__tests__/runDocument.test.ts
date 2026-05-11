import { describe, expect, it } from '@jest/globals';
import type { AutoResearchRunRecord } from '../history';
import { buildAutoResearchRunDocument } from '../runDocument';

function createRun(overrides: Partial<AutoResearchRunRecord> = {}): AutoResearchRunRecord {
  return {
    id: 'run-1',
    title: 'tiny-autoresearch-digits · cv_accuracy',
    status: 'failed',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:06:00.000Z',
    startedAt: '2026-05-06T00:00:00.000Z',
    endedAt: '2026-05-06T00:06:00.000Z',
    config: {
      experimentDir: '/Users/yuhansong/Documents/tiny-autoresearch-digits',
      workdir: '/Users/yuhansong/autoresearch',
      sessionFilePath: '/Users/yuhansong/autoresearch/.pipi-shrimp/session.md',
      livingDocPath: '/Users/yuhansong/autoresearch/.pipi-shrimp/runs/run-1/autoresearch.md',
      metric: 'cv_accuracy',
      direction: 'higher',
      iterations: 5,
      baseline: 0.963284,
      configSnapshot: {
        configId: 'cfg-minimax',
        configName: 'MiniMax',
        provider: 'minimax',
        providerLabel: 'MiniMax',
        apiFormat: 'openai',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
        keyPresent: true,
        keyPreview: 'sk-live...1234 (32 chars)',
        source: 'settings.activeConfig',
      } as AutoResearchRunRecord['config']['configSnapshot'] & { apiKey?: string },
    },
    currentIteration: 2,
    bestMetricValue: 0.968,
    bestIteration: 1,
    failureCount: 1,
    iterations: [
      {
        id: 'i1',
        index: 1,
        status: 'completed',
        metricValue: 0.968,
        hypothesis: 'Tune classifier regularization',
        change: 'Adjusted C value',
        commitHash: 'abcdef1234567890',
        artifactPaths: ['/Users/yuhansong/autoresearch/run-1/iter-1/metrics.json'],
      },
      {
        id: 'i2',
        index: 2,
        status: 'failed',
        metricValue: null,
        error: 'apiKey=sk-full-secret-value command failed',
        artifactPaths: ['/Users/yuhansong/autoresearch/run-1/iter-2/status.json'],
      },
    ],
    events: [
      {
        id: 'e1',
        runId: 'run-1',
        timestamp: '2026-05-06T00:01:00.000Z',
        level: 'info',
        phase: 'evaluation',
        message: 'Iteration completed.',
      },
      {
        id: 'e2',
        runId: 'run-1',
        timestamp: '2026-05-06T00:02:00.000Z',
        level: 'error',
        phase: 'agent_execution',
        message: 'authorization: Bearer sk-full-secret-value',
      },
    ],
    summary: 'apiKey=sk-full-secret-value final failure',
    liveOutputExcerpt: 'token=sk-full-secret-value\nmetric=0.968',
    ...overrides,
  };
}

describe('AutoResearch run document', () => {
  it('builds document metadata, metric summary, iterations, artifacts, and events', () => {
    const document = buildAutoResearchRunDocument(createRun());

    expect(document.title).toContain('cv_accuracy');
    expect(document.badge).toBe('failed');
    expect(document.path).toContain('autoresearch.md');
    expect(document.tags).toEqual(expect.arrayContaining(['autoresearch', 'cv_accuracy', 'failed', 'minimax', 'MiniMax-M2.7']));
    expect(document.markdown).toContain('Baseline: 0.963284');
    expect(document.markdown).toContain('Best: 0.968 at iteration 1');
    expect(document.markdown).toContain('Provider: MiniMax');
    expect(document.markdown).toContain('Model display: MiniMax · MiniMax-M2.7');
    expect(document.markdown).toContain('| #1 | keep | 0.968 | +0.0047 abs · +0.49% | Adjusted C value |');
    expect(document.markdown).toContain('/Users/yuhansong/autoresearch/run-1/iter-1/metrics.json');
    expect(document.markdown).toContain('Iteration completed.');
  });

  it('does not include full API keys from config, events, errors, or live output', () => {
    const run = createRun();
    (run.config.configSnapshot as typeof run.config.configSnapshot & { apiKey?: string }).apiKey = 'sk-full-secret-value';

    const document = buildAutoResearchRunDocument(run);

    expect(document.markdown).not.toContain('sk-full-secret-value');
    expect(document.markdown).not.toContain('apiKey=sk-full-secret-value');
    expect(document.markdown).toContain('[redacted]');
    expect(document.markdown).toContain('sk-live...1234');
  });
});