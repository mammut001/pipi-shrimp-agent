import type { AutoResearchIterationRecord, AutoResearchRunRecord } from './history';

export type AutoResearchIterationDecision =
  | 'baseline'
  | 'keep'
  | 'discard'
  | 'failed'
  | 'running'
  | 'pending'
  | 'no_metric';

export interface AutoResearchMetricPoint {
  iteration: number;
  timestamp?: string;
  metricName: string;
  value: number | null;
  baselineValue?: number | null;
  isBaseline?: boolean;
  isBestSoFar?: boolean;
  decision: AutoResearchIterationDecision;
  deltaFromBaseline?: number | null;
  deltaFromPrevious?: number | null;
  deltaFromBest?: number | null;
  relativeImpactFromBaseline?: number | null;
  relativeImpactFromPrevious?: number | null;
}

export interface AutoResearchIterationSummary {
  iteration: number;
  status: AutoResearchIterationDecision;
  metricName: string;
  metricValue: number | null;
  impactLabel: string;
  changeSummary: string;
  hypothesis?: string;
  reasoning?: string;
  commitHash?: string;
  artifactPaths?: string[];
  error?: string | null;
  startedAt?: string;
  endedAt?: string;
}

export interface AutoResearchMetricImpact {
  value: number | null;
  baseline: number | null;
  previous: number | null;
  best: number | null;
  direction: 'higher' | 'lower';
  deltaFromBaseline: number | null;
  deltaFromPrevious: number | null;
  deltaFromBest: number | null;
  relativeImpactFromBaseline: number | null;
  relativeImpactFromPrevious: number | null;
}

const EPSILON = 1e-6;
const MAX_CHANGE_SUMMARY_CHARS = 120;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function directionalDelta(value: number, reference: number, direction: 'higher' | 'lower'): number {
  return direction === 'higher' ? value - reference : reference - value;
}

function relativeImpact(delta: number | null, reference: number | null): number | null {
  if (delta === null || reference === null || Math.abs(reference) < EPSILON) {
    return null;
  }
  return delta / Math.abs(reference);
}

function isImprovement(value: number, bestSoFar: number, direction: 'higher' | 'lower'): boolean {
  return direction === 'higher'
    ? value > bestSoFar + EPSILON
    : value < bestSoFar - EPSILON;
}

function normalizeMetricValue(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatSignedDecimal(value: number): string {
  const absValue = Math.abs(value);
  const formatted = absValue >= 1
    ? trimTrailingZeros(absValue.toFixed(3))
    : trimTrailingZeros(absValue.toFixed(4));
  if (Math.abs(value) < EPSILON) {
    return '0';
  }
  return `${value > 0 ? '+' : '-'}${formatted}`;
}

function formatSignedPercent(value: number): string {
  if (Math.abs(value) < EPSILON) {
    return '0.0%';
  }
  return `${value > 0 ? '+' : '-'}${Math.abs(value * 100).toFixed(2)}%`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxChars: number): string {
  const compact = compactText(value);
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 1))}…`;
}

function getReflectionText(iteration: AutoResearchIterationRecord): string | undefined {
  const record = iteration as AutoResearchIterationRecord & {
    reflection?: { nextPlan?: unknown; summary?: unknown };
    reflectionSummary?: unknown;
    nextPlan?: unknown;
  };

  const candidates = [
    record.reflection?.nextPlan,
    record.reflection?.summary,
    record.nextPlan,
    record.reflectionSummary,
  ];

  return candidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function classifyIterationDecision(
  iteration: Pick<AutoResearchIterationRecord, 'status' | 'metricValue'>,
  bestSoFar: number | null | undefined,
  direction: 'higher' | 'lower',
): AutoResearchIterationDecision {
  if (iteration.status === 'running') {
    return 'running';
  }
  if (iteration.status === 'pending') {
    return 'pending';
  }
  if (iteration.status === 'failed') {
    return 'failed';
  }

  const value = normalizeMetricValue(iteration.metricValue);
  if (value === null) {
    return 'no_metric';
  }
  if (bestSoFar === null || bestSoFar === undefined) {
    return 'keep';
  }
  return isImprovement(value, bestSoFar, direction) ? 'keep' : 'discard';
}

export function calculateMetricImpact(
  value: number | null,
  baseline: number | null | undefined,
  previous: number | null | undefined,
  best: number | null | undefined,
  direction: 'higher' | 'lower',
): AutoResearchMetricImpact {
  const normalizedBaseline = normalizeMetricValue(baseline);
  const normalizedPrevious = normalizeMetricValue(previous);
  const normalizedBest = normalizeMetricValue(best);
  const normalizedValue = normalizeMetricValue(value);

  const deltaFromBaseline = normalizedValue !== null && normalizedBaseline !== null
    ? directionalDelta(normalizedValue, normalizedBaseline, direction)
    : null;
  const deltaFromPrevious = normalizedValue !== null && normalizedPrevious !== null
    ? directionalDelta(normalizedValue, normalizedPrevious, direction)
    : null;
  const deltaFromBest = normalizedValue !== null && normalizedBest !== null
    ? directionalDelta(normalizedValue, normalizedBest, direction)
    : null;

  return {
    value: normalizedValue,
    baseline: normalizedBaseline,
    previous: normalizedPrevious,
    best: normalizedBest,
    direction,
    deltaFromBaseline,
    deltaFromPrevious,
    deltaFromBest,
    relativeImpactFromBaseline: relativeImpact(deltaFromBaseline, normalizedBaseline),
    relativeImpactFromPrevious: relativeImpact(deltaFromPrevious, normalizedPrevious),
  };
}

export function formatMetricImpact(impact: AutoResearchMetricImpact): string {
  if (impact.value === null) {
    return 'N/A';
  }

  const delta = impact.deltaFromBaseline ?? impact.deltaFromPrevious;
  const relative = impact.relativeImpactFromBaseline ?? impact.relativeImpactFromPrevious;
  if (delta === null) {
    return 'N/A';
  }
  if (Math.abs(delta) < EPSILON) {
    return '0.0%';
  }

  const absoluteLabel = `${formatSignedDecimal(delta)} abs`;
  return relative === null ? absoluteLabel : `${absoluteLabel} · ${formatSignedPercent(relative)}`;
}

export function formatMetricValue(value: number | null | undefined): string {
  const normalized = normalizeMetricValue(value);
  if (normalized === null) {
    return 'N/A';
  }
  const absValue = Math.abs(normalized);
  if (absValue === 0) {
    return '0';
  }
  if (absValue >= 100) {
    return trimTrailingZeros(normalized.toFixed(2));
  }
  if (absValue >= 1) {
    return trimTrailingZeros(normalized.toFixed(4));
  }
  return trimTrailingZeros(normalized.toFixed(6));
}

export function buildMetricTimeline(run: AutoResearchRunRecord): AutoResearchMetricPoint[] {
  const metricName = run.config.metric || 'metric';
  const direction = run.config.direction;
  const baselineValue = normalizeMetricValue(run.config.baseline);
  const points: AutoResearchMetricPoint[] = [];
  let bestSoFar = baselineValue;
  let previousValue = baselineValue;

  if (baselineValue !== null) {
    points.push({
      iteration: 0,
      timestamp: run.startedAt ?? run.createdAt,
      metricName,
      value: baselineValue,
      baselineValue,
      isBaseline: true,
      isBestSoFar: true,
      decision: 'baseline',
      deltaFromBaseline: 0,
      deltaFromPrevious: 0,
      deltaFromBest: 0,
      relativeImpactFromBaseline: 0,
      relativeImpactFromPrevious: 0,
    });
  }

  const iterations = [...run.iterations].sort((a, b) => a.index - b.index);
  for (const iteration of iterations) {
    const value = normalizeMetricValue(iteration.metricValue);
    const impact = calculateMetricImpact(value, baselineValue, previousValue, bestSoFar, direction);
    const decision = classifyIterationDecision(iteration, bestSoFar, direction);
    const isBestSoFar = value !== null && decision === 'keep';

    points.push({
      iteration: iteration.index,
      timestamp: iteration.endedAt ?? iteration.startedAt,
      metricName,
      value,
      baselineValue,
      isBestSoFar,
      decision,
      deltaFromBaseline: impact.deltaFromBaseline,
      deltaFromPrevious: impact.deltaFromPrevious,
      deltaFromBest: impact.deltaFromBest,
      relativeImpactFromBaseline: impact.relativeImpactFromBaseline,
      relativeImpactFromPrevious: impact.relativeImpactFromPrevious,
    });

    if (value !== null) {
      previousValue = value;
      if (bestSoFar === null || decision === 'keep') {
        bestSoFar = value;
      }
    }
  }

  return points;
}

export function summarizeIterationChange(iteration: AutoResearchIterationRecord): string {
  const reflectionText = getReflectionText(iteration);
  const candidates = [
    iteration.change,
    reflectionText,
    iteration.hypothesis,
    iteration.error ? `Error: ${iteration.error}` : undefined,
    `Iteration ${iteration.index}`,
  ];

  const selected = candidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return truncateText(selected ?? `Iteration ${iteration.index}`, MAX_CHANGE_SUMMARY_CHARS);
}

export function buildIterationSummaries(run: AutoResearchRunRecord): AutoResearchIterationSummary[] {
  const timeline = buildMetricTimeline(run);
  const pointsByIteration = new Map(timeline.map((point) => [point.iteration, point]));
  const summaries: AutoResearchIterationSummary[] = [];
  const baselinePoint = pointsByIteration.get(0);

  if (baselinePoint && baselinePoint.value !== null) {
    summaries.push({
      iteration: 0,
      status: 'baseline',
      metricName: baselinePoint.metricName,
      metricValue: baselinePoint.value,
      impactLabel: '0.0%',
      changeSummary: 'Baseline',
      startedAt: baselinePoint.timestamp,
      endedAt: baselinePoint.timestamp,
    });
  }

  const iterations = [...run.iterations].sort((a, b) => a.index - b.index);
  for (const iteration of iterations) {
    const point = pointsByIteration.get(iteration.index);
    const impact = calculateMetricImpact(
      normalizeMetricValue(iteration.metricValue),
      run.config.baseline,
      null,
      null,
      run.config.direction,
    );
    const record = iteration as AutoResearchIterationRecord & { commitHash?: string };
    summaries.push({
      iteration: iteration.index,
      status: point?.decision ?? classifyIterationDecision(iteration, null, run.config.direction),
      metricName: run.config.metric || point?.metricName || 'metric',
      metricValue: normalizeMetricValue(iteration.metricValue),
      impactLabel: point ? formatMetricImpact({
        value: point.value,
        baseline: point.baselineValue ?? null,
        previous: null,
        best: null,
        direction: run.config.direction,
        deltaFromBaseline: point.deltaFromBaseline ?? null,
        deltaFromPrevious: point.deltaFromPrevious ?? null,
        deltaFromBest: point.deltaFromBest ?? null,
        relativeImpactFromBaseline: point.relativeImpactFromBaseline ?? null,
        relativeImpactFromPrevious: point.relativeImpactFromPrevious ?? null,
      }) : formatMetricImpact(impact),
      changeSummary: summarizeIterationChange(iteration),
      hypothesis: iteration.hypothesis,
      reasoning: iteration.reasoning,
      commitHash: record.commitHash,
      artifactPaths: iteration.artifactPaths,
      error: iteration.error ?? null,
      startedAt: iteration.startedAt,
      endedAt: iteration.endedAt,
    });
  }

  return summaries;
}

export function getBestMetricPoint(points: AutoResearchMetricPoint[]): AutoResearchMetricPoint | null {
  const bestPoints = points.filter((point) => point.value !== null && point.isBestSoFar);
  return bestPoints.length > 0 ? bestPoints[bestPoints.length - 1] : null;
}