/**
 * BrowserMiniPreview - Mini browser preview in right panel browser tab
 *
 * This component shows a compact browser preview inside the right panel browser tab.
 * It's not a full interaction surface - it's a live miniature viewport or placeholder card.
 * See browser-docked-layout-design.md for design details.
 *
 * V1: Shows status card + screenshot/preview placeholder
 */

import { useBrowserAgentStore, useUIStore } from '@/store';

/**
 * BrowserMiniPreview component
 */
export function BrowserMiniPreview() {
  // Browser runtime state
  const {
    currentUrl,
    status,
    authState,
    screenshots,
  } = useBrowserAgentStore();

  // UI dock state
  const {
    expandBrowserToSplit,
    openBrowserExternal,
    closeBrowserDock,
  } = useUIStore();

  // Get the latest screenshot
  const lastScreenshot = screenshots.length > 0 ? screenshots[screenshots.length - 1] : null;

  // Extract site name from URL
  const getSiteName = () => {
    if (!currentUrl) return 'No site';
    try {
      const url = new URL(currentUrl);
      return url.hostname.replace('www.', '');
    } catch {
      return 'Unknown';
    }
  };

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
        return 'Running...';
      case 'completed':
        return 'Completed';
      case 'error':
        return 'Error';
      case 'needs_login':
        return 'Needs Login';
      case 'waiting_user_resume':
        return 'Waiting';
      case 'blocked_auth':
        return 'Blocked';
      case 'blocked_captcha':
        return 'CAPTCHA';
      case 'blocked_manual_step':
        return 'Blocked';
      default:
        return status || 'Unknown';
    }
  };

  // Get status badge color
  const getStatusBadgeColor = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      case 'running':
      case 'opening':
      case 'inspecting':
        return 'bg-blue-500 animate-pulse';
      case 'needs_login':
      case 'waiting_user_resume':
      case 'blocked_auth':
      case 'blocked_captcha':
      case 'blocked_manual_step':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-400';
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
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="p-3 space-y-3">
      {/* Preview Card */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Screenshot/Preview Area */}
        <div className="aspect-video bg-gray-100 relative">
          {lastScreenshot ? (
            <img
              src={`data:image/png;base64,${lastScreenshot}`}
              alt="Browser preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg
                className="w-12 h-12 text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}

          {/* Status indicator overlay */}
          <div className="absolute top-2 right-2">
            <span className={`px-2 py-0.5 text-xs font-medium text-white rounded ${getStatusBadgeColor()}`}>
              {getStatusText()}
            </span>
          </div>
        </div>

        {/* URL/Site Info */}
        <div className="p-2 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {getSiteName()}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {currentUrl || 'No URL'}
              </p>
            </div>
            <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${getAuthBadgeColor()}`}>
              {authState === 'authenticated' ? 'Logged In' : authState === 'unauthenticated' ? 'Not Logged In' : 'Unknown'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {/* Expand */}
        <button
          onClick={expandBrowserToSplit}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          Expand
        </button>

        {/* Open Window */}
        <button
          onClick={openBrowserExternal}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Window
        </button>

        {/* Close */}
        <button
          onClick={closeBrowserDock}
          className="flex items-center justify-center px-3 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default BrowserMiniPreview;
