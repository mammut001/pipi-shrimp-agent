/**
 * AutoResearch Loop Engine — pure result-parsing helpers.
 *
 * Extracted from `loopEngine.ts` as part of the AG-02 complexity
 * refactor. These helpers have no React, store, or DOM dependencies:
 * they take a string of agent output plus a metric name and return
 * a `ParsedIterationMetricsResult` describing what the agent said
 * about the iteration. Splitting them out keeps `loopEngine.ts`
 * focused on the loop state machine and lets the parsers be unit
 * tested directly with `@jest/globals` (no React/jsdom required).
 */

import type { ExperimentStatus } from '@/store/autoresearchStore';
import { formatError } from './errors';

export interface ParsedResult {
  metricName: string;
  metricValue: number | null;
  status: ExperimentStatus;
  hypothesis: string;
  change?: string;
  reasoning?: string;
  artifactPaths: string[];
  parseSource: 'metrics_json' | 'agent_json' | 'deprecated_result_line';
  failReason?: string;
  extra?: Record<string, number | string | boolean>;
}

export interface ParsedIterationMetricsResult {
  parsed: ParsedResult | null;
  parseError?: string;
}

export function parseMetricNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    if (value.trim().toLowerCase() === 'null') {
      return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseMetricValue(value: unknown): { value: number | null; error?: string } {
  if (value === null) {
    return { value: null };
  }

  if (value === undefined) {
    return {
      value: null,
      error: 'Invalid structured result metricValue "<missing>". Expected a finite number or null.',
    };
  }

  const parsed = parseMetricNumber(value);
  if (parsed !== null) {
    return { value: parsed };
  }

  if (typeof value === 'string' && value.trim().toLowerCase() === 'null') {
    return { value: null };
  }

  return {
    value: null,
    error: `Invalid structured result metricValue "${String(value)}". Expected a finite number or null.`,
  };
}

/**
 * Resolve `metricValue` from a candidate object, distinguishing an explicit
 * `null` (which is valid for FAILED results with a failReason) from a missing
 * key. We must not use `metricValue ?? metric_value` because the `??` operator
 * would treat `null` as missing and silently substitute the snake_case
 * alternative — so a JSON object that intentionally sets `metricValue: null`
 * would fall through and the parser would report
 * "Invalid structured result metricValue \"<missing>\"".
 */
export function resolveCandidateMetricValue(candidate: Record<string, unknown>): {
  value: unknown;
  present: boolean;
} {
  const hasCamel = Object.prototype.hasOwnProperty.call(candidate, 'metricValue');
  const hasSnake = Object.prototype.hasOwnProperty.call(candidate, 'metric_value');
  if (hasCamel) {
    return { value: candidate.metricValue, present: true };
  }
  if (hasSnake) {
    return { value: candidate.metric_value, present: true };
  }
  return { value: undefined, present: false };
}

export function extractBalancedJsonObjects(text: string): string[] {
  const matches: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        matches.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return matches;
}

export function parseStructuredJsonCandidates(
  candidates: string[],
  metricName: string,
): ParsedIterationMetricsResult {
  let parseError: string | undefined;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]?.trim();
    if (!candidate) {
      continue;
    }

    try {
      const raw = JSON.parse(candidate);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        parseError ??= 'Invalid structured result: expected a JSON object.';
        continue;
      }

      const normalized = normalizeParsedResult(raw as Record<string, unknown>, metricName, 'agent_json');
      if (normalized.parsed) {
        return normalized;
      }
      parseError ??= normalized.parseError;
    } catch (error) {
      parseError ??= `Invalid structured JSON result: ${formatError(error)}`;
    }
  }

  return { parsed: null, parseError };
}

export function parseAgentJsonResult(agentOutput: string, metricName: string): ParsedIterationMetricsResult {
  let parseError: string | undefined;
  const fencedBlocks = [...agentOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1])
    .filter((block): block is string => typeof block === 'string' && block.includes('{'));

  if (fencedBlocks.length > 0) {
    const fencedResult = parseStructuredJsonCandidates(
      fencedBlocks.flatMap((block) => extractBalancedJsonObjects(block).length > 0 ? extractBalancedJsonObjects(block) : [block]),
      metricName,
    );
    if (fencedResult.parsed) {
      return fencedResult;
    }
    parseError = fencedResult.parseError;
  }

  const plainResult = parseStructuredJsonCandidates(extractBalancedJsonObjects(agentOutput), metricName);
  if (plainResult.parsed) {
    return plainResult;
  }

  return {
    parsed: null,
    parseError: parseError ?? plainResult.parseError,
  };
}

export function normalizeParsedResult(
  candidate: Record<string, unknown>,
  metricName: string,
  parseSource: ParsedResult['parseSource'],
): ParsedIterationMetricsResult {
  const hypothesis = String(candidate.hypothesis ?? candidate.hypothesis_text ?? '').trim();
  if (!hypothesis) {
    return {
      parsed: null,
      parseError: 'Invalid structured result: hypothesis must be a non-empty string.',
    };
  }

  const rawStatus = String(candidate.status ?? '').trim();
  if (!['IMPROVED', 'NOT_IMPROVED', 'FAILED'].includes(rawStatus)) {
    return {
      parsed: null,
      parseError: `Invalid structured result status "${rawStatus || '<missing>'}". Expected IMPROVED, NOT_IMPROVED, or FAILED.`,
    };
  }

  const resolvedMetric = resolveCandidateMetricValue(candidate);
  const metric = parseMetricValue(resolvedMetric.value);
  if (metric.error) {
    return {
      parsed: null,
      parseError: metric.error,
    };
  }

  const rawChange = typeof candidate.change === 'string'
    ? candidate.change.trim()
    : typeof candidate.patchSummary === 'string'
      ? candidate.patchSummary.trim()
      : '';
  const rawReasoning = typeof candidate.reasoning === 'string'
    ? candidate.reasoning.trim()
    : typeof candidate.analysis === 'string'
      ? candidate.analysis.trim()
      : '';
  const change = rawChange || undefined;
  const reasoning = rawReasoning || undefined;
  const artifactPaths = Array.isArray(candidate.artifactPaths)
    ? candidate.artifactPaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : Array.isArray(candidate.artifacts)
      ? candidate.artifacts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

  return {
    parsed: {
      metricName: String(candidate.metricName ?? candidate.metric_name ?? metricName),
      metricValue: metric.value,
      status: rawStatus as ExperimentStatus,
      hypothesis,
      change,
      reasoning,
      artifactPaths,
      parseSource,
      failReason: candidate.failReason ? String(candidate.failReason) : candidate.fail_reason ? String(candidate.fail_reason) : undefined,
      extra: candidate.extra && typeof candidate.extra === 'object'
        ? candidate.extra as Record<string, number | string | boolean>
        : undefined,
    },
  };
}

export function parseExperimentResult(agentOutput: string, metricName: string): ParsedIterationMetricsResult {
  const match = agentOutput.match(
    /EXPERIMENT_RESULT:\s*metric_value=(\S+)\s+status=(\S+)(?:\s+fail_reason="([^"]*)")?\s+hypothesis="([^"]*)"/,
  );
  if (!match) {
    return { parsed: null };
  }

  const metric = parseMetricValue(match[1]);
  if (metric.error) {
    return { parsed: null, parseError: metric.error };
  }

  const status = match[2]?.trim() ?? '';
  if (!['IMPROVED', 'NOT_IMPROVED', 'FAILED'].includes(status)) {
    return {
      parsed: null,
      parseError: `Invalid structured result status "${status || '<missing>'}". Expected IMPROVED, NOT_IMPROVED, or FAILED.`,
    };
  }

  const hypothesis = match[4]?.trim() ?? '';
  if (!hypothesis) {
    return {
      parsed: null,
      parseError: 'Invalid structured result: hypothesis must be a non-empty string.',
    };
  }

  return {
    parsed: {
      metricName,
      metricValue: metric.value,
      status: status as ExperimentStatus,
      failReason: match[3] || undefined,
      hypothesis,
      artifactPaths: [],
      parseSource: 'deprecated_result_line',
    },
  };
}
