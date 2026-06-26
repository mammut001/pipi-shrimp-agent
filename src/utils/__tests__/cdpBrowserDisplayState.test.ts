import { describe, expect, it } from '@jest/globals';

import { INITIAL_CDP_RUNTIME } from '@/store/cdpRuntime';
import { resolveCdpBrowserDisplayState } from '../cdpBrowserDisplayState';
import type { BrowserConnectionStatePayload } from '@/store/browser/browserConnection';

const connectionState = (overrides: Partial<BrowserConnectionStatePayload> = {}): BrowserConnectionStatePayload => ({
  connected: true,
  launch_mode: 'attach',
  health_status: 'healthy',
  health_failures: 0,
  health_last_transition_at_ms: 0,
  websocket_url: 'ws://localhost:9222/devtools/page/1',
  current_url: null,
  last_error: null,
  target_id: 'target-1',
  session_id: 'session-1',
  last_activity_at_ms: 0,
  idle_timeout_ms: 300000,
  ...overrides,
});

describe('cdpBrowserDisplayState', () => {
  it('uses the observed CDP URL before legacy browserAgent currentUrl', () => {
    const display = resolveCdpBrowserDisplayState({
      cdpStatus: 'connected',
      connectionState: connectionState({ current_url: 'https://chrome.example/current' }),
      cdpRuntime: { ...INITIAL_CDP_RUNTIME },
      latestPageState: null,
      pendingTask: null,
      browserCurrentUrl: 'https://legacy.example/old',
      browserStatus: 'idle',
    });

    expect(display.displayUrl).toBe('https://chrome.example/current');
    expect(display.hasObservedPage).toBe(true);
    expect(display.titleKey).toBe('browser.surface.readyTitle');
  });

  it('does not claim a page is open when CDP is connected without an observed URL', () => {
    const display = resolveCdpBrowserDisplayState({
      cdpStatus: 'connected',
      connectionState: connectionState(),
      cdpRuntime: { ...INITIAL_CDP_RUNTIME },
      latestPageState: null,
      pendingTask: null,
      browserCurrentUrl: '',
      browserStatus: 'uninitialized',
    });

    expect(display.displayUrl).toBe('');
    expect(display.hasObservedPage).toBe(false);
    expect(display.hasRunnableTarget).toBe(false);
    expect(display.titleKey).toBe('browser.surface.noChromePageTitle');
    expect(display.descriptionKey).toBe('browser.surface.noChromePageDescription');
  });

  it('uses a pending CDP target URL as runnable context without treating it as observed', () => {
    const display = resolveCdpBrowserDisplayState({
      cdpStatus: 'connected',
      connectionState: connectionState(),
      cdpRuntime: { ...INITIAL_CDP_RUNTIME },
      latestPageState: null,
      pendingTask: {
        id: 'task-1',
        connectorType: 'browser_web',
        siteProfileId: 'default',
        targetUrl: 'https://target.example',
        userIntent: 'Read the page',
        executionPrompt: 'Read the page',
        requiresLogin: false,
        authPolicy: 'none',
        executionMode: 'cdp',
        allowedControlMode: 'agent_controlled',
      },
      browserCurrentUrl: '',
      browserStatus: 'idle',
    });

    expect(display.displayUrl).toBe('https://target.example');
    expect(display.hasObservedPage).toBe(false);
    expect(display.hasRunnableTarget).toBe(true);
    expect(display.titleKey).toBe('browser.surface.targetReadyTitle');
  });

  it('failure_banner_and_cdp_panel_are_consistent_for_navigate_timeout', () => {
    const display = resolveCdpBrowserDisplayState({
      cdpStatus: 'connected',
      connectionState: connectionState({ current_url: 'https://example.com/partial' }),
      cdpRuntime: {
        ...INITIAL_CDP_RUNTIME,
        taskStatus: 'failed',
        lastError: 'Request timed out',
        lastFailedAction: 'navigate',
        currentUrl: 'https://example.com/partial',
        lastUpdatedAt: Date.now(),
      },
      latestPageState: null,
      pendingTask: null,
      browserCurrentUrl: '',
      browserStatus: 'error',
      activeFailureSnapshot: {
        taskId: 'task-1',
        failedAction: 'navigate',
        url: 'https://example.com/partial',
        title: 'Example',
        errorKind: 'timeout',
        errorMessage: 'Request timed out',
        screenshotPath: null,
        ts: Date.now(),
      },
    });

    expect(display.titleKey).toBe('browser.surface.cdpTaskFailed');
    expect(display.lastError).toBe('Request timed out');
    expect(display.lastFailedAction).toBe('navigate');
    expect(display.displayUrl).toBe('https://example.com/partial');
  });
});
