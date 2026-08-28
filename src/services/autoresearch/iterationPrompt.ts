import type { IterationMetrics } from './metricsStore';

export function buildMultiRoundGuidance(input: {
  iteration: number;
  maxIterations: number;
  metricName: string;
  direction: 'lower' | 'higher';
  previous: IterationMetrics[];
}): string {
  const last = input.previous[input.previous.length - 1] ?? null;
  const deadEnds = input.previous
    .filter((entry) => entry.status === 'FAILED' || entry.status === 'NOT_IMPROVED')
    .map((entry) => entry.hypothesis?.trim())
    .filter((hypothesis): hypothesis is string => Boolean(hypothesis));
  const uniqueDeadEnds = [...new Set(deadEnds)].slice(-8);

  const lines = [
    `You are on iteration ${input.iteration} of ${input.maxIterations}.`,
    `Optimize ${input.metricName} (${input.direction} is better).`,
  ];

  if (!last) {
    lines.push(
      'This is the first iteration. Establish a trustworthy baseline measurement before making aggressive changes.',
      'Prefer a small, reversible change that makes the experiment actually emit the primary metric.',
    );
  } else {
    const metricBit = last.metricValue === null || last.metricValue === undefined
      ? 'no metric'
      : `${input.metricName}=${last.metricValue}`;
    lines.push(
      `Previous iteration ${last.iteration} was ${last.status} (${metricBit}).`,
      'Do not repeat that hypothesis unless you have a materially different mechanism.',
    );
    if (last.status === 'FAILED') {
      lines.push(
        last.failReason
          ? `Diagnose failReason="${last.failReason}" first and make a smaller, safer change.`
          : 'Diagnose the failure first and make a smaller, safer change.',
      );
    } else if (last.status === 'NOT_IMPROVED') {
      lines.push('The last change was reverted. Try a different axis, not a tweak of the same idea.');
    } else if (last.status === 'IMPROVED') {
      lines.push('Keep the win. Try an orthogonal improvement, not a random rewrite of the working change.');
    }
  }

  if (uniqueDeadEnds.length > 0) {
    lines.push('Dead ends to avoid unless you have a new reason:');
    lines.push(...uniqueDeadEnds.map((item) => `- ${item}`));
  }

  return lines.join('\n');
}
