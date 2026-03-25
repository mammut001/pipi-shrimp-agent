/**
 * BrowserWorkspacePane - Browser workspace in expanded/split mode
 *
 * This component provides a browser workspace surface in the main content area.
 * It wraps BrowserSurfaceHost which provides the actual browser chrome (toolbar + surface).
 * Controls like Current Task and Logs are in the right AgentPanel.
 */

import { useBrowserAgentStore } from '@/store';
import { BrowserSurfaceHost } from './BrowserSurfaceHost';

/**
 * BrowserWorkspacePane component
 */
export function BrowserWorkspacePane() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        <BrowserSurfaceHost onCollapse={() => {
          useBrowserAgentStore.getState().collapseBrowser();
        }} />
      </div>
    </div>
  );
}

export default BrowserWorkspacePane;
