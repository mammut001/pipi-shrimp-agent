import { describe, expect, it } from '@jest/globals';

import {
  normalizeIterationMetricsRecord,
  parseMetricsArtifactPayload,
  parsePersistedIterationMetricsLine,
} from '../metricsSchema';

function createValidArtifact() {
  return {
    schemaVersion: 1 as const,
    sessionId: 'run-1',
    runId: 'run-1',
    iteration: 1,
    primaryMetric: 'cv_accuracy',
    direction: 'higher' as const,
    timestamp: '2026-05-05T00:00:01.000Z',
    generator: 'agent' as const,
    metricName: 'cv_accuracy',
    metricValue: 0.42,
    status: 'IMPROVED' as const,
    hypothesis: 'cache fold preprocessing',
    change: 'reuse transformed examples',
    reasoning: 'preprocessing dominated iteration time',
    artifactPaths: ['runs/run-1/iter-001/metrics.json'],
  };
}

describe('metricsSchema', () => {
  it('accepts a valid agent metrics artifact', () => {
    const result = parseMetricsArtifactPayload(createValidArtifact(), {
      expectedSessionId: 'run-1',
      expectedRunId: 'run-1',
      expectedIteration: 1,
      expectedMetricName: 'cv_accuracy',
      expectedDirection: 'higher',
    });

    expect(result.error).toBeUndefined();
    expect(result.value?.runId).toBe('run-1');
    expect(result.value?.primaryMetric).toBe('cv_accuracy');
  });

  it('accepts FAILED artifacts with null metricValue only when failReason is present', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      metricValue: null,
      status: 'FAILED',
      failReason: 'timeout',
    }, {
      expectedSessionId: 'run-1',
      expectedRunId: 'run-1',
      expectedIteration: 1,
      expectedMetricName: 'cv_accuracy',
      expectedDirection: 'higher',
    });

    expect(result.error).toBeUndefined();
    expect(result.value?.metricValue).toBeNull();
    expect(result.value?.failReason).toBe('timeout');
  });

  it('treats blank optional agent narrative fields as omitted', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      change: '',
      reasoning: '   ',
    }, {
      expectedSessionId: 'run-1',
      expectedRunId: 'run-1',
      expectedIteration: 1,
      expectedMetricName: 'cv_accuracy',
      expectedDirection: 'higher',
    });

    expect(result.error).toBeUndefined();
    expect(result.value?.change).toBeUndefined();
    expect(result.value?.reasoning).toBeUndefined();
  });

  it('fills a default failReason when FAILED artifacts omit it', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      metricValue: null,
      status: 'FAILED',
    });

    expect(result.error).toBeUndefined();
    expect(result.value?.status).toBe('FAILED');
    expect(result.value?.failReason).toBe('unspecified failure');
  });

  it('coerces failReason null on FAILED artifacts instead of throwing Expected string, received null', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      metricValue: null,
      status: 'FAILED',
      failReason: null,
    });

    expect(result.error).toBeUndefined();
    expect(result.value?.failReason).toBe('unspecified failure');
  });

  it('rejects null metricValue for non-FAILED statuses', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      metricValue: null,
      status: 'NOT_IMPROVED',
    });

    expect(result.value).toBeNull();
    expect(result.error).toContain('metricValue may be null only when status is FAILED with a failReason.');
  });

  it('rejects stale runId values with the current sessionId-runId contract message', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      runId: 'stale-run',
    }, {
      expectedSessionId: 'run-1',
      expectedRunId: 'run-1',
    });

    expect(result.value).toBeNull();
    expect(result.error).toContain('Current AutoResearch uses sessionId as runId');
  });

  it('rejects sessionId mismatches', () => {
    const result = parseMetricsArtifactPayload(createValidArtifact(), {
      expectedSessionId: 'run-2',
    });

    expect(result.value).toBeNull();
    expect(result.error).toContain('sessionId must be run-2');
  });

  it('rejects iteration mismatches', () => {
    const result = parseMetricsArtifactPayload(createValidArtifact(), {
      expectedIteration: 2,
    });

    expect(result.value).toBeNull();
    expect(result.error).toContain('iteration must be 2');
  });

  it('rejects metricName mismatches', () => {
    const result = parseMetricsArtifactPayload(createValidArtifact(), {
      expectedMetricName: 'val_loss',
    });

    expect(result.value).toBeNull();
    expect(result.error).toContain('metricName must be val_loss');
  });

  it('rejects primaryMetric mismatches', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      primaryMetric: 'val_loss',
    });

    expect(result.value).toBeNull();
    expect(result.error).toContain('primaryMetric must match metricName.');
  });

  it('rejects direction mismatches', () => {
    const result = parseMetricsArtifactPayload(createValidArtifact(), {
      expectedDirection: 'lower',
    });

    expect(result.value).toBeNull();
    expect(result.error).toContain('direction must be lower');
  });

  it('rejects the wrong schemaVersion', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      schemaVersion: 2,
    });

    expect(result.value).toBeNull();
    expect(result.error).toContain('schemaVersion');
  });

  it('strips unknown extra top-level fields on agent artifacts', () => {
    const result = parseMetricsArtifactPayload({
      ...createValidArtifact(),
      unexpected: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.value?.metricValue).toBe(0.42);
    expect((result.value as { unexpected?: unknown } | null)?.unexpected).toBeUndefined();
  });

  it('accepts native sklearn-style metrics.json objects', () => {
    const result = parseMetricsArtifactPayload(
      { accuracy: 0.91, loss: 0.12 },
      { expectedMetricName: 'cv_accuracy' },
    );

    expect(result.error).toBeUndefined();
    expect(result.value?.metricName).toBe('cv_accuracy');
    expect(result.value?.metricValue).toBe(0.91);
    expect(result.value?.status).toBe('IMPROVED');
  });

  it('coerces string metricValue and empty hypothesis', () => {
    const result = parseMetricsArtifactPayload({
      metricName: 'cv_accuracy',
      metricValue: '0.9751',
      status: 'IMPROVED',
      hypothesis: '',
    });

    expect(result.error).toBeUndefined();
    expect(result.value?.metricValue).toBe(0.9751);
    expect(result.value?.hypothesis).toBe('unspecified hypothesis');
  });

  it('normalizes legacy persisted records with the current runId contract', () => {
    const normalized = parsePersistedIterationMetricsLine(JSON.stringify({
      iteration: 1,
      sessionId: 'run-legacy',
      metricName: 'val_loss',
      metricValue: 0.91,
      status: 'IMPROVED',
      hypothesis: 'legacy payload',
      durationMs: 1000,
      startedAt: '2026-05-05T00:00:00.000Z',
      finishedAt: '2026-05-05T00:00:01.000Z',
    }), {
      sessionId: 'run-legacy',
      direction: 'lower',
      source: 'metrics.jsonl:line 1',
    });

    expect(normalized.runId).toBe('run-legacy');
    expect(normalized.primaryMetric).toBe('val_loss');
    expect(normalized.direction).toBe('lower');
    expect(normalized.generator).toBe('loop_engine');
  });

  it('reports malformed persisted JSON with the source location', () => {
    expect(() => parsePersistedIterationMetricsLine('{bad json', {
      sessionId: 'run-1',
      source: 'metrics.jsonl:line 7',
    })).toThrow('metrics.jsonl:line 7: invalid JSON');
  });

  it('fills runId from sessionId when normalizing persisted iteration records', () => {
    const normalized = normalizeIterationMetricsRecord({
      iteration: 3,
      sessionId: 'run-normalized',
      metricName: 'cv_accuracy',
      metricValue: null,
      status: 'FAILED',
      failReason: 'missing metrics',
      hypothesis: 'emit failed metrics',
      durationMs: 400,
      startedAt: '2026-05-05T00:00:00.000Z',
      finishedAt: '2026-05-05T00:00:00.400Z',
    }, {
      sessionId: 'run-normalized',
      direction: 'higher',
      generator: 'loop_engine',
    });

    expect(normalized.runId).toBe('run-normalized');
    expect(normalized.primaryMetric).toBe('cv_accuracy');
    expect(normalized.timestamp).toBe('2026-05-05T00:00:00.400Z');
  });

  it('normalizes blank optional persisted narrative fields before validation', () => {
    const normalized = normalizeIterationMetricsRecord({
      iteration: 4,
      sessionId: 'run-blank-narrative',
      metricName: 'score',
      metricValue: null,
      status: 'FAILED',
      failReason: 'agent execution error',
      hypothesis: 'record failed iteration',
      change: '',
      reasoning: '  ',
      durationMs: 250,
      startedAt: '2026-05-05T00:00:00.000Z',
      finishedAt: '2026-05-05T00:00:00.250Z',
    }, {
      sessionId: 'run-blank-narrative',
      direction: 'higher',
      generator: 'loop_engine',
    });

    expect(normalized.change).toBeUndefined();
    expect(normalized.reasoning).toBeUndefined();
  });
});
