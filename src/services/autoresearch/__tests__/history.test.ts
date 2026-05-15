import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  AUTORESEARCH_HISTORY_STORAGE_KEY,
  loadPersistedAutoResearchHistory,
  persistAutoResearchHistory,
  redactAutoResearchSensitiveText,
  toHistoryConfigSnapshot,
  type AutoResearchRunRecord,
} from '../history';

const storage = {
  data: {} as Record<string, string>,
  getItem: jest.fn((key: string) => storage.data[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    storage.data[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete storage.data[key];
  }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

function createRun(overrides: Partial<AutoResearchRunRecord> = {}): AutoResearchRunRecord {
  return {
    id: 'run-1',
    title: 'digits · val_loss',
    status: 'running',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:01.000Z',
    startedAt: '2026-05-05T00:00:00.000Z',
    config: {
      experimentDir: '/tmp/exp',
      workdir: '/tmp/work',
      metric: 'val_loss',
      direction: 'lower',
      iterations: 5,
      configSnapshot: {
        configName: 'MiniMax',
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        keyPresent: true,
        keyPreview: 'secret...',
        source: 'settings.activeConfig',
      },
    },
    currentIteration: 1,
    bestMetricValue: null,
    bestIteration: null,
    failureCount: 0,
    iterations: [],
    events: [],
    ...overrides,
  };
}

describe('autoresearch history storage', () => {
  beforeEach(() => {
    storage.data = {};
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();
  });

  it('marks in-flight runs as interrupted when loading persisted history', () => {
    storage.data[AUTORESEARCH_HISTORY_STORAGE_KEY] = JSON.stringify({
      version: 1,
      selectedRunId: 'run-1',
      runs: [createRun({
        resumeToken: {
          schemaVersion: 1,
          sessionId: 'run-1',
          status: 'running',
          sshConfig: {
            mode: 'local',
            host: '',
            user: 'root',
            keyPath: '',
            port: 22,
            remoteWorkDir: '/tmp/work',
            authMode: 'agent',
            password: '',
          },
          experimentDir: '/tmp/exp',
          metricName: 'val_loss',
          metricDirection: 'lower',
          maxIterations: 5,
          baseline: null,
          currentIteration: 1,
          pendingIteration: 2,
          replayIteration: true,
          resumable: true,
          createdAt: '2026-05-05T00:00:00.000Z',
          lastUpdatedAt: '2026-05-05T00:00:01.000Z',
        },
      })],
    });

    const history = loadPersistedAutoResearchHistory('2026-05-05T01:00:00.000Z');

    expect(history.runs[0]?.status).toBe('interrupted');
    expect(history.runs[0]?.endedAt).toBe('2026-05-05T01:00:00.000Z');
    expect(history.runs[0]?.events.at(-1)?.message).toContain('interrupted');
    expect(history.runs[0]?.resumeToken?.status).toBe('interrupted');
    expect(storage.data[AUTORESEARCH_HISTORY_STORAGE_KEY]).toContain('"status":"interrupted"');

    const reloaded = loadPersistedAutoResearchHistory('2026-05-05T02:00:00.000Z');
    expect(reloaded.runs[0]?.events.filter((event) => event.message.includes('interrupted'))).toHaveLength(1);
  });

  it('converts persisted cooldown runs into inspect-only interrupted snapshots', () => {
    storage.data[AUTORESEARCH_HISTORY_STORAGE_KEY] = JSON.stringify({
      version: 1,
      selectedRunId: 'run-1',
      runs: [createRun({
        status: 'waiting_rate_limit',
        summary: 'Provider rate limited the run. Cooling down 15s.',
      })],
    });

    const history = loadPersistedAutoResearchHistory('2026-05-05T01:00:00.000Z');

    expect(history.runs[0]?.status).toBe('interrupted');
    expect(history.runs[0]?.summary).toBe('Provider rate limited the run. Cooling down 15s.');
    expect(history.runs[0]?.events.at(-1)?.message).toContain('Inspect-only mode restored');
  });

  it('persists run history and selected run id', () => {
    persistAutoResearchHistory([createRun({ status: 'completed', reason: 'Reflection did not provide a summary.' })], 'run-1');

    const raw = storage.data[AUTORESEARCH_HISTORY_STORAGE_KEY];
    expect(raw).toBeDefined();
    expect(raw).toContain('"selectedRunId":"run-1"');
    expect(raw).toContain('"status":"completed"');
    expect(raw).toContain('"reason":"Reflection did not provide a summary."');
  });

  it('falls back safely when persisted history is corrupted', () => {
    storage.data[AUTORESEARCH_HISTORY_STORAGE_KEY] = '{bad json';

    const history = loadPersistedAutoResearchHistory();

    expect(history).toEqual({
      version: 1,
      selectedRunId: null,
      runs: [],
    });
  });

  it('prunes oversized history and truncates event/live output content', () => {
    const longMessage = 'x'.repeat(5000);
    const longOutput = `${'y'.repeat(500)} token=super-secret-token ${'z'.repeat(49500)}`;
    const runs = Array.from({ length: 45 }, (_, index) => createRun({
      id: `run-${index}`,
      updatedAt: `2026-05-05T00:00:${String(index).padStart(2, '0')}.000Z`,
      liveOutputExcerpt: longOutput,
      iterations: [
        {
          id: `iter-${index}`,
          index: 1,
          status: 'completed' as const,
          metricValue: 0.9,
          commitHash: 'abcdef1234567890',
        },
      ],
      events: [
        {
          id: `event-${index}`,
          runId: `run-${index}`,
          timestamp: '2026-05-05T00:00:00.000Z',
          level: 'info' as const,
          phase: 'system' as const,
          message: `password=super-secret-password ${longMessage}`,
          metadata: { apiKey: 'super-secret-key', note: 'keyPath=/Users/demo/.ssh/id_ed25519' },
        },
      ],
    }));

    persistAutoResearchHistory(runs, 'run-44');
    const history = loadPersistedAutoResearchHistory();
    const raw = storage.data[AUTORESEARCH_HISTORY_STORAGE_KEY];

    expect(history.runs).toHaveLength(40);
    expect(history.selectedRunId).toBe('run-44');
    expect(history.runs[0]?.liveOutputExcerpt?.length).toBeLessThanOrEqual(20000);
    expect(history.runs[0]?.events[0]?.message.length).toBeLessThanOrEqual(1000);
    expect(history.runs[0]?.iterations[0]?.commitHash).toBe('abcdef1234567890');
    expect(raw).not.toContain('super-secret-key');
    expect(raw).not.toContain('super-secret-token');
    expect(raw).not.toContain('super-secret-password');
    expect(raw).not.toContain('/Users/demo/.ssh/id_ed25519');
    expect(raw).not.toContain('"apiKey":"super-secret-key"');
  });

  it('normalizes config snapshots with key presence instead of raw keys', () => {
    const snapshot = toHistoryConfigSnapshot({
      configName: 'MiniMax',
      provider: 'minimax',
      apiFormat: 'openai',
      baseUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M2.7',
      keyPreview: 'secret...',
      keyPresent: true,
      source: 'settings.activeConfig',
    });

    expect(snapshot.keyPresent).toBe(true);
    expect(snapshot.keyPreview).toBe('secret...');
    expect((snapshot as unknown as Record<string, unknown>).apiKey).toBeUndefined();
  });

  it('redacts database uris and credential-like environment variables', () => {
    const raw = 'DATABASE_URL=postgres://demo:secret@db.internal:5432/app REDIS_URL=redis://cache.internal:6379 AUTH_TOKEN=secret-token';

    const sanitized = redactAutoResearchSensitiveText(raw);

    expect(sanitized).not.toContain('secret@db.internal');
    expect(sanitized).not.toContain('cache.internal:6379');
    expect(sanitized).not.toContain('secret-token');
    expect(sanitized).toContain('DATABASE_URL=[redacted]');
    expect(sanitized).toContain('REDIS_URL=[redacted]');
    expect(sanitized).toContain('AUTH_TOKEN=[redacted]');
  });

  it('defaults to the latest run when selectedRunId is missing or stale', () => {
    storage.data[AUTORESEARCH_HISTORY_STORAGE_KEY] = JSON.stringify({
      version: 1,
      selectedRunId: 'missing-run',
      runs: [
        createRun({ id: 'older', updatedAt: '2026-05-05T00:00:00.000Z' }),
        createRun({ id: 'latest', updatedAt: '2026-05-05T00:00:10.000Z' }),
      ],
    });

    const history = loadPersistedAutoResearchHistory();
    expect(history.selectedRunId).toBe('latest');
    expect(history.runs[0]?.id).toBe('latest');
  });
});
