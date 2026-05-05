import { renderLivingDoc } from '../livingDoc';

describe('livingDoc', () => {
  it('renders a derived markdown summary from metrics', () => {
    const content = renderLivingDoc(
      'session-1',
      'Train a tiny model until validation loss improves.',
      [
        {
          iteration: 1,
          sessionId: 'session-1',
          metricName: 'val_loss',
          metricValue: 0.9,
          status: 'IMPROVED',
          hypothesis: 'increase dropout 0.1 -> 0.15',
          commitHash: 'abc1234',
          durationMs: 1000,
          startedAt: '2026-05-05T00:00:00.000Z',
          finishedAt: '2026-05-05T00:00:01.000Z',
        },
        {
          iteration: 2,
          sessionId: 'session-1',
          metricName: 'val_loss',
          metricValue: null,
          status: 'FAILED',
          failReason: 'NaN',
          hypothesis: 'remove warmup',
          durationMs: 1000,
          startedAt: '2026-05-05T00:01:00.000Z',
          finishedAt: '2026-05-05T00:01:01.000Z',
        },
        {
          iteration: 3,
          sessionId: 'session-1',
          metricName: 'val_loss',
          metricValue: 1.0,
          status: 'NOT_IMPROVED',
          hypothesis: 'remove warmup',
          durationMs: 1000,
          startedAt: '2026-05-05T00:02:00.000Z',
          finishedAt: '2026-05-05T00:02:01.000Z',
        },
      ],
      {
        startedAt: '2026-05-05T00:00:00.000Z',
        workDir: '/tmp/workdir',
        metricName: 'val_loss',
        direction: 'lower',
      },
    );

    expect(content).toMatchInlineSnapshot(`
"# AutoResearch Session session-1
Started: 2026-05-05T00:00:00.000Z
Workdir: /tmp/workdir
Metric: val_loss (lower is better)

## Objective
Train a tiny model until validation loss improves.

## Best so far
- iter-001 (commit abc1234): val_loss = 0.9

## Tried (kept)
- iter-001: increase dropout 0.1 -> 0.15 - IMPROVED

## Tried (reverted)
- iter-002: remove warmup - FAILED (NaN)
- iter-003: remove warmup - NOT_IMPROVED

## Dead ends
- remove warmup
"
`);
  });
});
