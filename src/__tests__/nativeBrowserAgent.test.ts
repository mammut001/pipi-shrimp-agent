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
    executeBrowserScript: jest.fn(async () => 'ok'),
  pressBrowserKey: jest.fn(async () => 'pressed'),
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
import {
  clickBrowserElement,
  executeBrowserScript,
  pressBrowserKey,
  typeIntoBrowserElement,
} from '@/utils/browserActionClient';
import { navigateBrowserPage } from '@/utils/browserSessionClient';
import { executeNativeBrowserTask } from '@/utils/nativeBrowserAgent';
import { getBrowserPageState, getBrowserSemanticTree } from '@/utils/browserPageStateClient';
import { isBrowserActionsV2Enabled, isBrowserPageStateV2Enabled } from '@/utils/browserFeatureFlags';

const invokeMock = invoke as jest.MockedFunction<typeof invoke>;
const clickBrowserElementMock = clickBrowserElement as jest.MockedFunction<typeof clickBrowserElement>;
const executeBrowserScriptMock = executeBrowserScript as jest.MockedFunction<typeof executeBrowserScript>;
const pressBrowserKeyMock = pressBrowserKey as jest.MockedFunction<typeof pressBrowserKey>;

const countOverlayScriptCalls = (): { inject: number; remove: number } => {
  const scripts = executeBrowserScriptMock.mock.calls.map(([script]) => String(script));
  return {
    inject: scripts.filter((script) => script.includes('__ppa_overlay__') && script.includes('appendChild')).length,
    remove: scripts.filter((script) => script.includes('__ppa_overlay__') && script.includes('remove')).length,
  };
};
const typeIntoBrowserElementMock = typeIntoBrowserElement as jest.MockedFunction<typeof typeIntoBrowserElement>;
const navigateBrowserPageMock = navigateBrowserPage as jest.MockedFunction<typeof navigateBrowserPage>;
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
    executeBrowserScriptMock.mockClear();
    pressBrowserKeyMock.mockClear();
    typeIntoBrowserElementMock.mockClear();
    navigateBrowserPageMock.mockClear();
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

  describe('selector targeting (R3-09)', () => {
    it('click_with_selector_uses_resolved_element', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Use selector fallback.',
            action: { click_element: { selector: 'button[type="submit"]' } },
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Done.',
            action: { done: { text: 'Clicked', success: true } },
          }),
        });

      const resultPromise = executeNativeBrowserTask('Submit form', 'api-key', 'model', {
        approveAction: () => Promise.resolve(true),
      });
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('Clicked');
      expect(clickBrowserElementMock).toHaveBeenCalledWith({
        elementId: 7,
        backendNodeId: 88,
        navigationId: 'nav-1',
      });
    });

    it('invalid_selector_returns_safe_failure_feedback', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Try unknown selector.',
            action: { click_element: { selector: '#missing-node' } },
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Give up.',
            action: { done: { text: 'Could not click', success: false } },
          }),
        });

      const resultPromise = executeNativeBrowserTask('Click missing', 'api-key', 'model', {});
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('Could not click');
      expect(clickBrowserElementMock).not.toHaveBeenCalled();
    });
  });

  describe('press_enter wiring (R3-10)', () => {
    it('input_text_press_enter_calls_pressBrowserKey', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Type and submit.',
            action: { input_text: { id: 7, text: 'query', press_enter: true } },
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Submitted.',
            action: { done: { text: 'Submitted', success: true } },
          }),
        });

      const resultPromise = executeNativeBrowserTask('Search', 'api-key', 'model', {
        approveAction: () => Promise.resolve(true),
      });
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('Submitted');
      expect(typeIntoBrowserElementMock).toHaveBeenCalled();
      expect(pressBrowserKeyMock).toHaveBeenCalledWith('Enter');
    });
  });

  describe('overlay cleanup (R3-07)', () => {
    it('removes_overlay_after_successful_done', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock.mockResolvedValueOnce({
        content: JSON.stringify({
          thought: 'Done.',
          action: { done: { text: 'All good', success: true } },
        }),
      });

      const resultPromise = executeNativeBrowserTask('Finish task', 'api-key', 'model', {});
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('All good');
      const overlayCalls = countOverlayScriptCalls();
      expect(overlayCalls.inject).toBeGreaterThanOrEqual(1);
      expect(overlayCalls.remove).toBeGreaterThanOrEqual(1);
    });

    it('removes_overlay_when_llm_call_fails', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock.mockImplementation((command: string) => {
        if (command === 'send_claude_sdk_chat') {
          return Promise.reject(new Error('LLM unavailable'));
        }
        return Promise.resolve('ok');
      });

      const resultPromise = executeNativeBrowserTask('Fail task', 'api-key', 'model', {});
      const assertion = expect(resultPromise).rejects.toThrow('LLM unavailable');
      await jest.runAllTimersAsync();
      await assertion;
      const overlayCalls = countOverlayScriptCalls();
      expect(overlayCalls.inject).toBeGreaterThanOrEqual(1);
      expect(overlayCalls.remove).toBeGreaterThanOrEqual(1);
    });

    it('removes_overlay_on_stop_without_duplicate_errors', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      let resolveLlm!: (value: { content: string }) => void;
      const llmPromise = new Promise<{ content: string }>((resolve) => {
        resolveLlm = resolve;
      });
      invokeMock.mockImplementation((command: string) => {
        if (command === 'send_claude_sdk_chat') {
          return llmPromise;
        }
        return Promise.resolve('ok');
      });

      const controller = new AbortController();
      const resultPromise = executeNativeBrowserTask('Hold task open', 'api-key', 'model', {
        signal: controller.signal,
      });
      const assertion = expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });

      await jest.advanceTimersByTimeAsync(1200);
      controller.abort();
      resolveLlm({
        content: JSON.stringify({
          thought: 'Too late.',
          action: { done: { text: 'Nope', success: true } },
        }),
      });
      await jest.runAllTimersAsync();
      await assertion;

      const overlayCalls = countOverlayScriptCalls();
      expect(overlayCalls.remove).toBeGreaterThanOrEqual(1);
      expect(() => countOverlayScriptCalls()).not.toThrow();
    });
  });

  describe('observe_only mode (R3-02)', () => {
    it('observe_only_blocks_click', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Try clicking continue.',
            action: { click_element: { id: 7 } },
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Observe-only blocked the click.',
            action: { done: { text: 'Blocked click', success: false } },
          }),
        });

      const resultPromise = executeNativeBrowserTask('Inspect page', 'api-key', 'model', {
        permissionMode: 'observe_only',
      });
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('Blocked click');
      expect(clickBrowserElementMock).not.toHaveBeenCalled();
      const llmCalls = invokeMock.mock.calls.filter(([command]) => command === 'send_claude_sdk_chat');
      const blockedFeedback = llmCalls
        .flatMap((call) => (call[1] as { messages: Array<{ role?: string; content: string }> }).messages)
        .filter((message) => message.role === 'user')
        .map((message) => message.content);
      expect(blockedFeedback.some((content) => content.includes('Observe-only mode is enabled'))).toBe(true);
    });

    it('observe_only_blocks_input_text', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Try typing.',
            action: { input_text: { id: 7, text: 'secret' } },
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Observe-only blocked typing.',
            action: { done: { text: 'Blocked input', success: false } },
          }),
        });

      const resultPromise = executeNativeBrowserTask('Inspect page', 'api-key', 'model', {
        permissionMode: 'observe_only',
      });
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('Blocked input');
      expect(typeIntoBrowserElementMock).not.toHaveBeenCalled();
    });

    it('observe_only_blocks_navigation', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Try navigating away.',
            action: { navigate: { url: 'https://other.example' } },
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            thought: 'Observe-only blocked navigation.',
            action: { done: { text: 'Blocked navigate', success: false } },
          }),
        });

      const resultPromise = executeNativeBrowserTask('Inspect page', 'api-key', 'model', {
        permissionMode: 'observe_only',
      });
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('Blocked navigate');
      expect(navigateBrowserPageMock).toHaveBeenCalledTimes(1);
      expect(navigateBrowserPageMock).toHaveBeenCalledWith('https://www.google.com');
      expect(navigateBrowserPageMock).not.toHaveBeenCalledWith('https://other.example');
    });

    it('observe_only_allows_done_without_mutating_actions', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock.mockResolvedValueOnce({
        content: JSON.stringify({
          thought: 'Only inspect.',
          action: { done: { text: 'Observed only', success: true } },
        }),
      });

      const resultPromise = executeNativeBrowserTask('Inspect page', 'api-key', 'model', {
        permissionMode: 'observe_only',
      });
      await jest.runAllTimersAsync();

      await expect(resultPromise).resolves.toBe('Observed only');
      expect(clickBrowserElementMock).not.toHaveBeenCalled();
    });
  });

  describe('stopTask cancellation (R3-05)', () => {
    it('stopTask_prevents_next_cdp_action', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      invokeMock.mockResolvedValueOnce({
        content: JSON.stringify({
          thought: 'Click continue.',
          action: { click_element: { id: 7 } },
        }),
      });

      const controller = new AbortController();
      const resultPromise = executeNativeBrowserTask('Continue to dashboard', 'api-key', 'model', {
        signal: controller.signal,
        approveAction: () => Promise.resolve(true),
      });
      const assertion = expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });

      await jest.advanceTimersByTimeAsync(1200);
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      await jest.runAllTimersAsync();

      await assertion;
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(clickBrowserElementMock).toHaveBeenCalledTimes(1);
    });

    it('stopTask_ignores_late_cdp_result', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      let resolveLlm!: (value: { content: string }) => void;
      const llmPromise = new Promise<{ content: string }>((resolve) => {
        resolveLlm = resolve;
      });
      invokeMock.mockImplementationOnce(() => llmPromise);

      const controller = new AbortController();
      const resultPromise = executeNativeBrowserTask('Continue to dashboard', 'api-key', 'model', {
        signal: controller.signal,
        approveAction: () => Promise.resolve(true),
      });
      const assertion = expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });

      await jest.advanceTimersByTimeAsync(1200);
      controller.abort();
      resolveLlm({
        content: JSON.stringify({
          thought: 'Late success.',
          action: { done: { text: 'Late success', success: true } },
        }),
      });
      await jest.runAllTimersAsync();

      await assertion;
      expect(clickBrowserElementMock).not.toHaveBeenCalled();
    });

    it('stopTask_prevents_completed_status_after_stop', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      let resolveLlm!: (value: { content: string }) => void;
      const llmPromise = new Promise<{ content: string }>((resolve) => {
        resolveLlm = resolve;
      });
      invokeMock.mockImplementationOnce(() => llmPromise);

      const onRunSummary = jest.fn();
      const controller = new AbortController();
      const resultPromise = executeNativeBrowserTask('Continue to dashboard', 'api-key', 'model', {
        signal: controller.signal,
        onRunSummary,
      });
      const assertion = expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });

      await jest.advanceTimersByTimeAsync(1200);
      controller.abort();
      resolveLlm({
        content: JSON.stringify({
          thought: 'Late success.',
          action: { done: { text: 'Should not complete', success: true } },
        }),
      });
      await jest.runAllTimersAsync();

      await assertion;
      expect(onRunSummary).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'aborted' }));
    });

    it('stopTask_prevents_artifact_or_screenshot_write_after_stop', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      const controller = new AbortController();
      invokeMock.mockImplementation(async (command: string) => {
        if (command === 'browser_screenshot') {
          return 'data:image/png;base64,fake';
        }
        return {
          content: JSON.stringify({
            thought: 'Click continue.',
            action: { click_element: { id: 7 } },
          }),
        };
      });

      const resultPromise = executeNativeBrowserTask('Continue to dashboard', 'api-key', 'model', {
        signal: controller.signal,
        captureScreenshotEveryStep: true,
        approveAction: () => Promise.resolve(true),
      });
      const assertion = expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });

      await jest.advanceTimersByTimeAsync(1200);
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      await jest.runAllTimersAsync();

      await assertion;
      expect(invokeMock.mock.calls.filter(([command]) => command === 'browser_screenshot')).toHaveLength(1);
      expect(invokeMock.mock.calls.filter(([command]) => command === 'send_claude_sdk_chat')).toHaveLength(1);
    });

    it('signal_is_aborted_on_stop', async () => {
      getBrowserPageStateMock.mockResolvedValue(livePageState);
      let resolveLlm!: (value: { content: string }) => void;
      const llmPromise = new Promise<{ content: string }>((resolve) => {
        resolveLlm = resolve;
      });
      invokeMock.mockImplementationOnce(() => llmPromise);

      const controller = new AbortController();
      const resultPromise = executeNativeBrowserTask('Hold task open', 'api-key', 'model', {
        signal: controller.signal,
      });
      const assertion = expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });

      await jest.advanceTimersByTimeAsync(1200);
      expect(controller.signal.aborted).toBe(false);
      controller.abort();
      expect(controller.signal.aborted).toBe(true);
      resolveLlm({
        content: JSON.stringify({
          thought: 'Too late.',
          action: { done: { text: 'Nope', success: true } },
        }),
      });
      await jest.runAllTimersAsync();
      await assertion;
    });
  });
});