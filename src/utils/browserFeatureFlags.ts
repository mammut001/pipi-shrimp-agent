const FALSEY_VALUES = new Set(['0', 'false', 'off', 'disabled']);

export const BROWSER_FEATURE_FLAG_KEYS = {
  foundationV2: 'PIPI_BROWSER_FOUNDATION_V2',
  pageStateV2: 'PIPI_BROWSER_PAGE_STATE_V2',
  actionsV2: 'PIPI_BROWSER_ACTIONS_V2',
  debugPanel: 'PIPI_BROWSER_DEBUG_PANEL',
} as const;

type BrowserFeatureFlagName = keyof typeof BROWSER_FEATURE_FLAG_KEYS;

const readBrowserFlag = (flag: BrowserFeatureFlagName, defaultValue = true): boolean => {
  try {
    const raw = globalThis.localStorage?.getItem(BROWSER_FEATURE_FLAG_KEYS[flag]);
    if (raw == null) {
      return defaultValue;
    }
    return !FALSEY_VALUES.has(raw.trim().toLowerCase());
  } catch {
    return defaultValue;
  }
};

export const isBrowserFoundationV2Enabled = (): boolean => readBrowserFlag('foundationV2');

export const isBrowserPageStateV2Enabled = (): boolean => readBrowserFlag('pageStateV2');

export const isBrowserActionsV2Enabled = (): boolean => readBrowserFlag('actionsV2');

export const isBrowserDebugPanelEnabled = (): boolean => readBrowserFlag('debugPanel');