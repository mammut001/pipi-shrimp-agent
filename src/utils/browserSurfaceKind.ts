import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useCdpStore } from '@/store/cdpStore';
import { isCdpRuntimeActive, type CdpRuntimeSnapshot } from '@/store/cdpRuntime';
import type { BrowserPresentationMode } from '@/types/browser';
import type { CdpStatus } from '@/store/browser/browserConnection';

export type BrowserSurfaceKind =
  | 'embedded_webview'
  | 'cdp_external'
  | 'none';

export interface BrowserSurfaceSnapshot {
  cdpStatus: CdpStatus;
  cdpRuntime: CdpRuntimeSnapshot;
  pendingTaskExecutionMode?: string | null;
  isWindowOpen: boolean;
  presentationMode: BrowserPresentationMode;
}

export function readBrowserSurfaceSnapshot(): BrowserSurfaceSnapshot {
  const cdp = useCdpStore.getState();
  const browser = useBrowserAgentStore.getState();

  return {
    cdpStatus: cdp.status,
    cdpRuntime: cdp.runtime,
    pendingTaskExecutionMode: browser.pendingTask?.executionMode ?? null,
    isWindowOpen: browser.isWindowOpen,
    presentationMode: browser.presentationMode,
  };
}

/** True when the active session is driven by external Chrome via CDP. */
export function isCdpBackedSession(snapshot: BrowserSurfaceSnapshot): boolean {
  return snapshot.cdpStatus === 'connected'
    || snapshot.cdpStatus === 'connecting'
    || snapshot.pendingTaskExecutionMode === 'cdp'
    || isCdpRuntimeActive(snapshot.cdpRuntime);
}

/**
 * Decide which surface renderer to show in mini / expanded browser panes.
 *
 * CDP Native takes precedence over the legacy embedded WebView flag so
 * `isWindowOpen` is not treated as proof of an embedded surface while CDP
 * is connected.
 */
export function resolveBrowserSurfaceKind(
  snapshot: BrowserSurfaceSnapshot = readBrowserSurfaceSnapshot(),
): BrowserSurfaceKind {
  if (isCdpBackedSession(snapshot)) {
    return 'cdp_external';
  }

  if (snapshot.isWindowOpen && snapshot.presentationMode !== 'hidden') {
    return 'embedded_webview';
  }

  return 'none';
}

export function getBrowserExpandLabelKey(
  surfaceKind: BrowserSurfaceKind,
  isExpanded: boolean,
): 'browser.collapseToMini' | 'browser.surface.expandConsole' | 'browser.expandToSplit' {
  if (isExpanded) {
    return 'browser.collapseToMini';
  }
  if (surfaceKind === 'cdp_external') {
    return 'browser.surface.expandConsole';
  }
  return 'browser.expandToSplit';
}

export function getBrowserOpenWindowLabelKey(
  surfaceKind: BrowserSurfaceKind,
): 'browser.surface.openExternalChrome' | 'browser.openNewWindow' {
  if (surfaceKind === 'cdp_external') {
    return 'browser.surface.openExternalChrome';
  }
  return 'browser.openNewWindow';
}