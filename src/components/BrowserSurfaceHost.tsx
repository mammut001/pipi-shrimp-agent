/**
 * BrowserSurfaceHost - Expanded browser workspace content
 *
 * Renders either the legacy embedded WebView viewport or the CDP external
 * Chrome status panel depending on the active browser runtime.
 */

import { BrowserAgentBusyOverlay } from './BrowserAgentBusyOverlay';
import { BrowserSurfaceViewport } from './BrowserSurfaceViewport';
import { CdpBrowserSurfacePanel } from './CdpBrowserSurfacePanel';
import { useBrowserInputBlocked, useBrowserMarqueeActive } from '@/hooks/useBrowserMarqueeActive';
import { useBrowserSurfaceKind } from '@/hooks/useBrowserSurfaceKind';
import { t } from '@/i18n';

interface BrowserSurfaceHostProps {
  /** Callback when user clicks collapse to return to mini mode */
  onCollapse?: () => void;
}

export function BrowserSurfaceHost(_props: BrowserSurfaceHostProps) {
  const surfaceKind = useBrowserSurfaceKind();
  const showMarquee = useBrowserMarqueeActive();
  const blockInput = useBrowserInputBlocked();

  return (
    <div className={`h-full w-full relative bg-white${showMarquee ? ' agent-running-border' : ''}`}>
      {surfaceKind === 'embedded_webview' ? (
        <BrowserSurfaceViewport
          mode="expanded"
          className="absolute inset-0"
          emptyState={
            <div className="flex items-center justify-center h-full text-gray-400">
              <span>{t('browser.noBrowserSurface')}</span>
            </div>
          }
        />
      ) : surfaceKind === 'cdp_external' ? (
        <CdpBrowserSurfacePanel variant="expanded" className="absolute inset-0 overflow-auto" />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
          <span>{t('browser.surface.noEmbeddedSurface')}</span>
        </div>
      )}
      {blockInput && surfaceKind === 'embedded_webview' && <BrowserAgentBusyOverlay />}
    </div>
  );
}

export default BrowserSurfaceHost;