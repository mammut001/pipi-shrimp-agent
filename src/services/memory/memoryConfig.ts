/**
 * Memory Extraction Configuration
 *
 * Constants and feature-flag helpers for auto-extraction.
 * Based on Claude Code's feature flag system.
 */

/** Minimum new model-visible messages required to trigger extraction */
export const MIN_NEW_MESSAGES_TO_EXTRACT = 4;

/**
 * Minimum turns between extractions (throttle).
 * Claude Code uses a feature flag "tengu_bramble_lintel" defaulting to 1.
 */
export const TURNS_BETWEEN_EXTRACTIONS = 1;

/** Maximum turns the extraction mini-agent may run */
export const EXTRACTION_MAX_TURNS = 2;

/**
 * Check whether auto-memory extraction is enabled.
 * Respects both the localStorage setting and an env-var override.
 */
export function isAutoExtractionEnabled(): boolean {
  // Env-var override (set in tests or via .env)
  const envVars = (globalThis as any).process?.env ?? {};
  if (envVars.PIPISHRIMP_DISABLE_AUTO_MEMORY === 'true' || envVars.PIPISHRIMP_DISABLE_AUTO_MEMORY === '1') {
    return false;
  }

  const stored = localStorage.getItem('pipishrimp-auto-memory-enabled');
  return stored !== 'false';     // enabled by default
}
