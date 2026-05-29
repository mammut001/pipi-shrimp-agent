import type { SshConfig } from '@/store/autoresearchStore';
import type { AutoResearchMode } from './history';
import { BootstrapPlanSchema } from './bootstrap/schema';
import type { BootstrapPlan } from './bootstrap/types';
import { readAllMetrics, summarize, type IterationMetrics } from './metricsStore';
import { getSessionRunPaths, readTargetText, writeTargetText } from './runDir';

export interface LivingDocOptions {
  startedAt: string;
  workDir: string;
  metricName: string;
  direction: 'lower' | 'higher';
  mode?: AutoResearchMode;
}

interface BootstrapDocSeed {
  createdAt: string;
  plan: BootstrapPlan;
}

function getBootstrapPlanSidecarPath(sessionId: string, cfg: SshConfig): string {
  const paths = getSessionRunPaths(cfg, sessionId);
  return `${paths.sessionDir}/bootstrap.plan.json`;
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

function renderBootstrapSection(plan: BootstrapPlan): string[] {
  const paperLines = plan.papers.map((paper) => `- ${paper.title}${paper.year ? ` (${paper.year})` : ''}`);
  const baselineLines = plan.baselines.map((baseline) => {
    const metrics = baseline.reportedMetrics.map((metric) => `${metric.name}=${metric.value}`).join(', ');
    return `- ${baseline.name} on ${baseline.dataset}${metrics ? ` (${metrics})` : ''}`;
  });

  return [
    '## Bootstrap Goal',
    plan.researchGoal,
    '',
    '## Success Criteria',
    plan.successCriteria,
    '',
    '## Primary Metric',
    `${plan.primaryMetric}${plan.secondaryMetrics.length > 0 ? `; secondary: ${plan.secondaryMetrics.join(', ')}` : ''}`,
    '',
    renderSection('Bootstrap Baselines', baselineLines, '- None recorded.'),
    renderSection('Bootstrap Papers', paperLines, '- None recorded.'),
  ].join('\n').split('\n');
}

async function readBootstrapSeed(cfg: SshConfig, sessionId: string): Promise<BootstrapDocSeed | null> {
  const raw = await readTargetText(cfg, getBootstrapPlanSidecarPath(sessionId, cfg));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { createdAt?: string; plan?: unknown };
    if (typeof parsed.createdAt !== 'string') {
      return null;
    }
    return {
      createdAt: parsed.createdAt,
      plan: BootstrapPlanSchema.parse(parsed.plan),
    };
  } catch {
    return null;
  }
}

function renderSelfImproveLivingDoc(
  sessionId: string,
  objective: string,
  metrics: IterationMetrics[],
  options: LivingDocOptions,
): string {
  const improved = metrics.filter((entry) => entry.status === 'IMPROVED');
  const failed = metrics.filter((entry) => entry.status === 'FAILED');
  const noChange = metrics.filter((entry) => entry.status === 'NOT_IMPROVED');

  const successfulFixes = improved
    .map((entry) => `- iter-${String(entry.iteration).padStart(3, '0')}: ${entry.hypothesis}`)
    .join('\n') || '- No successful fixes yet.';

  const failedAttempts = failed
    .map((entry) => `- iter-${String(entry.iteration).padStart(3, '0')}: ${entry.hypothesis}${entry.failReason ? ` (${entry.failReason})` : ''}`)
    .join('\n') || '- No failed attempts yet.';

  const noChangeAttempts = noChange
    .map((entry) => `- iter-${String(entry.iteration).padStart(3, '0')}: ${entry.hypothesis}`)
    .join('\n') || '- None yet.';

  const knownIssues = metrics
    .filter((entry) => entry.extra?.selfImproveMode && entry.extra?.buildPassed === false)
    .map((entry) => `- iter-${String(entry.iteration).padStart(3, '0')}: Build failure — ${entry.hypothesis}`)
    .join('\n') || '- No build failures recorded.';

  return [
    `# Self-Improve Session ${sessionId}`,
    `Started: ${options.startedAt}`,
    `Workdir: ${options.workDir}`,
    `Mode: Repository Self-Improve`,
    '',
    '## Objective',
    objective.trim() || '(empty objective)',
    '',
    `## Iterations: ${metrics.length} total, ${improved.length} improved, ${failed.length} failed, ${noChange.length} no change`,
    '',
    '## Successful Fixes',
    successfulFixes,
    '',
    '## Failed Attempts (do not repeat)',
    failedAttempts,
    '',
    '## No Change Attempts',
    noChangeAttempts,
    '',
    '## Known Build Failures',
    knownIssues,
    '',
  ].join('\n');
}

export function renderLivingDoc(
  sessionId: string,
  objective: string,
  metrics: IterationMetrics[],
  options: LivingDocOptions,
  bootstrapPlan?: BootstrapPlan | null,
): string {
  if (options.mode === 'repo_self_improve') {
    return renderSelfImproveLivingDoc(sessionId, objective, metrics, options);
  }
  const summary = summarize(metrics, options.direction);
  const best = summary.best;
  const kept = metrics
    .filter(entry => entry.status === 'IMPROVED')
    .map(entry => `- iter-${String(entry.iteration).padStart(3, '0')}: ${entry.hypothesis} - IMPROVED`);
  const reverted = metrics
    .filter(entry => entry.status !== 'IMPROVED')
    .map((entry) => {
      const reflectionTag = entry.reflection?.reason ? ' [reflection failed]' : '';
      return `- iter-${String(entry.iteration).padStart(3, '0')}: ${entry.hypothesis} - ${entry.status}${entry.failReason ? ` (${entry.failReason})` : ''}${reflectionTag}`;
    });
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
    ...(bootstrapPlan ? [...renderBootstrapSection(bootstrapPlan), ''] : []),
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
  const [metrics, objective, bootstrapSeed] = await Promise.all([
    readAllMetrics(cfg, sessionId),
    readTargetText(cfg, paths.sessionFilePath),
    readBootstrapSeed(cfg, sessionId),
  ]);

  const content = renderLivingDoc(sessionId, objective || '', metrics, options, bootstrapSeed?.plan ?? null);
  await writeTargetText(cfg, paths.livingDocPath, `${content}\n`);
  return content;
}

export async function seedFromBootstrap(
  cfg: SshConfig,
  sessionId: string,
  plan: BootstrapPlan,
  createdAt?: string,
): Promise<boolean> {
  const paths = getSessionRunPaths(cfg, sessionId);
  const seedId = createdAt ?? new Date().toISOString();
  const marker = `<!-- bootstrap-seeded:${seedId} -->`;
  const existing = await readTargetText(cfg, paths.sessionFilePath);
  if (existing?.includes(marker)) {
    return false;
  }

  const bootstrapSummary = [
    marker,
    '# Bootstrap Goal',
    plan.researchGoal,
    '',
    '## Success Criteria',
    plan.successCriteria,
    '',
    '## Primary Metric',
    plan.primaryMetric,
    '',
    '## Baselines',
    ...plan.baselines.map((baseline) => `- ${baseline.name}: ${baseline.reportedMetrics.map((metric) => `${metric.name}=${metric.value}`).join(', ')}`),
    '',
    '## Papers',
    ...plan.papers.map((paper) => `- ${paper.title}${paper.year ? ` (${paper.year})` : ''}`),
    '',
  ].join('\n');

  const nextContent = existing && existing.trim().length > 0
    ? `${existing.trim()}\n\n${bootstrapSummary}\n`
    : `${bootstrapSummary}\n`;
  await writeTargetText(cfg, paths.sessionFilePath, nextContent);
  await writeTargetText(
    cfg,
    getBootstrapPlanSidecarPath(sessionId, cfg),
    `${JSON.stringify({ createdAt: seedId, plan }, null, 2)}\n`,
  );
  return true;
}

export async function readLivingDoc(
  cfg: SshConfig,
  sessionId: string,
): Promise<string | null> {
  const paths = getSessionRunPaths(cfg, sessionId);
  return readTargetText(cfg, paths.livingDocPath);
}
