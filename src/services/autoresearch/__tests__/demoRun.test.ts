import { describe, expect, it } from '@jest/globals';
import { createAutoResearchDemoRun, isDemoRun } from '../demoRun';
import { buildIterationSummaries, buildMetricTimeline } from '../metricTimeline';

describe('createAutoResearchDemoRun', () => {
  it('returns stable demo data that works with timeline helpers', () => {
    const run = createAutoResearchDemoRun();

    expect(run).toBeTruthy();
    expect(run.id).toBe('demo-autoresearch-run');
    expect(run.config).toBeTruthy();
    expect(run.config.metric).toBe('cv_accuracy');
    expect(run.config.baseline).toBe(0.963284);
    expect(run.iterations.length).toBeGreaterThanOrEqual(5);
    expect(run.iterations.length).toBeLessThanOrEqual(7);
    expect(run.iterations.some((iteration) => iteration.status === 'failed')).toBe(true);

    const timeline = buildMetricTimeline(run);
    const summaries = buildIterationSummaries(run);

    expect(timeline.filter((point) => point.decision === 'keep')).toHaveLength(3);
    expect(() => buildMetricTimeline(run)).not.toThrow();
    expect(() => buildIterationSummaries(run)).not.toThrow();
    expect(summaries.filter((summary) => summary.status === 'keep').length).toBeGreaterThanOrEqual(2);
    expect(isDemoRun(run)).toBe(true);
    expect(isDemoRun({ id: 'real-run' })).toBe(false);
  });
});
