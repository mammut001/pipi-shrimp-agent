/**
 * Browser automation engine types.
 *
 * These types are the single source of truth for how the UI / store / agent
 * decide *which* browser automation runtime should be used.
 *
 * The default engine is `cdp_native` — page-agent WebView injection is kept as
 * an opt-in legacy escape hatch, and a `vision_fallback` stub is reserved for
 * future screenshot/coordinate agents (e.g. Fara) so we don't have to redesign
 * the dispatcher when that runtime lands.
 */

/** Engines currently recognised by the product. */
export type BrowserAutomationEngine =
  | 'cdp_native'
  | 'legacy_page_agent'
  | 'vision_fallback';

/** Permission modes for the safety policy layer. */
export type BrowserActionPermissionMode =
  | 'observe_only'
  | 'ask_each_action'
  | 'auto_safe';

/**
 * Tiered observation levels for the native agent loop. See
 * `src/utils/browserPageStateModel.ts` and `src/utils/nativeBrowserAgent.ts`
 * for how each level is produced.
 *
 * - `light`        — URL/title/text excerpt + active element only.
 * - `interactive`  — `light` + interactive elements visible in viewport.
 * - `full`         — full PageState (DOM snapshot + AX tree).
 * - `screenshot`   — placeholder for future vision-agent runs.
 */
export type ObservationLevel = 'light' | 'interactive' | 'full' | 'screenshot';

/** Human-readable label for logs and the debug panel. */
export const BROWSER_AUTOMATION_ENGINE_LABELS: Record<BrowserAutomationEngine, string> = {
  cdp_native: 'CDP Native (default)',
  legacy_page_agent: 'Legacy PageAgent (opt-in)',
  vision_fallback: 'Vision Fallback (preview)',
};

/**
 * The resolved engine plus the inputs that produced the decision. Callers can
 * log this so the user always knows why a particular engine was selected.
 */
export interface BrowserEngineResolution {
  /** Effective engine used for the next task. */
  engine: BrowserAutomationEngine;
  /** Engine requested by the caller (if any). */
  requested?: BrowserAutomationEngine;
  /** Whether the legacy escape hatch flag is on. */
  legacyEnabled: boolean;
  /** Whether the vision fallback flag is on. */
  visionEnabled: boolean;
  /** Engine configured in localStorage as the default. */
  defaultEngine: BrowserAutomationEngine;
}
