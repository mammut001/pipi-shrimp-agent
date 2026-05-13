import { describe, expect, it } from '@jest/globals';
import { parseBaselineExtractResponse } from '../tsTools/baselineExtract';

describe('parseBaselineExtractResponse', () => {
  it('accepts grounded baseline metrics', () => {
    const sourceText = 'The ResNet50 baseline reaches accuracy 95.1 on CIFAR10.';
    const raw = JSON.stringify({
      baselines: [
        {
          name: 'ResNet50',
          task: 'classification',
          dataset: 'CIFAR10',
          reportedMetrics: [{ name: 'accuracy', value: 95.1 }],
          method: { summary: 'A supervised baseline.' },
          reproducibility: { hasOfficialCode: true },
        },
      ],
    });

    const parsed = parseBaselineExtractResponse(raw, sourceText);
    expect(parsed.ok).toBe(true);
    expect(parsed.baselines).toHaveLength(1);
  });

  it('rejects fabricated metrics not present in the source text', () => {
    const sourceText = 'The ResNet50 baseline reaches accuracy 95.1 on CIFAR10.';
    const raw = JSON.stringify({
      baselines: [
        {
          name: 'ResNet50',
          task: 'classification',
          dataset: 'CIFAR10',
          reportedMetrics: [{ name: 'accuracy', value: 99.9 }],
          method: { summary: 'A supervised baseline.' },
          reproducibility: { hasOfficialCode: true },
        },
      ],
    });

    const parsed = parseBaselineExtractResponse(raw, sourceText);
    expect(parsed.ok).toBe(false);
    expect(parsed.unresolvedQuestions[0]).toContain('does not appear in the source text');
  });
});