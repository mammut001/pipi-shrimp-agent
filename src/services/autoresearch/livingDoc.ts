import type { SshConfig } from '@/store/autoresearchStore';
import { BootstrapPlanSchema } from './bootstrap/schema';
import type { BootstrapPlan } from './bootstrap/types';
import { readAllMetrics, summarize, type IterationMetrics } from './metricsStore';
import { getSessionRunPaths, readTargetText, writeTargetText } from './runDir';

export interface LivingDocOptions {
  startedAt: string;
  workDir: string;
  metricName: string;
  direction: 'lower' | 'higher';
  experimentNotesPath?: string;
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

const EXPERIMENT_NOTES_LOG_START = '<!-- AUTORESEARCH-LOG:START -->';
const EXPERIMENT_NOTES_LOG_END = '<!-- AUTORESEARCH-LOG:END -->';

export function upsertExperimentNotesLog(existing: string | null, logBody: string): string {
  const block = [EXPERIMENT_NOTES_LOG_START, logBody.trim(), EXPERIMENT_NOTES_LOG_END].join('\n');
  const source = existing ?? '';
  if (source.includes(EXPERIMENT_NOTES_LOG_START) && source.includes(EXPERIMENT_NOTES_LOG_END)) {
    return source.replace(
      new RegExp(`${EXPERIMENT_NOTES_LOG_START}[\\s\\S]*?${EXPERIMENT_NOTES_LOG_END}`),
      block,
    );
  }
  const trimmed = source.trim();
  return trimmed.length > 0 ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

function renderExperimentNotesLog(
  sessionId: string,
  metrics: IterationMetrics[],
  options: LivingDocOptions,
): string {
  const summary = summarize(metrics, options.direction);
  const last = metrics[metrics.length - 1] ?? null;
  const recent = metrics.slice(-8).map((entry) => (
    `- iter-${String(entry.iteration).padStart(3, '0')}: ${entry.status}`
    + `${entry.metricValue === null || entry.metricValue === undefined ? '' : ` ${options.metricName}=${entry.metricValue}`}`
    + `${entry.hypothesis ? ` — ${entry.hypothesis}` : ''}`
  ));

  return [
    `## AutoResearch log`,
    `Session: ${sessionId}`,
    `Metric: ${options.metricName} (${options.direction} is better)`,
    `Best so far: ${summary.best ? `${options.metricName}=${formatMetric(summary.best.metricValue)} (iter-${String(summary.best.iteration).padStart(3, '0')})` : 'none yet'}`,
    last
      ? `Latest: iter-${String(last.iteration).padStart(3, '0')} ${last.status}${last.failReason ? ` (${last.failReason})` : ''}`
      : 'Latest: no iterations yet',
    '',
    '### Recent iterations',
    recent.length > 0 ? recent.join('\n') : '- None yet.',
    '',
    'Do not delete this generated log. User notes above this marker are preserved across rounds.',
  ].join('\n');
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

export function renderLivingDoc(
  sessionId: string,
  objective: string,
  metrics: IterationMetrics[],
  options: LivingDocOptions,
  bootstrapPlan?: BootstrapPlan | null,
): string {
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

  const historySnapshot = {
    schemaVersion: 1,
    sessionId,
    updatedAt: new Date().toISOString(),
    metricName: options.metricName,
    direction: options.direction,
    iterations: metrics.map((entry) => ({
      iteration: entry.iteration,
      status: entry.status,
      metricValue: entry.metricValue,
      hypothesis: entry.hypothesis,
      failReason: entry.failReason ?? null,
    })),
  };
  await writeTargetText(cfg, `${paths.sessionDir}/history.json`, `${JSON.stringify(historySnapshot, null, 2)}\n`);

  if (options.experimentNotesPath) {
    const existingNotes = await readTargetText(cfg, options.experimentNotesPath);
    const nextNotes = upsertExperimentNotesLog(
      existingNotes,
      renderExperimentNotesLog(sessionId, metrics, options),
    );
    await writeTargetText(cfg, options.experimentNotesPath, nextNotes.endsWith('\n') ? nextNotes : `${nextNotes}\n`);
  }

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
  // AUDIT-FIX [audit-3-ar#6]: Bootstrap re-apply stacks duplicate sections.
  // Previously the marker check only matched the *current* `createdAt`,
  // so a re-bootstrap conversation (which generates a new `createdAt`)
  // bypassed the guard and appended a SECOND `## Success Criteria` /
  // `## Primary Metric` block to the session file. Multiple
  // re-bootstraps would pile up N copies, confusing both the agent and
  // anyone reading the living doc. Now ANY prior marker in the file
  // short-circuits the re-apply. Trade-off: a user who genuinely wants
  // a fresh plan must clear the session first — explicit, not silent.
  //
  // Idempotency: skip if this exact bootstrap has already been applied OR
  // if ANY prior bootstrap was applied to this session. Re-applying
  // bootstrap when the user re-runs the conversation (which generates a
  // new `createdAt`) would otherwise append a second `## Success Criteria`
  // / `## Primary Metric` block to the session file, which is confusing
  // for both the agent and the human reading the doc.
  //
  // The trade-off: if a user explicitly wants to re-bootstrap with a
  // totally new plan, they'll need to clear the session first. That is
  // safer than silent duplicate sections.
  const ANY_BOOTSTRAP_MARKER = /<!-- bootstrap-seeded:[^>]+ -->/;
  if (existing && ANY_BOOTSTRAP_MARKER.test(existing)) {
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
