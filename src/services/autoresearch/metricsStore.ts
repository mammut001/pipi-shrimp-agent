import type { ExperimentStatus, SshConfig } from '@/store/autoresearchStore';
import { appendTargetText, getSessionRunPaths, readTargetText, writeTargetText } from './runDir';
import { getCurrentRunDir } from './terminalRunner';

export interface IterationMetrics {
  iteration: number;
  sessionId: string;
  metricName: string;
  metricValue: number | null;
  status: ExperimentStatus;
  failReason?: string;
  hypothesis: string;
  commitHash?: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  extra?: Record<string, number | string | boolean>;
}

export interface MetricsSummary {
  best: IterationMetrics | null;
  mean: number | null;
  std: number | null;
  noiseFloor: number | null;
  confidence: number | null;
}

function metricComparator(direction: 'lower' | 'higher') {
  return direction === 'lower'
    ? (a: number, b: number) => a - b
    : (a: number, b: number) => b - a;
}

export async function appendIterationMetrics(
  cfg: SshConfig,
  sessionId: string,
  metrics: IterationMetrics,
): Promise<void> {
  const paths = getSessionRunPaths(cfg, sessionId);
  const line = `${JSON.stringify(metrics)}\n`;
  const currentRun = getCurrentRunDir();
  await appendTargetText(cfg, paths.metricsJsonlPath, line);
  if (currentRun?.iter === metrics.iteration) {
    await writeTargetText(cfg, currentRun.metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  }
}

export async function writeIterationMetricsFile(
  cfg: SshConfig,
  metricsPath: string,
  metrics: IterationMetrics,
): Promise<void> {
  await writeTargetText(cfg, metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
}

export async function readAllMetrics(
  cfg: SshConfig,
  sessionId: string,
): Promise<IterationMetrics[]> {
  const { metricsJsonlPath } = getSessionRunPaths(cfg, sessionId);
  const content = await readTargetText(cfg, metricsJsonlPath);
  if (!content) {
    return [];
  }

  return content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IterationMetrics);
}

export function summarize(
  metrics: IterationMetrics[],
  direction: 'lower' | 'higher',
): MetricsSummary {
  const values = metrics
    .filter((entry) => typeof entry.metricValue === 'number')
    .map((entry) => entry.metricValue as number);

  if (values.length === 0) {
    return {
      best: null,
      mean: null,
      std: null,
      noiseFloor: null,
      confidence: null,
    };
  }

  const compare = metricComparator(direction);
  const best = metrics
    .filter((entry) => typeof entry.metricValue === 'number')
    .sort((a, b) => compare(a.metricValue as number, b.metricValue as number))[0] ?? null;

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const std = Math.sqrt(variance);
  const noiseFloor = values.length > 1 ? std / Math.sqrt(values.length) : 0;
  const bestDelta = best?.metricValue === null || best?.metricValue === undefined
    ? 0
    : Math.abs(best.metricValue - mean);
  const confidenceBase = std === 0 ? 1 : Math.min(1, bestDelta / (std || 1));

  return {
    best,
    mean,
    std,
    noiseFloor,
    confidence: Number.isFinite(confidenceBase) ? confidenceBase : 0,
  };
}
