import { describe, expect, it } from '@jest/globals';
import { AutoResearchBootstrapResultSchema } from '../schema';

function createValidResult() {
  return {
    status: 'ready',
    plan: {
      researchGoal: 'Improve CIFAR10 accuracy.',
      successCriteria: 'Beat the baseline by at least 1 point on the primary metric.',
      primaryMetric: 'accuracy',
      secondaryMetrics: ['latency'],
      papers: [
        {
          source: 'manual',
          title: 'A Strong CIFAR Baseline',
          authors: ['Jane Doe'],
          year: 2024,
        },
      ],
      baselines: [
        {
          name: 'ResNet50',
          task: 'image classification',
          dataset: 'CIFAR10',
          reportedMetrics: [
            { name: 'accuracy', value: 95.1 },
          ],
          method: {
            summary: 'A plain supervised baseline.',
          },
          reproducibility: {
            hasOfficialCode: true,
          },
        },
      ],
      scaffold: {
        templateId: 'python-ml-baseline',
        workDir: '/tmp/autoresearch-bootstrap',
        language: 'python',
        entryCommand: 'python3 run_experiment.py',
        vars: {
          project_name: 'cifar-bootstrap',
          primary_metric: 'accuracy',
        },
        files: [
          { path: 'run_experiment.py', purpose: 'Loop entrypoint' },
        ],
      },
      gitInitialized: true,
      initialCommitSha: 'abc1234',
      conversationalTemplateId: 'beat-baseline',
    },
    warnings: [],
    unresolvedQuestions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 1,
  };
}

describe('AutoResearchBootstrapResultSchema', () => {
  it('accepts a valid ready bootstrap payload', () => {
    const parsed = AutoResearchBootstrapResultSchema.safeParse(createValidResult());
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['missing successCriteria', (value: any) => { delete value.plan.successCriteria; }],
    ['empty baselines', (value: any) => { value.plan.baselines = []; }],
    ['negative metric value', (value: any) => { value.plan.baselines[0].reportedMetrics[0].value = -1; }],
    ['unknown template id', (value: any) => { value.plan.scaffold.templateId = 'unknown-template'; }],
    ['extra top-level key', (value: any) => { value.extraKey = true; }],
    ['wrong schemaVersion', (value: any) => { value.schemaVersion = 2; }],
  ])('rejects %s', (_label, mutate) => {
    const value = createValidResult();
    mutate(value);
    const parsed = AutoResearchBootstrapResultSchema.safeParse(value);
    expect(parsed.success).toBe(false);
  });
});