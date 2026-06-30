/**
 * Coerce arbitrary runtime values into safe React text children.
 * LLM/tool payloads occasionally leak objects (e.g. `{ label, description }`)
 * into UI state; rendering them directly triggers React invariant #31.
 */
export function coerceRenderableText(value: unknown, fallback = ''): string {
  if (value == null) {
    return fallback;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidates = ['label', 'description', 'name', 'title', 'message', 'value', 'text'];
    for (const key of candidates) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }

    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return String(value);
}

/** Normalize select options that models sometimes emit as `{ label, description }`. */
export function normalizeSelectOption(value: unknown): string {
  return coerceRenderableText(value);
}