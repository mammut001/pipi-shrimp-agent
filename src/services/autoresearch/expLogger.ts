/**
 * AutoResearch Experiment Logger — Dual-write to Markdown + SQLite.
 *
 * Markdown log at ~/.pipi-shrimp/autoresearch/experiment_log.md  (human-readable)
 * SQLite experiments table                                        (queryable)
 */

import { invoke } from '@tauri-apps/api/core';
import type { ExperimentEntry, ExperimentSession } from '@/store/autoresearchStore';

// ============== Markdown logging ==============

const LOG_PATH = '~/.pipi-shrimp/autoresearch/experiment_log.md';

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

  // Resolve ~ to home dir, then use write_file in append mode.
  // We rely on the Rust backend to handle the path and create parent dirs.
  try {
    // First check if file exists by reading it
    try {
      await invoke<string>('read_file_text', { path: expandHome(LOG_PATH) });
    } catch {
      // File doesn't exist — write header first
      const header = `# AutoResearch Experiment Log\n\nSession: ${session.id}\nStarted: ${session.startedAt}\nMetric: ${session.metricName} (${session.metricDirection} is better)\n\n---\n\n`;
      await invoke('write_file_text', { path: expandHome(LOG_PATH), content: header });
    }

    // Append the entry
    await invoke('append_file_text', { path: expandHome(LOG_PATH), content: block });
  } catch (e) {
    // Fallback: try writing through Bash
    console.warn('[expLogger] invoke failed, falling back to bash:', e);
    const escaped = block.replace(/'/g, "'\\''");
    await invoke('execute_bash', {
      command: `mkdir -p ~/.pipi-shrimp/autoresearch && echo '${escaped}' >> ${expandHome(LOG_PATH)}`,
      timeoutSecs: 10,
    });
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

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    // We can't resolve ~ in TS — pass it through and let Rust handle it.
    // If Rust doesn't handle ~, the bash fallback will.
    return p;
  }
  return p;
}
