import { describe, expect, it } from '@jest/globals';

import type { AutoResearchRunRecord } from '@/services/autoresearch/history';
import {
  assertAutoResearchLifecycleUnlocked,
  buildAutoResearchRunLockMessage,
  getAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';

function createRun(overrides: Partial<AutoResearchRunRecord> = {}): AutoResearchRunRecord {
  return {
    id: 'run-1',
    title: 'digits · accuracy',
    status: 'running',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:01.000Z',
    config: {
      experimentDir: '/tmp/exp',
      workdir: '/tmp/work',
      metric: 'accuracy',
      direction: 'higher',
      iterations: 5,
      configSnapshot: {
        configName: 'Primary',
        provider: 'openai',
        model: 'gpt-4.1',
        keyPresent: true,
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

describe('runLock', () => {
  it('locks setup mutations while a run is active or paused', () => {
    const runningLock = getAutoResearchLifecycleLock({
      id: 'run-1',
      loopState: 'running',
      runHistory: [createRun()],
    });
    expect(runningLock.locked).toBe(true);
    expect(buildAutoResearchRunLockMessage('change the setup', runningLock)).toBe(
      'AutoResearch is still running. Stop the active run before you change the setup.',
    );

    const pausedLock = getAutoResearchLifecycleLock({
      id: 'run-1',
      loopState: 'paused',
      runHistory: [createRun()],
    });
    expect(pausedLock.locked).toBe(true);
    expect(pausedLock.reason).toBe('AutoResearch is paused.');
  });

  it('keeps the lock during rate-limit and reflection recovery states', () => {
    const rateLimited = getAutoResearchLifecycleLock({
      id: 'run-1',
      loopState: 'running',
      runHistory: [createRun({ status: 'waiting_rate_limit' })],
    });
    expect(rateLimited.locked).toBe(true);
    expect(rateLimited.reason).toBe('AutoResearch is waiting for provider rate-limit recovery.');

    expect(() => assertAutoResearchLifecycleUnlocked({
      id: 'run-1',
      loopState: 'error',
      runHistory: [createRun({ status: 'reflection_failed' })],
    }, 'start a new run')).toThrow(
      'AutoResearch is waiting for recovery acknowledgement. Stop the active run before you start a new run.',
    );
  });

  it('unlocks once the active run has stopped', () => {
    const lock = getAutoResearchLifecycleLock({
      id: 'run-1',
      loopState: 'stopped',
      runHistory: [createRun({ status: 'stopped' })],
    });

    expect(lock.locked).toBe(false);
    expect(() => assertAutoResearchLifecycleUnlocked({
      id: 'run-1',
      loopState: 'stopped',
      runHistory: [createRun({ status: 'stopped' })],
    }, 'start a new run')).not.toThrow();
  });
});