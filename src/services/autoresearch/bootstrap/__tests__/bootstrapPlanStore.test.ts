import { beforeEach, describe, expect, it } from '@jest/globals';
import { useBootstrapPlanStore } from '../bootstrapPlanStore';
import type { AutoResearchBootstrapResult } from '../types';

describe('useBootstrapPlanStore', () => {
  beforeEach(() => {
    useBootstrapPlanStore.getState().reset();
  });

  it('advances currentStep to papers when read_file is observed', () => {
    expect(useBootstrapPlanStore.getState().currentStep).toBe('goal');
    useBootstrapPlanStore.getState().noteTool('read_file');
    expect(useBootstrapPlanStore.getState().currentStep).toBe('papers');
    expect(useBootstrapPlanStore.getState().observedTools).toContain('read_file');
  });

  it('advances currentStep through the pipeline', () => {
    const store = useBootstrapPlanStore.getState();
    store.noteTool('pdf_read');
    expect(useBootstrapPlanStore.getState().currentStep).toBe('papers');

    store.noteTool('baseline_extract');
    expect(useBootstrapPlanStore.getState().currentStep).toBe('baselines');

    store.markMetricsStep();
    expect(useBootstrapPlanStore.getState().currentStep).toBe('metrics');

    store.noteTool('scaffold_generate');
    expect(useBootstrapPlanStore.getState().currentStep).toBe('scaffold');
  });

  it('keeps currentStep at scaffold when readyResult needs user confirmation', () => {
    const confirmationResult: AutoResearchBootstrapResult = {
      status: 'needs_user_confirmation',
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
      unresolvedQuestions: ['Which dataset split should be used?'],
      schemaVersion: 1,
      plan: {
        researchGoal: 'Goal',
        successCriteria: 'Criteria',
        primaryMetric: 'accuracy',
        secondaryMetrics: [],
        papers: [],
        baselines: [],
        scaffold: {
          templateId: 'python-ml-baseline',
          workDir: '/tmp/work',
          language: 'python',
          entryCommand: 'python3 train.py',
          vars: {},
          files: [],
        },
        gitInitialized: true,
        conversationalTemplateId: 'reproduce-paper',
      },
    };

    useBootstrapPlanStore.getState().setReadyResult(confirmationResult);
    expect(useBootstrapPlanStore.getState().currentStep).toBe('scaffold');
    expect(useBootstrapPlanStore.getState().readyResult?.status).toBe('needs_user_confirmation');
  });

  it('sets currentStep to ready when readyResult status is ready', () => {
    const readyResult: AutoResearchBootstrapResult = {
      status: 'ready',
      createdAt: '2026-01-01T00:00:00.000Z',
      warnings: [],
      unresolvedQuestions: [],
      schemaVersion: 1,
      plan: {
        researchGoal: 'Goal',
        successCriteria: 'Criteria',
        primaryMetric: 'accuracy',
        secondaryMetrics: [],
        papers: [],
        baselines: [],
        scaffold: {
          templateId: 'python-ml-baseline',
          workDir: '/tmp/work',
          language: 'python',
          entryCommand: 'python3 train.py',
          vars: {},
          files: [],
        },
        gitInitialized: true,
        conversationalTemplateId: 'reproduce-paper',
      },
    };

    useBootstrapPlanStore.getState().setReadyResult(readyResult);
    expect(useBootstrapPlanStore.getState().currentStep).toBe('ready');
  });

  it('completely resets all state on reset()', () => {
    useBootstrapPlanStore.getState().noteTool('read_file');
    useBootstrapPlanStore.getState().setWarnings(['Warning']);
    useBootstrapPlanStore.getState().reset();

    const state = useBootstrapPlanStore.getState();
    expect(state.currentStep).toBe('goal');
    expect(state.observedTools).toEqual([]);
    expect(state.warnings).toEqual([]);
    expect(state.readyResult).toBeNull();
  });
});
