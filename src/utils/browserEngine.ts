/**
 * Browser automation engine selection.
 *
 * Decides which runtime should service a browser task. The selection rules
 * are intentionally simple so they are easy to reason about and test:
 *
 *   1. If the caller passed an explicit `requested` engine and the
 *      corresponding capability flag is enabled, use it.
 *   2. Otherwise, fall back to the engine configured in localStorage
 *      (defaults to `cdp_native`).
 *
 * Every entry point in the codebase that drives a browser task should call
 * `resolveBrowserEngine()` instead of hard-coding a value. This keeps the
 * legacy page-agent path as a deliberate opt-in rather than a silent default.
 *
 * Logging convention:
 *   [BrowserEngine] Selected engine: <engine>
 *   [BrowserEngine] Legacy PageAgent disabled by default
 *   [BrowserEngine] Vision fallback disabled
 *
 * Tests in `src/__tests__/browserEngine.test.ts` cover the matrix.
 */

import {
  getBrowserEngineDefault,
  isBrowserPageAgentLegacyEnabled,
  isBrowserVisionFallbackEnabled,
  isValidBrowserEngine,
} from './browserFeatureFlags';
import type {
  BrowserAutomationEngine,
  BrowserEngineResolution,
} from '@/types/browserEngine';

const FALLBACK_ENGINE: BrowserAutomationEngine = 'cdp_native';

const logEngineSelection = (resolution: BrowserEngineResolution): void => {
  // Keep these messages small so the existing [BrowserEngine] prefix is easy
  // to grep for in logs.
  // eslint-disable-next-line no-console
  console.info(`[BrowserEngine] Selected engine: ${resolution.engine}`);
  if (!resolution.legacyEnabled) {
    // eslint-disable-next-line no-console
    console.info('[BrowserEngine] Legacy PageAgent disabled by default');
  }
  if (!resolution.visionEnabled) {
    // eslint-disable-next-line no-console
    console.info('[BrowserEngine] Vision fallback disabled');
  }
};

const readDefaultEngine = (): BrowserAutomationEngine => {
  const raw = getBrowserEngineDefault();
  if (isValidBrowserEngine(raw)) {
    return raw;
  }
  return FALLBACK_ENGINE;
};

/**
 * Resolve which engine should service the next task.
 *
 * @param requested Optional explicit engine requested by the caller.
 * @param options.silent Skip the `[BrowserEngine]` log line (used by tests).
 */
export const resolveBrowserEngine = (
  requested?: BrowserAutomationEngine | null,
  options: { silent?: boolean } = {},
): BrowserEngineResolution => {
  const legacyEnabled = isBrowserPageAgentLegacyEnabled();
  const visionEnabled = isBrowserVisionFallbackEnabled();
  const defaultEngine = readDefaultEngine();

  let engine: BrowserAutomationEngine = defaultEngine;
  if (requested) {
    // Only honour explicit requests when the corresponding flag is on.
    if (requested === 'legacy_page_agent' && legacyEnabled) {
      engine = 'legacy_page_agent';
    } else if (requested === 'vision_fallback' && visionEnabled) {
      engine = 'vision_fallback';
    } else if (requested === 'cdp_native') {
      engine = 'cdp_native';
    } else {
      // The caller asked for a disabled engine. Stay on the safe default.
      engine = defaultEngine === 'cdp_native' ? 'cdp_native' : FALLBACK_ENGINE;
    }
  }

  // Default engine may be legacy/vision even if the explicit flags are off.
  // Make sure we never run a legacy or vision engine without the flag.
  if (engine === 'legacy_page_agent' && !legacyEnabled) {
    engine = 'cdp_native';
  }
  if (engine === 'vision_fallback' && !visionEnabled) {
    engine = 'cdp_native';
  }

  const resolution: BrowserEngineResolution = {
    engine,
    requested: requested ?? undefined,
    legacyEnabled,
    visionEnabled,
    defaultEngine,
  };

  if (!options.silent) {
    logEngineSelection(resolution);
  }

  return resolution;
};

/**
 * Return true if the legacy page-agent WebView injection is currently allowed.
 * Used by the agent store to decide whether to short-circuit to CDP Native
 * when callers still try to use the deprecated entry points.
 */
export const isLegacyPageAgentRuntimeAllowed = (): boolean => isBrowserPageAgentLegacyEnabled();

/** Human-readable engine label suitable for tooltips or debug panels. */
export const describeBrowserEngine = (engine: BrowserAutomationEngine): string => {
  switch (engine) {
    case 'cdp_native':
      return 'CDP Native (fast, default)';
    case 'legacy_page_agent':
      return 'Legacy PageAgent (slow, deprecated)';
    case 'vision_fallback':
      return 'Vision Fallback (preview)';
    default:
      return engine;
  }
};
