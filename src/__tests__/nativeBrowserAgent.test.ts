jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('../utils/browserSessionClient', () => ({
  connectBrowserSession: jest.fn().mockResolvedValue('connected'),
  navigateBrowserPage: jest.fn().mockResolvedValue('navigated'),
  resyncBrowserPage: jest.fn().mockResolvedValue('resynced'),
}));

jest.mock('../utils/browserActionClient', () => ({
  clickBrowserElement: jest.fn().mockResolvedValue('clicked'),
  executeBrowserScript: jest.fn().mockResolvedValue('ok'),
  pressBrowserKey: jest.fn().mockResolvedValue('pressed'),
  scrollBrowser: jest.fn().mockResolvedValue('scrolled'),
  typeIntoBrowserElement: jest.fn().mockResolvedValue('typed'),
  waitForBrowser: jest.fn().mockResolvedValue('waited'),
}));

jest.mock('../utils/browserPageStateClient', () => ({
  getBrowserPageState: jest.fn(),
  getBrowserSemanticTree: jest.fn().mockResolvedValue('[]'),
  getBrowserText: jest.fn().mockResolvedValue('body text'),
  getCurrentBrowserUrl: jest.fn().mockResolvedValue('https://example.com/login'),
}));

jest.mock('../utils/browserFeatureFlags', () => ({
  isBrowserActionsV2Enabled: jest.fn(() => true),
  isBrowserPageStateV2Enabled: jest.fn(() => true),
  isBrowserPageAgentLegacyEnabled: jest.fn(() => false),
  isBrowserVisionFallbackEnabled: jest.fn(() => false),
  getBrowserEngineDefault: jest.fn(() => 'cdp_native'),
  getBrowserMaxAgentSteps: jest.fn(() => 30),
  getBrowserLivePreviewIntervalMs: jest.fn(() => 2000),
  getBrowserActionPermissionMode: jest.fn(() => 'auto_safe'),
  isValidBrowserEngine: jest.fn(() => true),
  isValidBrowserActionPermissionMode: jest.fn(() => true),
  BROWSER_FEATURE_FLAG_KEYS: {
    foundationV2: 'PIPI_BROWSER_FOUNDATION_V2',
    pageStateV2: 'PIPI_BROWSER_PAGE_STATE_V2',
    actionsV2: 'PIPI_BROWSER_ACTIONS_V2',
    debugPanel: 'PIPI_BROWSER_DEBUG_PANEL',
    engineDefault: 'PIPI_BROWSER_ENGINE_DEFAULT',
    pageAgentLegacy: 'PIPI_BROWSER_PAGE_AGENT_LEGACY',
    visionFallback: 'PIPI_BROWSER_VISION_FALLBACK',
    lockSurfaceWhileRunning: 'PIPI_BROWSER_LOCK_SURFACE_WHILE_RUNNING',
    livePreviewIntervalMs: 'PIPI_BROWSER_LIVE_PREVIEW_INTERVAL_MS',
    captureScreenshotEveryStep: 'PIPI_BROWSER_CAPTURE_SCREENSHOT_EVERY_STEP',
    maxAgentSteps: 'PIPI_BROWSER_MAX_AGENT_STEPS',
    actionPermissionMode: 'PIPI_BROWSER_ACTION_PERMISSION_MODE',
  },
}));

import { invoke } from '@tauri-apps/api/core';

import type { BrowserPageState } from '@/types/browserPageState';
import { clickBrowserElement } from '@/utils/browserActionClient';
import { executeNativeBrowserTask } from '@/utils/nativeBrowserAgent';
import { getBrowserPageState, getBrowserSemanticTree } from '@/utils/browserPageStateClient';
import { isBrowserActionsV2Enabled, isBrowserPageStateV2Enabled } from '@/utils/browserFeatureFlags';

const invokeMock = invoke as jest.MockedFunction<typeof invoke>;
const clickBrowserElementMock = clickBrowserElement as jest.MockedFunction<typeof clickBrowserElement>;
const getBrowserPageStateMock = getBrowserPageState as jest.MockedFunction<typeof getBrowserPageState>;
const getBrowserSemanticTreeMock = getBrowserSemanticTree as jest.MockedFunction<typeof getBrowserSemanticTree>;
const actionsFlagMock = isBrowserActionsV2Enabled as jest.MockedFunction<typeof isBrowserActionsV2Enabled>;
const pageStateFlagMock = isBrowserPageStateV2Enabled as jest.MockedFunction<typeof isBrowserPageStateV2Enabled>;

const livePageState: BrowserPageState = {
  url: 'https://example.com/login',
  title: 'Example Login',
  navigation_id: 'nav-1',
  frame_count: 1,
  warnings: [],
  screenshot: null,
  elements: [
    {
      index: 7,
      backend_node_id: 88,
      frame_id: 'root',
      role: 'button',
      name: 'Continue',
      tag_name: 'button',
      bounds: null,
      is_visible: true,
      is_clickable: true,
      is_editable: false,
      selector_hint: 'button[type="submit"]',
      text_hint: null,
      href: null,
      input_type: null,
    },
  ],
};

describe('nativeBrowserAgent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    invokeMock.mockReset();
    clickBrowserElementMock.mockClear();
    getBrowserPageStateMock.mockReset();
    getBrowserSemanticTreeMock.mockClear();
    actionsFlagMock.mockReturnValue(true);
    pageStateFlagMock.mockReturnValue(true);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('feeds PageState to the model and upgrades legacy ids to backend_node_id', async () => {
    getBrowserPageStateMock.mockResolvedValue(livePageState);
    invokeMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          thought: 'The continue button is visible.',
          action: { click_element: { id: 7 } },
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          thought: 'The click completed.',
          action: { done: { text: 'Finished', success: true } },
        }),
      });

    const resultPromise = executeNativeBrowserTask('Continue to dashboard', 'api-key', 'model', {
      approveAction: () => Promise.resolve(true),
    });
    await jest.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe('Finished');
    expect(clickBrowserElementMock).toHaveBeenCalledWith({
      elementId: 7,
      backendNodeId: 88,
      navigationId: 'nav-1',
    });

    const firstInvokeArgs = invokeMock.mock.calls[0]?.[1] as { messages: Array<{ content: string }>; systemPrompt: string };
    expect(firstInvokeArgs.systemPrompt).toContain('backend_node_id');
    expect(firstInvokeArgs.messages[0]?.content).toContain('CURRENT URL');
    expect(firstInvokeArgs.messages[0]?.content).toContain('backend_node_id=88');
  });

  it('falls back to semantic tree mode when the PageState rollout flags are disabled', async () => {
    actionsFlagMock.mockReturnValue(false);
    pageStateFlagMock.mockReturnValue(false);
    getBrowserSemanticTreeMock.mockResolvedValue('[{"id":1,"role":"button","text":"Continue"}]');
    invokeMock.mockResolvedValueOnce({
      content: JSON.stringify({
        thought: 'Nothing else is needed.',
        action: { done: { text: 'Fallback complete', success: true } },
      }),
    });

    const resultPromise = executeNativeBrowserTask('Just inspect the page', 'api-key', 'model', {});
    await jest.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe('Fallback complete');
    expect(getBrowserPageStateMock).not.toHaveBeenCalled();

    const firstInvokeArgs = invokeMock.mock.calls[0]?.[1] as { messages: Array<{ content: string }> };
    expect(firstInvokeArgs.messages[0]?.content).toContain('CURRENT URL');
  });
});