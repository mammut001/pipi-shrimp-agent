/**
 * AutoResearch Experiment Logger — Dual-write to Markdown + SQLite.
 *
 * Markdown log beside the configured AutoResearch session file      (human-readable)
 * SQLite experiments table                                         (queryable)
 */

import { invoke } from '@tauri-apps/api/core';
import type { ExperimentEntry, ExperimentSession } from '@/store/autoresearchStore';
import {
  getAutoResearchLogPathFromSessionFile,
  getAutoResearchParentDir,
  getDefaultAutoResearchLogPath,
} from './paths';

// ============== Markdown logging ==============

type FileResponse = {
  content: string;
  path: string;
};

function formatMarkdownEntry(entry: ExperimentEntry, session: ExperimentSession): string {
  const metricStr = entry.metricValue !== null
    ? `${session.metricName}=${entry.metricValue}`
    : 'N/A';

  const prevBest = session.bestMetric !== null ? ` (prev best: ${session.bestMetric})` : '';

  return [
    `## Experiment ${entry.iteration} — ${entry.timestamp}`,
    `**Hypothesis**: ${entry.hypothesis}`,
    `**Change**: ${entry.change}`,
    `**Result**: ${metricStr} | Status: ${entry.status}${entry.failReason ? ` (${entry.failReason})` : ''}${prevBest}`,
    `**Reasoning**: ${entry.reasoning}`,
    `**Duration**: ${(entry.durationMs / 1000).toFixed(1)}s`,
    '---',
    '',
  ].join('\n');
}

/**
 * Append an experiment entry to the Markdown log file.
 * Creates the file with a header if it doesn't exist.
 */
export async function appendMarkdownLog(entry: ExperimentEntry, session: ExperimentSession): Promise<void> {
  const block = formatMarkdownEntry(entry, session);

  const logPath = await resolveLogPath(session);
  const logDir = getAutoResearchParentDir(logPath);
  const header = `# AutoResearch Experiment Log\n\nSession: ${session.id}\nStarted: ${session.startedAt}\nMetric: ${session.metricName} (${session.metricDirection} is better)\n\n---\n\n`;

  try {
    if (logDir) {
      await invoke('create_directory', { path: logDir });
    }

    const exists = await invoke<boolean>('path_exists', { path: logPath });
    if (!exists) {
      await invoke('write_file', { path: logPath, content: `${header}${block}` });
      return;
    }

    const current = await invoke<FileResponse>('read_file', { path: logPath });
    await invoke('write_file', { path: logPath, content: `${current.content}${block}` });
  } catch (error) {
    console.warn('[expLogger] file-command logging failed:', error);
    throw error;
  }
}

// ============== SQLite logging ==============

interface DbExperiment {
  id: string;
  session_id: string;
  iteration: number;
  hypothesis: string;
  change_description: string;
  metric_name: string;
  metric_value: number | null;
  status: string;
  fail_reason: string | null;
  reasoning: string;
  duration_ms: number;
  created_at: string;
}

/**
 * Save an experiment entry to the SQLite experiments table.
 * Falls back to no-op if the table doesn't exist yet (P2 feature).
 */
export async function saveExperimentToDb(entry: ExperimentEntry, session: ExperimentSession): Promise<void> {
  const record: DbExperiment = {
    id: `${session.id}-exp-${entry.iteration}`,
    session_id: session.id,
    iteration: entry.iteration,
    hypothesis: entry.hypothesis,
    change_description: entry.change,
    metric_name: session.metricName,
    metric_value: entry.metricValue,
    status: entry.status,
    fail_reason: entry.failReason || null,
    reasoning: entry.reasoning,
    duration_ms: entry.durationMs,
    created_at: entry.timestamp,
  };

  try {
    await invoke('save_experiment', { experiment: record });
  } catch (e) {
    // Table may not exist yet — log and continue (non-blocking)
    console.warn('[expLogger] SQLite save_experiment failed (table may not exist):', e);
  }
}

/**
 * Log an experiment: writes to both Markdown and SQLite.
 */
export async function logExperiment(entry: ExperimentEntry, session: ExperimentSession): Promise<void> {
  await Promise.allSettled([
    appendMarkdownLog(entry, session),
    saveExperimentToDb(entry, session),
  ]);
}

// ============== Helpers ==============

async function resolveLogPath(session: ExperimentSession): Promise<string> {
  return getAutoResearchLogPathFromSessionFile(session.sessionFilePath)
    ?? getDefaultAutoResearchLogPath();
}
