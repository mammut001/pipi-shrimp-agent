import type { SshConfig } from '@/store/autoresearchStore';
import { readAllMetrics, summarize, type IterationMetrics } from './metricsStore';
import { getSessionRunPaths, readTargetText, writeTargetText } from './runDir';

export interface LivingDocOptions {
  startedAt: string;
  workDir: string;
  metricName: string;
  direction: 'lower' | 'higher';
}

function formatMetric(value: number | null): string {
  return value === null ? 'N/A' : String(value);
}

function buildDeadEnds(metrics: IterationMetrics[]): string[] {
  const groups = new Map<string, IterationMetrics[]>();
  for (const entry of metrics) {
    const key = entry.hypothesis.trim().toLowerCase();
    const current = groups.get(key) ?? [];
    current.push(entry);
    groups.set(key, current);
  }

  return [...groups.values()]
    .filter(entries => entries.length >= 2 && !entries.some(entry => entry.status === 'IMPROVED'))
    .map(entries => `- ${entries[0].hypothesis}`)
    .sort();
}

function renderSection(title: string, items: string[], fallback: string): string {
  return [`## ${title}`, items.length > 0 ? items.join('\n') : fallback, ''].join('\n');
}

export function renderLivingDoc(
  sessionId: string,
  objective: string,
  metrics: IterationMetrics[],
  options: LivingDocOptions,
): string {
  const summary = summarize(metrics, options.direction);
  const best = summary.best;
  const kept = metrics
    .filter(entry => entry.status === 'IMPROVED')
    .map(entry => `- iter-${String(entry.iteration).padStart(3, '0')}: ${entry.hypothesis} - IMPROVED`);
  const reverted = metrics
    .filter(entry => entry.status !== 'IMPROVED')
    .map(entry => `- iter-${String(entry.iteration).padStart(3, '0')}: ${entry.hypothesis} - ${entry.status}${entry.failReason ? ` (${entry.failReason})` : ''}`);
  const deadEnds = buildDeadEnds(metrics);
  const bestLine = best
    ? `- iter-${String(best.iteration).padStart(3, '0')}${best.commitHash ? ` (commit ${best.commitHash})` : ''}: ${options.metricName} = ${formatMetric(best.metricValue)}`
    : '- No successful metrics yet.';

  return [
    `# AutoResearch Session ${sessionId}`,
    `Started: ${options.startedAt}`,
    `Workdir: ${options.workDir}`,
    `Metric: ${options.metricName} (${options.direction} is better)`,
    '',
    '## Objective',
    objective.trim() || '(empty objective)',
    '',
    '## Best so far',
    bestLine,
    '',
    renderSection('Tried (kept)', kept, '- None yet.'),
    renderSection('Tried (reverted)', reverted, '- None yet.'),
    renderSection('Dead ends', deadEnds, '- None yet.'),
  ].join('\n');
}

export async function rebuildLivingDoc(
  cfg: SshConfig,
  sessionId: string,
  options: LivingDocOptions,
): Promise<string> {
  const paths = getSessionRunPaths(cfg, sessionId);
  const [metrics, objective] = await Promise.all([
    readAllMetrics(cfg, sessionId),
    readTargetText(cfg, paths.sessionFilePath),
  ]);

  const content = renderLivingDoc(sessionId, objective || '', metrics, options);
  await writeTargetText(cfg, paths.livingDocPath, `${content}\n`);
  return content;
}

export async function readLivingDoc(
  cfg: SshConfig,
  sessionId: string,
): Promise<string | null> {
  const paths = getSessionRunPaths(cfg, sessionId);
  return readTargetText(cfg, paths.livingDocPath);
}
