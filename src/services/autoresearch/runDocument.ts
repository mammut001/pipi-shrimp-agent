import type { AutoResearchRunEvent, AutoResearchRunRecord } from './history';
import {
  buildIterationSummaries,
  buildMetricTimeline,
  formatMetricValue,
  getBestMetricPoint,
} from './metricTimeline';

export interface AutoResearchRunDocument {
  title: string;
  subtitle: string;
  badge: string;
  filename?: string;
  createdAt?: string;
  updatedAt?: string;
  path?: string;
  tags: string[];
  markdown: string;
}

const MAX_MARKDOWN_LIVE_OUTPUT_CHARS = 4_000;
const MAX_MARKDOWN_EVENTS = 12;
const MAX_MARKDOWN_ARTIFACTS = 24;

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed || 'experiment';
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, '$1[redacted]')
    .replace(/(x-api-key\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(api[_ -]?key\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(password\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(secret\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(token\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]');
}

function markdownValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'N/A';
  }
  return redactSensitiveText(String(value));
}

function uniqueValues(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function formatEvent(event: AutoResearchRunEvent): string {
  return `- ${event.timestamp} · ${event.level}/${event.phase}: ${redactSensitiveText(event.message)}`;
}

function buildConfigMarkdown(run: AutoResearchRunRecord): string[] {
  const snapshot = run.config.configSnapshot;
  return [
    `- Config: ${markdownValue(snapshot.configName)}`,
    `- Provider: ${markdownValue(snapshot.provider)}`,
    `- API format: ${markdownValue(snapshot.apiFormat)}`,
    `- Base URL: ${markdownValue(snapshot.baseUrl)}`,
    `- Model: ${markdownValue(snapshot.model)}`,
    `- Key present: ${snapshot.keyPresent ? 'yes' : 'no'}`,
    `- Key preview: ${markdownValue(snapshot.keyPreview)}`,
    `- Source: ${markdownValue(snapshot.source)}`,
    snapshot.warning ? `- Warning: ${markdownValue(snapshot.warning)}` : '',
  ].filter(Boolean);
}

export function buildAutoResearchRunDocument(run: AutoResearchRunRecord): AutoResearchRunDocument {
  const timeline = buildMetricTimeline(run);
  const summaries = buildIterationSummaries(run);
  const bestPoint = getBestMetricPoint(timeline);
  const bestMetricValue = typeof run.bestMetricValue === 'number' ? run.bestMetricValue : bestPoint?.value ?? null;
  const bestIteration = typeof run.bestIteration === 'number' ? run.bestIteration : bestPoint?.iteration ?? null;
  const experimentName = basename(run.config.experimentDir || run.config.workdir || run.title);
  const metricName = run.config.metric || 'metric';
  const title = run.title || `${experimentName} · ${metricName}`;
  const subtitleParts = [run.config.experimentDir, run.status.replace(/_/g, ' ')].filter(Boolean);
  const configSnapshot = run.config.configSnapshot;
  const tags = uniqueValues([
    'autoresearch',
    metricName,
    run.status,
    configSnapshot.provider,
    configSnapshot.model,
  ]);
  const artifactPaths = uniqueValues(run.iterations.flatMap((iteration) => iteration.artifactPaths ?? []));
  const eventLines = run.events.slice(-MAX_MARKDOWN_EVENTS).map(formatEvent);
  const iterationRows = summaries.map((summary) => [
    summary.iteration === 0 ? 'Baseline' : `#${summary.iteration}`,
    summary.status,
    summary.metricValue === null ? 'N/A' : formatMetricValue(summary.metricValue),
    summary.impactLabel,
    redactSensitiveText(summary.changeSummary).replace(/\|/g, '\\|'),
  ]).map((cells) => `| ${cells.join(' | ')} |`);
  const liveOutput = run.liveOutputExcerpt
    ? redactSensitiveText(run.liveOutputExcerpt.slice(-MAX_MARKDOWN_LIVE_OUTPUT_CHARS))
    : '';
  const finalError = run.status === 'failed'
    ? run.summary || run.iterations.find((iteration) => iteration.error)?.error
    : null;

  const markdown = [
    '# Overview',
    `- Run ID: ${markdownValue(run.id)}`,
    `- Status: ${markdownValue(run.status)}`,
    `- Experiment directory: ${markdownValue(run.config.experimentDir)}`,
    `- Workdir: ${markdownValue(run.config.workdir)}`,
    `- Metric: ${markdownValue(metricName)}`,
    `- Direction: ${markdownValue(run.config.direction)}`,
    `- Baseline: ${formatMetricValue(run.config.baseline)}`,
    `- Best: ${bestMetricValue === null ? 'N/A' : `${formatMetricValue(bestMetricValue)} at iteration ${bestIteration ?? 'N/A'}`}`,
    '',
    '# Config Snapshot',
    ...buildConfigMarkdown(run),
    '',
    '# Metric Summary',
    `- Numeric points: ${timeline.filter((point) => point.value !== null).length}`,
    `- Baseline point: ${typeof run.config.baseline === 'number' ? `iteration 0 (${formatMetricValue(run.config.baseline)})` : 'N/A'}`,
    `- Best iteration: ${bestIteration ?? 'N/A'}`,
    `- Best metric value: ${bestMetricValue === null ? 'N/A' : formatMetricValue(bestMetricValue)}`,
    '',
    '# Iterations',
    '| Run | Status | Metric | Impact | Change |',
    '| --- | --- | ---: | --- | --- |',
    ...(iterationRows.length > 0 ? iterationRows : ['| N/A | pending | N/A | N/A | No iterations recorded |']),
    '',
    '# Artifacts',
    ...(artifactPaths.length > 0
      ? artifactPaths.slice(0, MAX_MARKDOWN_ARTIFACTS).map((path) => `- ${markdownValue(path)}`)
      : ['- N/A']),
    '',
    '# Recent Events',
    ...(eventLines.length > 0 ? eventLines : ['- N/A']),
    '',
    '# Live Output Excerpt',
    liveOutput ? ['```text', liveOutput, '```'].join('\n') : 'N/A',
    ...(finalError ? ['', '# Final Error', redactSensitiveText(finalError)] : []),
  ].join('\n');

  return {
    title,
    subtitle: subtitleParts.join(' · '),
    badge: run.status.replace(/_/g, ' '),
    filename: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    path: run.config.livingDocPath || run.config.sessionFilePath || run.config.experimentDir,
    tags,
    markdown,
  };
}