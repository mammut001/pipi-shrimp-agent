/**
 * Browser feature flags.
 *
 * These are localStorage-backed toggles that gate experimental or risk-bearing
 * behavior without forcing a rebuild. The defaults below intentionally steer
 * the product toward the CDP Native engine — page-agent WebView injection is
 * only re-enabled when the user (or an opt-in flag) explicitly asks for it.
 */

const FALSEY_VALUES = new Set(['0', 'false', 'off', 'disabled']);
const TRUTHY_VALUES = new Set(['1', 'true', 'on', 'enabled']);

export const BROWSER_FEATURE_FLAG_KEYS = {
  foundationV2: 'PIPI_BROWSER_FOUNDATION_V2',
  pageStateV2: 'PIPI_BROWSER_PAGE_STATE_V2',
  actionsV2: 'PIPI_BROWSER_ACTIONS_V2',
  debugPanel: 'PIPI_BROWSER_DEBUG_PANEL',
  /** Default engine when no explicit override is provided. Stored as raw engine value. */
  engineDefault: 'PIPI_BROWSER_ENGINE_DEFAULT',
  /** Enables the legacy PageAgent IIFE injected into the WebView. Off by default. */
  pageAgentLegacy: 'PIPI_BROWSER_PAGE_AGENT_LEGACY',
  /** Enables the future vision/coordinate fallback path. Off until runtime lands. */
  visionFallback: 'PIPI_BROWSER_VISION_FALLBACK',
  /** When true, the embedded surface is not move/resized while the agent is running. */
  lockSurfaceWhileRunning: 'PIPI_BROWSER_LOCK_SURFACE_WHILE_RUNNING',
  /** Interval between live-preview screenshot captures, in milliseconds. */
  livePreviewIntervalMs: 'PIPI_BROWSER_LIVE_PREVIEW_INTERVAL_MS',
  /** When true, the native agent requests a screenshot every step. */
  captureScreenshotEveryStep: 'PIPI_BROWSER_CAPTURE_SCREENSHOT_EVERY_STEP',
  /** Maximum number of steps the native agent will attempt before giving up. */
  maxAgentSteps: 'PIPI_BROWSER_MAX_AGENT_STEPS',
  /** Permission mode for the browser action policy. Stored as raw mode value. */
  actionPermissionMode: 'PIPI_BROWSER_ACTION_PERMISSION_MODE',
} as const;

export type BrowserFeatureFlagName = keyof typeof BROWSER_FEATURE_FLAG_KEYS;

export const DEFAULT_FEATURE_FLAG_VALUES: Record<BrowserFeatureFlagName, string | boolean | number> = {
  foundationV2: true,
  pageStateV2: true,
  actionsV2: true,
  debugPanel: true,
  engineDefault: 'cdp_native',
  pageAgentLegacy: false,
  visionFallback: false,
  lockSurfaceWhileRunning: true,
  livePreviewIntervalMs: 2000,
  captureScreenshotEveryStep: false,
  maxAgentSteps: 30,
  actionPermissionMode: 'auto_safe',
};

const readRawFlag = (flag: BrowserFeatureFlagName): string | null => {
  try {
    return globalThis.localStorage?.getItem(BROWSER_FEATURE_FLAG_KEYS[flag]) ?? null;
  } catch {
    return null;
  }
};

const readBrowserFlag = (flag: BrowserFeatureFlagName, defaultValue = true): boolean => {
  const raw = readRawFlag(flag);
  if (raw == null) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (FALSEY_VALUES.has(normalized)) {
    return false;
  }
  if (TRUTHY_VALUES.has(normalized)) {
    return true;
  }
  // For backwards compatibility with non-boolean defaults (engine strings,
  // numeric intervals) we treat anything unrecognized as "use the default".
  return defaultValue;
};

const readBrowserStringFlag = (
  flag: BrowserFeatureFlagName,
  defaultValue: string,
): string => {
  const raw = readRawFlag(flag);
  if (raw == null || raw.trim() === '') {
    return defaultValue;
  }
  return raw.trim();
};

const readBrowserNumberFlag = (
  flag: BrowserFeatureFlagName,
  defaultValue: number,
): number => {
  const raw = readRawFlag(flag);
  if (raw == null || raw.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return parsed;
};

export const isBrowserFoundationV2Enabled = (): boolean =>
  readBrowserFlag('foundationV2');

export const isBrowserPageStateV2Enabled = (): boolean =>
  readBrowserFlag('pageStateV2');

export const isBrowserActionsV2Enabled = (): boolean =>
  readBrowserFlag('actionsV2');

export const isBrowserDebugPanelEnabled = (): boolean =>
  readBrowserFlag('debugPanel');

export const isBrowserPageAgentLegacyEnabled = (): boolean =>
  readBrowserFlag('pageAgentLegacy', DEFAULT_FEATURE_FLAG_VALUES.pageAgentLegacy as boolean);

export const isBrowserVisionFallbackEnabled = (): boolean =>
  readBrowserFlag('visionFallback', DEFAULT_FEATURE_FLAG_VALUES.visionFallback as boolean);

export const isBrowserLockSurfaceWhileRunningEnabled = (): boolean =>
  readBrowserFlag(
    'lockSurfaceWhileRunning',
    DEFAULT_FEATURE_FLAG_VALUES.lockSurfaceWhileRunning as boolean,
  );

export const isBrowserCaptureScreenshotEveryStepEnabled = (): boolean =>
  readBrowserFlag(
    'captureScreenshotEveryStep',
    DEFAULT_FEATURE_FLAG_VALUES.captureScreenshotEveryStep as boolean,
  );

export const getBrowserLivePreviewIntervalMs = (): number => {
  const defaultInterval = DEFAULT_FEATURE_FLAG_VALUES.livePreviewIntervalMs as number;
  const raw = readBrowserNumberFlag('livePreviewIntervalMs', defaultInterval);
  // Clamp to a safe range so a typo can't deadlock the UI thread.
  return Math.min(60_000, Math.max(250, Math.trunc(raw)));
};

export const getBrowserMaxAgentSteps = (): number => {
  const defaultSteps = DEFAULT_FEATURE_FLAG_VALUES.maxAgentSteps as number;
  const raw = readBrowserNumberFlag('maxAgentSteps', defaultSteps);
  return Math.min(100, Math.max(1, Math.trunc(raw)));
};

const ALLOWED_ENGINES = new Set(['cdp_native', 'legacy_page_agent', 'vision_fallback']);

export const getBrowserEngineDefault = (): string =>
  readBrowserStringFlag('engineDefault', DEFAULT_FEATURE_FLAG_VALUES.engineDefault as string);

export const isValidBrowserEngine = (value: string): value is
  | 'cdp_native'
  | 'legacy_page_agent'
  | 'vision_fallback' => ALLOWED_ENGINES.has(value);

const ALLOWED_PERMISSION_MODES = new Set(['observe_only', 'ask_each_action', 'auto_safe']);

export const getBrowserActionPermissionMode = (): string =>
  readBrowserStringFlag(
    'actionPermissionMode',
    DEFAULT_FEATURE_FLAG_VALUES.actionPermissionMode as string,
  );

export const isValidBrowserActionPermissionMode = (
  value: string,
): value is 'observe_only' | 'ask_each_action' | 'auto_safe' =>
  ALLOWED_PERMISSION_MODES.has(value);

export const writeBrowserFlag = (flag: BrowserFeatureFlagName, value: string | number | boolean) => {
  try {
    globalThis.localStorage?.setItem(BROWSER_FEATURE_FLAG_KEYS[flag], String(value));
  } catch {
    // Ignore — localStorage may be unavailable in private windows.
  }
};
