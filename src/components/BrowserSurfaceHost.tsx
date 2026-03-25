/**
 * BrowserSurfaceHost - Expanded live browser surface (full-screen)
 *
 * This component renders the browser surface taking the full available area.
 * All controls (URL, status, collapse, window, task, logs) are in the right
 * AgentPanel's browser tab — this component is purely the viewport.
 */

import { BrowserSurfaceViewport } from './BrowserSurfaceViewport';

interface BrowserSurfaceHostProps {
  /** Callback when user clicks collapse to return to mini mode */
  onCollapse?: () => void;
}

/**
 * BrowserSurfaceHost - Full-screen browser viewport for expanded mode
 */
export function BrowserSurfaceHost(_props: BrowserSurfaceHostProps) {
  return (
    <div className="h-full w-full relative bg-white">
      <BrowserSurfaceViewport
        mode="expanded"
        className="absolute inset-0"
        emptyState={
          <div className="flex items-center justify-center h-full text-gray-400">
            <span>No browser surface yet</span>
          </div>
        }
      />
    </div>
  );
}

export default BrowserSurfaceHost;
