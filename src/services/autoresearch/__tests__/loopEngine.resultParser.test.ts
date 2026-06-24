/**
 * Tests for the result-parser helpers extracted from loopEngine.ts
 * (AG-02 / complexity-governance §5). These were previously untested
 * private functions inside the 1870-LOC loopEngine.ts; the test
 * file pins their behavior before the extraction lands.
 *
 * Test surface covers:
 *  - parseMetricNumber — null / number / numeric string / 'null' / junk
 *  - parseMetricValue — explicit undefined vs explicit null vs junk
 *  - resolveCandidateMetricValue — camelCase vs snake_case, present vs missing
 *  - extractBalancedJsonObjects — string-aware brace counting, escapes
 *  - parseStructuredJsonCandidates — array of candidate strings, last-to-first
 *  - parseAgentJsonResult — fenced ```json blocks vs plain JSON
 *  - normalizeParsedResult — hypothesis / status / metric / artifact list
 *  - parseExperimentResult — legacy EXPERIMENT_RESULT: line
 */

import { describe, expect, it } from '@jest/globals';
import type { ExperimentStatus } from '@/store/autoresearchStore';
import {
  extractBalancedJsonObjects,
  normalizeParsedResult,
  parseAgentJsonResult,
  parseExperimentResult,
  parseMetricNumber,
  parseMetricValue,
  resolveCandidateMetricValue,
} from '../loopEngine.resultParser';

describe('parseMetricNumber', () => {
  it('returns null for null', () => {
    expect(parseMetricNumber(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseMetricNumber(undefined)).toBeNull();
  });

  it('returns finite numbers as-is', () => {
    expect(parseMetricNumber(0)).toBe(0);
    expect(parseMetricNumber(-1.5)).toBe(-1.5);
    expect(parseMetricNumber(42)).toBe(42);
  });

  it('returns null for NaN and Infinity', () => {
    expect(parseMetricNumber(NaN)).toBeNull();
    expect(parseMetricNumber(Infinity)).toBeNull();
    expect(parseMetricNumber(-Infinity)).toBeNull();
  });

  it('parses finite numeric strings', () => {
    expect(parseMetricNumber('3.14')).toBeCloseTo(3.14);
    expect(parseMetricNumber('-0.5')).toBeCloseTo(-0.5);
  });

  it('returns null for the literal string "null" (case-insensitive)', () => {
    expect(parseMetricNumber('null')).toBeNull();
    expect(parseMetricNumber('NULL')).toBeNull();
    expect(parseMetricNumber('  Null  ')).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(parseMetricNumber('not a number')).toBeNull();
  });

  it('returns null for non-string / non-number types', () => {
    expect(parseMetricNumber(true)).toBeNull();
    expect(parseMetricNumber({})).toBeNull();
    expect(parseMetricNumber([])).toBeNull();
  });
});

describe('parseMetricValue', () => {
  it('returns { value: null } for explicit null (no error)', () => {
    expect(parseMetricValue(null)).toEqual({ value: null });
  });

  it('returns error for explicit undefined', () => {
    const result = parseMetricValue(undefined);
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/missing/i);
  });

  it('parses finite numbers and numeric strings as a number', () => {
    expect(parseMetricValue(42)).toEqual({ value: 42 });
    expect(parseMetricValue('3.14')).toEqual({ value: 3.14 });
  });

  it('treats the literal string "null" as null (no error)', () => {
    expect(parseMetricValue('null')).toEqual({ value: null });
  });

  it('returns error for junk like a boolean or an object', () => {
    const r1 = parseMetricValue(true);
    expect(r1.value).toBeNull();
    expect(r1.error).toMatch(/Invalid structured result/);
    const r2 = parseMetricValue({ x: 1 });
    expect(r2.value).toBeNull();
    expect(r2.error).toMatch(/Invalid structured result/);
  });
});

describe('resolveCandidateMetricValue', () => {
  it('prefers camelCase metricValue when both keys are present', () => {
    expect(
      resolveCandidateMetricValue({ metricValue: 1, metric_value: 2 }),
    ).toEqual({ value: 1, present: true });
  });

  it('falls back to snake_case metric_value when camelCase is missing', () => {
    expect(
      resolveCandidateMetricValue({ metric_value: 2 }),
    ).toEqual({ value: 2, present: true });
  });

  it('returns { value: undefined, present: false } when neither key exists', () => {
    expect(resolveCandidateMetricValue({})).toEqual({
      value: undefined,
      present: false,
    });
  });

  it('treats explicit null as present (the whole point of the helper)', () => {
    expect(
      resolveCandidateMetricValue({ metricValue: null }),
    ).toEqual({ value: null, present: true });
  });
});

describe('extractBalancedJsonObjects', () => {
  it('extracts a single top-level object', () => {
    const text = 'before {"a": 1} after';
    expect(extractBalancedJsonObjects(text)).toEqual(['{"a": 1}']);
  });

  it('extracts multiple top-level objects', () => {
    const text = 'noise {"a": 1} middle {"b": 2} end';
    expect(extractBalancedJsonObjects(text)).toEqual(['{"a": 1}', '{"b": 2}']);
  });

  it('ignores unbalanced braces', () => {
    expect(extractBalancedJsonObjects('{ broken')).toEqual([]);
    expect(extractBalancedJsonObjects('}{')).toEqual([]);
  });

  it('handles nested objects correctly', () => {
    const text = '{"outer": {"inner": 1}}';
    expect(extractBalancedJsonObjects(text)).toEqual([text]);
  });

  it('tracks strings, including escaped quotes', () => {
    const text = '{"a": "He said \\"hi\\""}';
    expect(extractBalancedJsonObjects(text)).toEqual([text]);
  });

  it('does not treat braces inside a string as structural', () => {
    const text = '{"a": "} not closing {"}';
    expect(extractBalancedJsonObjects(text)).toEqual([text]);
  });
});

describe('normalizeParsedResult', () => {
  const metric = 'cv_accuracy';

  it('parses a complete, valid candidate', () => {
    const result = normalizeParsedResult(
      {
        hypothesis: 'use better augmentation',
        status: 'IMPROVED',
        metricValue: 0.9,
        change: 'tweak dropout',
        reasoning: 'because reasons',
        artifactPaths: ['/tmp/a.png', '/tmp/b.png'],
        failReason: undefined,
        extra: { x: 1 },
      },
      metric,
      'agent_json',
    );
    expect(result.parseError).toBeUndefined();
    expect(result.parsed).toMatchObject({
      metricName: metric,
      metricValue: 0.9,
      status: 'IMPROVED' satisfies ExperimentStatus,
      hypothesis: 'use better augmentation',
      change: 'tweak dropout',
      reasoning: 'because reasons',
      artifactPaths: ['/tmp/a.png', '/tmp/b.png'],
      parseSource: 'agent_json',
    });
    expect(result.parsed?.extra).toEqual({ x: 1 });
  });

  it('falls back to snake_case keys (hypothesis_text, metric_name, patchSummary, analysis, artifacts, fail_reason)', () => {
    const result = normalizeParsedResult(
      {
        hypothesis_text: 'h',
        status: 'NOT_IMPROVED',
        metric_value: 0.5,
        metric_name: 'loss',
        patchSummary: 'c',
        analysis: 'r',
        artifacts: ['/x.png'],
        fail_reason: 'no',
      },
      metric,
      'agent_json',
    );
    expect(result.parsed).toMatchObject({
      metricName: 'loss',
      change: 'c',
      reasoning: 'r',
      artifactPaths: ['/x.png'],
      failReason: 'no',
    });
  });

  it('returns parseError when hypothesis is missing or empty', () => {
    const r1 = normalizeParsedResult({ status: 'IMPROVED' }, metric, 'agent_json');
    expect(r1.parsed).toBeNull();
    expect(r1.parseError).toMatch(/hypothesis/);
    const r2 = normalizeParsedResult(
      { hypothesis: '   ', status: 'IMPROVED' },
      metric,
      'agent_json',
    );
    expect(r2.parsed).toBeNull();
  });

  it('returns parseError when status is invalid', () => {
    const r = normalizeParsedResult(
      { hypothesis: 'h', status: 'MAYBE' },
      metric,
      'agent_json',
    );
    expect(r.parsed).toBeNull();
    expect(r.parseError).toMatch(/status/i);
  });

  it('allows explicit null metricValue when status is FAILED (no error)', () => {
    const r = normalizeParsedResult(
      {
        hypothesis: 'h',
        status: 'FAILED',
        metricValue: null,
        failReason: 'crashed',
      },
      metric,
      'agent_json',
    );
    expect(r.parseError).toBeUndefined();
    expect(r.parsed).toMatchObject({
      metricValue: null,
      failReason: 'crashed',
    });
  });

  it('returns parseError when metricValue is undefined and status is IMPROVED', () => {
    const r = normalizeParsedResult(
      { hypothesis: 'h', status: 'IMPROVED' },
      metric,
      'agent_json',
    );
    expect(r.parsed).toBeNull();
    expect(r.parseError).toMatch(/Invalid structured result metricValue/);
  });

  it('filters out non-string entries from artifactPaths', () => {
    const r = normalizeParsedResult(
      {
        hypothesis: 'h',
        status: 'NOT_IMPROVED',
        metricValue: 0.4,
        artifactPaths: ['/a.png', 123, '', null, '/b.png'],
      },
      metric,
      'agent_json',
    );
    expect(r.parsed?.artifactPaths).toEqual(['/a.png', '/b.png']);
  });
});

describe('parseAgentJsonResult', () => {
  const metric = 'cv_accuracy';

  it('parses a fenced ```json block', () => {
    const text = '```json\n{"hypothesis": "h", "status": "IMPROVED", "metricValue": 0.9}\n```';
    const r = parseAgentJsonResult(text, metric);
    expect(r.parseError).toBeUndefined();
    expect(r.parsed?.metricValue).toBe(0.9);
  });

  it('parses a plain JSON object embedded in prose', () => {
    const text = 'here is the result: {"hypothesis":"h","status":"IMPROVED","metricValue":0.8} enjoy';
    const r = parseAgentJsonResult(text, metric);
    expect(r.parsed?.metricValue).toBe(0.8);
  });

  it('returns parsed: null when no JSON candidate is present', () => {
    const r = parseAgentJsonResult('not json at all', metric);
    expect(r.parsed).toBeNull();
    // No error string is set when the input contained zero balanced
    // JSON objects; downstream callers (e.g. parseIterationMetrics)
    // interpret the absence of a parseError as "no agent output to
    // parse" and fall through to the legacy EXPERIMENT_RESULT: line.
  });

  it('falls back to plain extraction when fenced blocks do not parse', () => {
    const text = '```json\nbroken\n```\nactually {"hypothesis":"h","status":"IMPROVED","metricValue":0.7}';
    const r = parseAgentJsonResult(text, metric);
    expect(r.parsed?.metricValue).toBe(0.7);
  });
});

describe('parseExperimentResult (deprecated EXPERIMENT_RESULT: line)', () => {
  const metric = 'loss';

  it('parses a well-formed legacy line', () => {
    const text = 'EXPERIMENT_RESULT: metric_value=0.42 status=IMPROVED hypothesis="use SGD"';
    const r = parseExperimentResult(text, metric);
    expect(r.parseError).toBeUndefined();
    expect(r.parsed).toMatchObject({
      metricName: metric,
      metricValue: 0.42,
      status: 'IMPROVED',
      hypothesis: 'use SGD',
      parseSource: 'deprecated_result_line',
    });
  });

  it('parses a FAILED line with fail_reason', () => {
    const text = 'EXPERIMENT_RESULT: metric_value=null status=FAILED fail_reason="oops" hypothesis="try"';
    const r = parseExperimentResult(text, metric);
    expect(r.parsed).toMatchObject({
      status: 'FAILED',
      failReason: 'oops',
      metricValue: null,
    });
  });

  it('returns { parsed: null } (no error) when line is absent', () => {
    const r = parseExperimentResult('no result line here', metric);
    expect(r.parsed).toBeNull();
    expect(r.parseError).toBeUndefined();
  });

  it('returns parseError for invalid status', () => {
    const text = 'EXPERIMENT_RESULT: metric_value=1.0 status=MAYBE hypothesis="h"';
    const r = parseExperimentResult(text, metric);
    expect(r.parsed).toBeNull();
    expect(r.parseError).toMatch(/status/i);
  });

  it('returns parseError for invalid metric value', () => {
    const text = 'EXPERIMENT_RESULT: metric_value=banana status=IMPROVED hypothesis="h"';
    const r = parseExperimentResult(text, metric);
    expect(r.parsed).toBeNull();
    expect(r.parseError).toMatch(/metricValue/);
  });
});
