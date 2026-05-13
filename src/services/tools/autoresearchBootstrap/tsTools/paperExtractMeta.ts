import { ZodError } from 'zod';
import { PaperReferenceSchema } from '@/services/autoresearch/bootstrap/schema';
import type { PaperReference } from '@/services/autoresearch/bootstrap/types';

export interface PaperExtractMetaResult {
  ok: boolean;
  paper?: PaperReference;
  reason?: string;
}

function parseJsonCandidate(raw: string): unknown {
  return JSON.parse(raw.trim());
}

export function parsePaperExtractMetaResponse(raw: string): PaperExtractMetaResult {
  try {
    const parsed = parseJsonCandidate(raw);
    const candidate = parsed && typeof parsed === 'object' && 'paper' in parsed
      ? (parsed as { paper: unknown }).paper
      : parsed;
    return {
      ok: true,
      paper: PaperReferenceSchema.parse(candidate),
    };
  } catch (error) {
    const reason = error instanceof ZodError
      ? error.issues.map((issue) => issue.message).join('; ')
      : error instanceof Error
        ? error.message
        : 'Invalid JSON-only paper metadata response.';
    return {
      ok: false,
      reason,
    };
  }
}