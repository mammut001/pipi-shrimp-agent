import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  AUTORESEARCH_BOOTSTRAP_SESSION_STORAGE_KEY,
  clearPersistedBootstrapSession,
  loadPersistedBootstrapSession,
  persistBootstrapSession,
  type PersistedBootstrapSession,
} from '../bootstrapSessionPersist';

const storage = {
  data: {} as Record<string, string>,
  getItem: (key: string) => storage.data[key] ?? null,
  setItem: (key: string, value: string) => {
    storage.data[key] = value;
  },
  removeItem: (key: string) => {
    delete storage.data[key];
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

function sampleSession(): PersistedBootstrapSession {
  return {
    version: 1,
    recipe: {
      researchGoal: {
        goalText: 'Keep my Ready form',
        taskType: 'reproduce_paper',
        source: 'user',
      },
      references: {},
      baselineAndMetric: {
        primaryMetric: 'accuracy',
        direction: 'higher',
      },
      workspace: {
        workDir: '/tmp/work',
        folderName: 'proj',
      },
      verification: { commands: [] },
      outputContract: {
        includeMetrics: true,
        includeArtifacts: true,
        includeCommandsRun: true,
        includeFailureReason: true,
        includeRemainingRisks: true,
      },
    },
    recipeDirty: true,
    selectedTemplateId: 'reproduce-paper',
    templatesExpanded: false,
    hasStarted: true,
    readyResult: {
      status: 'ready',
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
      unresolvedQuestions: [],
      schemaVersion: 1,
      plan: {
        researchGoal: 'Keep my Ready form',
        successCriteria: 'Beat baseline.',
        primaryMetric: 'accuracy',
        secondaryMetrics: [],
        papers: [],
        baselines: [{
          name: 'B',
          task: 't',
          dataset: 'd',
          reportedMetrics: [{ name: 'accuracy', value: 1 }],
          method: { summary: 's' },
          reproducibility: { hasOfficialCode: false },
        }],
        scaffold: {
          templateId: 'python-ml-baseline',
          workDir: '/tmp/work',
          language: 'python',
          entryCommand: 'python3 run_experiment.py',
          vars: {},
          files: [],
        },
        gitInitialized: true,
        conversationalTemplateId: 'reproduce-paper',
      },
    },
    currentStep: 'ready',
    observedTools: ['scaffold_generate'],
    warnings: [],
    iterations: 4,
    agentLogs: 'hello',
    handoffSummary: null,
    lastCompiledPrompt: 'prompt',
    missingFinalize: false,
    error: null,
  };
}

describe('bootstrapSessionPersist', () => {
  beforeEach(() => {
    storage.data = {};
  });

  it('round-trips a Ready session through localStorage', () => {
    persistBootstrapSession(sampleSession());
    expect(storage.data[AUTORESEARCH_BOOTSTRAP_SESSION_STORAGE_KEY]).toContain('Keep my Ready form');
    const loaded = loadPersistedBootstrapSession();
    expect(loaded?.hasStarted).toBe(true);
    expect(loaded?.readyResult?.plan.primaryMetric).toBe('accuracy');
    expect(loaded?.iterations).toBe(4);
  });

  it('clears the persisted session', () => {
    persistBootstrapSession(sampleSession());
    clearPersistedBootstrapSession();
    expect(loadPersistedBootstrapSession()).toBeNull();
  });
});
