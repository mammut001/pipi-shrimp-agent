/**
 * AutoResearch Loop Engine — metrics phase helpers.
 *
 * Extracted from `loopEngine.ts` as part of AG-02 PR2b to shrink the
 * loop state machine. These helpers own the PARSE_METRICS side of an
 * iteration: reading metrics.json / agent output, building narrative
 * and recovery-action payloads, and assembling artifact path lists.
 *
 * They are consumed by `loopEngine.iterationPhase.ts` (and remain
 * unit-testable without spinning up the full loop). Side-effect-free
 * except `parseIterationMetrics`, which performs target IO via
 * `readTargetText`.
 */

import type { ExperimentStatus, SshConfig } from '@/store/autoresearchStore';
import { parseMetricsArtifactPayload } from './metricsSchema';
import { readTargetText, type RunDir } from './runDir';
import {
  normalizeParsedResult,
  parseAgentJsonResult,
  parseExperimentResult,
  type ParsedIterationMetricsResult,
} from './loopEngine.resultParser';

export async function parseIterationMetrics(
  cfg: SshConfig,
  runDir: RunDir,
  metricName: string,
  metricDirection: 'lower' | 'higher',
  agentOutput: string,
): Promise<ParsedIterationMetricsResult> {
  const metricsCandidates = [
    runDir.metricsPath,
    `${runDir.codeDir}/metrics.json`,
  ].filter((value, index, list) => list.indexOf(value) === index);

  for (const candidatePath of metricsCandidates) {
    const metricsContent = await readTargetText(cfg, candidatePath);
    if (!metricsContent) {
      continue;
    }
    try {
      const sanitizedMetricsContent = metricsContent.replace(/:\s*NaN\b/g, ': null').replace(/:\s*Infinity\b/g, ': null');
      const raw = JSON.parse(sanitizedMetricsContent) as unknown;
      const artifact = parseMetricsArtifactPayload(raw, {
        expectedSessionId: runDir.sessionId,
        expectedRunId: runDir.sessionId,
        expectedIteration: runDir.iter,
        expectedMetricName: metricName,
        expectedDirection: metricDirection,
      });
      if (artifact.value) {
        const normalized = normalizeParsedResult(
          artifact.value as unknown as Record<string, unknown>,
          metricName,
          'metrics_json',
        );
        if (normalized.parsed && typeof normalized.parsed.metricValue === 'number' && Number.isFinite(normalized.parsed.metricValue)) {
          return normalized;
        }
      }
    } catch {
      // Invalid on-disk JSON: try next candidate or fall through to agent stdout parsers.
    }
  }

  const structuredOutput = parseAgentJsonResult(agentOutput, metricName);
  if (structuredOutput.parsed) {
    return structuredOutput;
  }

  const fallback = parseExperimentResult(agentOutput, metricName);
  if (fallback.parsed) {
    return fallback;
  }

  return {
    parsed: null,
    parseError: structuredOutput.parseError ?? fallback.parseError ?? 'Could not parse metrics.json or structured agent output.',
  };
}

export function mergeArtifactPaths(...groups: Array<string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? []).filter((value) => value.trim().length > 0)));
}

export function buildIterationNarrative(input: {
  hypothesis: string;
  change?: string;
  status: ExperimentStatus;
  metricName: string;
  metricValue: number | null;
  failReason?: string;
  nextStep?: string;
}): string {
  const changeSummary = input.change?.trim() || 'No code change summary recorded.';
  const outcome = input.status === 'FAILED'
    ? `Experiment failed${input.failReason ? `: ${input.failReason}` : '.'}`
    : input.metricValue === null
      ? `Experiment completed without a parsed ${input.metricName}.`
      : `Experiment completed with ${input.metricName}=${input.metricValue}.`;
  const next = input.nextStep?.trim() || 'No follow-up recommendation recorded.';
  return `${input.hypothesis}. Changed: ${changeSummary}. ${outcome} Next: ${next}`;
}

export function buildIterationParsedMetrics(
  metricName: string,
  metricValue: number | null,
  extra?: Record<string, number | string | boolean>,
): Record<string, number | string | boolean | null> {
  return {
    [metricName]: metricValue,
    ...(extra ?? {}),
  };
}

export function buildRateLimitRetryNarrative(input: {
  iteration: number;
  cooldownSeconds: number;
  message: string;
}): string {
  return `Provider rate limited iteration ${input.iteration}. Cooling down for ${input.cooldownSeconds}s before retrying the same iteration. Last error: ${input.message}`;
}

export function buildIterationRecoveryActions(options: {
  status: ExperimentStatus;
  hasLogs: boolean;
  failReason?: string;
}): Array<{ type: 'retry_failed_phase' | 'retry_iteration' | 'switch_provider' | 'open_raw_request_summary' | 'open_logs' | 'abort_run' | 'increase_tool_budget'; supported: boolean; label?: string; reason?: string }> {
  if (options.status !== 'FAILED') {
    return [];
  }

  const actions: Array<{ type: 'retry_failed_phase' | 'retry_iteration' | 'switch_provider' | 'open_raw_request_summary' | 'open_logs' | 'abort_run' | 'increase_tool_budget'; supported: boolean; label?: string; reason?: string }> = [
    {
      type: 'retry_iteration',
      supported: true,
      label: 'Retry iteration',
    },
    {
      type: 'abort_run',
      supported: true,
      label: 'Abort run',
    },
    {
      type: 'open_raw_request_summary',
      supported: true,
      label: 'Open raw request summary',
    },
    {
      type: 'open_logs',
      supported: options.hasLogs,
      label: 'Open logs',
      reason: options.hasLogs ? undefined : 'No log artifact is available for this iteration.',
    },
  ];

  if (isToolBudgetExhaustedReason(options.failReason)) {
    actions.push({
      type: 'increase_tool_budget',
      // No loop-engine API yet — keep supported=false so UI does not fake success.
      supported: false,
      label: 'Increase tool budget or fix tool permission/confirmation settings.',
      reason: 'This iteration stopped because the AutoResearch tool budget ran out before evaluation completed. Increase the tool-round budget for the active agent config, or fix any tool permission/confirmation settings so reads and writes no longer require manual approval, then start a new run.',
    });
  }

  return actions;
}

export function isToolBudgetExhaustedReason(failReason: string | undefined): boolean {
  if (!failReason) {
    return false;
  }
  const normalized = failReason.trim().toLowerCase();
  return normalized === 'tool_budget_exhausted'
    || normalized.includes('tool budget exhausted')
    || normalized.includes('budget exhausted before evaluation');
}
