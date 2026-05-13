import { ZodError, z } from 'zod';
import { ExtractedBaselineSchema } from '@/services/autoresearch/bootstrap/schema';
import type { ExtractedBaseline } from '@/services/autoresearch/bootstrap/types';

const BaselineExtractEnvelopeSchema = z.union([
  z.object({
    baselines: z.array(ExtractedBaselineSchema),
  }).strict(),
  z.array(ExtractedBaselineSchema),
]);

export interface BaselineExtractResult {
  ok: boolean;
  baselines: ExtractedBaseline[];
  unresolvedQuestions: string[];
  reason?: string;
}

function normalizeNumberToken(value: number): string[] {
  const normalized = value.toString();
  const fixedOne = value.toFixed(1);
  const fixedTwo = value.toFixed(2);
  return Array.from(new Set([normalized, fixedOne, fixedTwo]));
}

function metricAppearsInSource(value: number, sourceText: string): boolean {
  const normalizedSource = sourceText.replace(/,/g, ' ');
  return normalizeNumberToken(value).some((token) => normalizedSource.includes(token));
}

function parseEnvelope(raw: string): ExtractedBaseline[] {
  const parsed = JSON.parse(raw.trim());
  const envelope = BaselineExtractEnvelopeSchema.parse(parsed);
  return Array.isArray(envelope) ? envelope : envelope.baselines;
}

export function parseBaselineExtractResponse(raw: string, sourceText: string): BaselineExtractResult {
  try {
    const baselines = parseEnvelope(raw);
    const unresolvedQuestions: string[] = [];

    baselines.forEach((baseline) => {
      baseline.reportedMetrics.forEach((metric) => {
        if (!metricAppearsInSource(metric.value, sourceText)) {
          unresolvedQuestions.push(
            `Metric ${metric.name}=${metric.value} for baseline ${baseline.name} does not appear in the source text.`,
          );
        }
      });
    });

    if (unresolvedQuestions.length > 0) {
      return {
        ok: false,
        baselines: [],
        unresolvedQuestions,
        reason: 'baseline_extract returned metrics that could not be grounded in the source paper.',
      };
    }

    if (baselines.length === 0) {
      unresolvedQuestions.push('No baselines were extracted. Ask the user to confirm one manually.');
    }

    return {
      ok: baselines.length > 0,
      baselines,
      unresolvedQuestions,
      reason: baselines.length > 0 ? undefined : 'No baselines extracted.',
    };
  } catch (error) {
    const reason = error instanceof ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Invalid baseline JSON response.';
    return {
      ok: false,
      baselines: [],
      unresolvedQuestions: ['The baseline extraction response was not valid JSON-only output.'],
      reason,
    };
  }
}