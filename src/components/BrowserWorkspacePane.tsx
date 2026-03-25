/**
 * BrowserWorkspacePane - Browser workspace in split mode
 *
 * This component provides a browser workspace surface in split layout mode.
 * It shows browser status, controls, and preview content.
 * See browser-docked-layout-design.md for design details.
 *
 * V1: This is a preview/shell representation, not a true embedded browser.
 * Later phases may add true embedded webview if needed.
 */

import { useBrowserAgentStore, useUIStore } from '@/store';
import { browserReload, getBrowserUrl } from '@/utils/browserCommands';
import { BrowserSurfaceHost } from './BrowserSurfaceHost';

/**
 * BrowserWorkspacePane component
 */
export function BrowserWorkspacePane() {
  // Browser runtime state
  const {
    currentUrl,
    status,
    authState,
    inspectCurrentPage,
  } = useBrowserAgentStore();

  // UI dock state
  const {
    browserSplitFocus,
    focusChatPane,
    collapseBrowserToPanel,
    openBrowserExternal,
    closeBrowserDock,
  } = useUIStore();

  // Get status display text
  const getStatusText = () => {
    switch (status) {
      case 'idle':
        return 'Idle';
      case 'opening':
        return 'Opening...';
      case 'inspecting':
        return 'Inspecting...';
      case 'ready_for_agent':
        return 'Ready';
      case 'running':
        return 'Running task...';
      case 'completed':
        return 'Completed';
      case 'error':
        return 'Error';
      case 'needs_login':
        return 'Needs Login';
      case 'waiting_user_resume':
        return 'Waiting for you';
      case 'blocked_auth':
        return 'Blocked - Auth';
      case 'blocked_captcha':
        return 'Blocked - CAPTCHA';
      case 'blocked_manual_step':
        return 'Blocked - Manual step needed';
      default:
        return status || 'Unknown';
    }
  };

  // Get auth state display text
  const getAuthStateText = () => {
    switch (authState) {
      case 'authenticated':
        return 'Logged In';
      case 'unauthenticated':
        return 'Not Logged In';
      case 'unknown':
        return 'Unknown';
      default:
        return authState || 'Unknown';
    }
  };

  // Get status badge color
  const getStatusBadgeColor = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'error':
        return 'bg-red-100 text-red-700';
      case 'running':
      case 'opening':
      case 'inspecting':
        return 'bg-blue-100 text-blue-700';
      case 'needs_login':
      case 'waiting_user_resume':
      case 'blocked_auth':
      case 'blocked_captcha':
      case 'blocked_manual_step':
        return 'bg-yellow-100 text-yellow-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Get auth badge color
  const getAuthBadgeColor = () => {
    switch (authState) {
      case 'authenticated':
        return 'bg-green-100 text-green-700';
      case 'unauthenticated':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const handleReload = async () => {
    try {
      await browserReload();
      const url = await getBrowserUrl();
      useBrowserAgentStore.setState({ currentUrl: url });
      await inspectCurrentPage();
    } catch (error) {
      console.error('Failed to reload browser page:', error);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header Toolbar */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            Browser
          </h3>
          <div className="flex items-center gap-1">
            {/* Back to Chat Focus */}
            <button
              onClick={focusChatPane}
              className={`p-1.5 rounded hover:bg-gray-200 transition-colors ${
                browserSplitFocus === 'chat' ? 'bg-gray-200' : ''
              }`}
              title="Back to Chat Focus"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>

            {/* Collapse to Panel */}
            <button
              onClick={collapseBrowserToPanel}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors"
              title="Collapse to Panel"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>

            {/* Open in Window */}
            <button
              onClick={openBrowserExternal}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors"
              title="Open in Window"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>

            {/* Reload (placeholder for now) */}
            <button
              onClick={handleReload}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors"
              title="Reload"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* Close Browser */}
            <button
              onClick={closeBrowserDock}
              className="p-1.5 rounded hover:bg-red-100 text-red-600 transition-colors"
              title="Close Browser"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* URL Bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-600 truncate">
            {currentUrl || 'No URL'}
          </div>
        </div>

        {/* Status Badges */}
        <div className="flex items-center gap-2 mt-2">
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusBadgeColor()}`}>
            {getStatusText()}
          </span>
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getAuthBadgeColor()}`}>
            {getAuthStateText()}
          </span>
        </div>
      </div>

      {/* Preview Content Area - Use BrowserSurfaceHost for expanded view */}
      <div className="flex-1 overflow-hidden">
        <BrowserSurfaceHost onCollapse={() => {
          const { collapseBrowserToPanel } = useUIStore.getState();
          collapseBrowserToPanel();
        }} />
      </div>
    </div>
  );
}

export default BrowserWorkspacePane;
