/**
 * BrowserWorkspacePane - Browser workspace in expanded/split mode
 *
 * This component provides a browser workspace surface in the main content area.
 * It wraps BrowserSurfaceHost which provides the actual browser chrome (toolbar + surface).
 * Controls like Current Task and Logs are in the right AgentPanel.
 */

import { useBrowserAgentStore, useBrowserObservabilityStore } from '@/store';
import { BrowserFailureRecovery } from './BrowserFailureRecovery';
import { BrowserSurfaceHost } from './BrowserSurfaceHost';

/**
 * BrowserWorkspacePane component
 */
export function BrowserWorkspacePane() {
  const hasFailureSnapshot = useBrowserObservabilityStore((state) => Boolean(state.activeFailureSnapshot));

  return (
    <div className="flex flex-col h-full">
      {hasFailureSnapshot && (
        <div className="p-3 border-b border-gray-200 bg-white">
          <BrowserFailureRecovery />
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <BrowserSurfaceHost onCollapse={() => {
          useBrowserAgentStore.getState().collapseBrowser();
        }} />
      </div>
    </div>
  );
}

export default BrowserWorkspacePane;
