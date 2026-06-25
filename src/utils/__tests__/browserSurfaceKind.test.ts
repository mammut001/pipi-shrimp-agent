import { describe, expect, it } from '@jest/globals';
import {
  getBrowserExpandLabelKey,
  getBrowserOpenWindowLabelKey,
  isCdpBackedSession,
  resolveBrowserSurfaceKind,
  type BrowserSurfaceSnapshot,
} from '../browserSurfaceKind';

const baseSnapshot = (): BrowserSurfaceSnapshot => ({
  cdpStatus: 'disconnected',
  pendingTaskExecutionMode: null,
  isWindowOpen: false,
  presentationMode: 'mini',
});

describe('browserSurfaceKind', () => {
  it('prefers cdp_external when CDP is connected even if isWindowOpen is true', () => {
    const snapshot: BrowserSurfaceSnapshot = {
      ...baseSnapshot(),
      cdpStatus: 'connected',
      isWindowOpen: true,
    };

    expect(resolveBrowserSurfaceKind(snapshot)).toBe('cdp_external');
  });

  it('uses embedded_webview when legacy window is open without CDP', () => {
    const snapshot: BrowserSurfaceSnapshot = {
      ...baseSnapshot(),
      isWindowOpen: true,
      presentationMode: 'expanded',
    };

    expect(resolveBrowserSurfaceKind(snapshot)).toBe('embedded_webview');
  });

  it('treats pending cdp tasks as cdp_external', () => {
    const snapshot: BrowserSurfaceSnapshot = {
      ...baseSnapshot(),
      pendingTaskExecutionMode: 'cdp',
    };

    expect(isCdpBackedSession(snapshot)).toBe(true);
    expect(resolveBrowserSurfaceKind(snapshot)).toBe('cdp_external');
  });

  it('returns none when neither CDP nor embedded surface is active', () => {
    expect(resolveBrowserSurfaceKind(baseSnapshot())).toBe('none');
  });

  it('uses context-aware expand and open labels', () => {
    expect(getBrowserExpandLabelKey('cdp_external', false)).toBe('browser.surface.expandConsole');
    expect(getBrowserExpandLabelKey('embedded_webview', false)).toBe('browser.expandToSplit');
    expect(getBrowserExpandLabelKey('cdp_external', true)).toBe('browser.collapseToMini');
    expect(getBrowserOpenWindowLabelKey('cdp_external')).toBe('browser.surface.openExternalChrome');
    expect(getBrowserOpenWindowLabelKey('embedded_webview')).toBe('browser.openNewWindow');
  });
});