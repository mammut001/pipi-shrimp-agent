/**
 * BrowserSurfaceHost - Expanded live browser surface
 *
 * This component hosts the same embedded browser surface used by the mini preview,
 * but sized into the main workspace area. The toolbar controls act on the same
 * session the user sees and interacts with.
 *
 * This is used in Phase 3 of the browser integration plan.
 */

import { useEffect, useRef, useState } from 'react';
import { useBrowserAgentStore, useUIStore } from '@/store';
import {
  showBrowserWindow,
  browserNavigate,
  browserReload,
  goBack,
} from '@/utils/browserCommands';
import { BrowserSurfaceViewport } from './BrowserSurfaceViewport';

interface BrowserSurfaceHostProps {
  /** Callback when user clicks collapse to return to mini mode */
  onCollapse?: () => void;
}

/**
 * BrowserSurfaceHost - Screenshot preview shell for expanded mode
 */
export function BrowserSurfaceHost({ onCollapse }: BrowserSurfaceHostProps) {
  const {
    currentUrl,
    status,
    logs,
    pendingTask,
  } = useBrowserAgentStore();

  const {
    openBrowserExternal,
    closeBrowserDock,
  } = useUIStore();

  const [urlInput, setUrlInput] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Sync URL input with current URL
  useEffect(() => {
    if (currentUrl) {
      setUrlInput(currentUrl);
    }
  }, [currentUrl]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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

  // Handle URL navigation from input
  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let targetUrl = urlInput.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }
    try {
      await browserNavigate(targetUrl);
    } catch (error) {
      console.error('Navigation failed:', error);
    }
  };

  // Handle refresh
  // NOTE: captureScreenshot() returns "Screenshot capture initiated" (acknowledgment string),
  // NOT the actual image data. Screenshot data ONLY arrives via screenshot_captured events.
  // We rely on the live preview mechanism (automatic periodic capture) for screenshot updates.
  const handleRefresh = async () => {
    try {
      await browserReload();
      // Screenshot will be updated automatically via live preview event listener
      // DO NOT use captureScreenshot() return value as image data - it's just an acknowledgment
    } catch (error) {
      console.error('Reload failed:', error);
    }
  };

  // Handle go back
  const handleGoBack = async () => {
    try {
      await goBack();
    } catch (error) {
      console.error('Go back failed:', error);
    }
  };

  // Handle pop-out to external window
  const handlePopOut = async () => {
    try {
      await showBrowserWindow();
      openBrowserExternal();
    } catch (error) {
      console.error('Pop-out failed:', error);
    }
  };

  // Handle collapse to mini mode
  const handleCollapse = () => {
    if (onCollapse) {
      onCollapse();
    } else {
      closeBrowserDock();
    }
  };

  // Get status color
  const getStatusColor = () => {
    switch (status) {
      case 'idle': return 'bg-gray-400';
      case 'opening':
      case 'inspecting': return 'bg-yellow-500';
      case 'ready_for_agent': return 'bg-green-500';
      case 'running': return 'bg-blue-500';
      case 'completed': return 'bg-green-600';
      case 'error': return 'bg-red-500';
      case 'needs_login': return 'bg-orange-500';
      default: return 'bg-gray-400';
    }
  };

  // Get status text
  const getStatusText = () => {
    switch (status) {
      case 'idle': return 'Idle';
      case 'opening': return 'Opening...';
      case 'inspecting': return 'Inspecting...';
      case 'ready_for_agent': return 'Ready';
      case 'running': return 'Running...';
      case 'completed': return 'Completed';
      case 'error': return 'Error';
      case 'needs_login': return 'Needs Login';
      default: return 'Unknown';
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Browser Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700">
        {/* Back button */}
        <button
          onClick={handleGoBack}
          className="p-1.5 rounded hover:bg-gray-700 text-gray-300"
          title="Go Back"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Forward button (placeholder) */}
        <button
          className="p-1.5 rounded hover:bg-gray-700 text-gray-500"
          title="Go Forward (disabled)"
          disabled
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          className="p-1.5 rounded hover:bg-gray-700 text-gray-300"
          title="Refresh"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL..."
            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
        </form>

        {/* Status indicator */}
        <div className="flex items-center gap-2 px-2">
          <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
          <span className="text-xs text-gray-400">{getStatusText()}</span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* Collapse button */}
          <button
            onClick={handleCollapse}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-300"
            title="Collapse to mini mode"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>

          {/* Pop-out button */}
          <button
            onClick={handlePopOut}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-300"
            title="Open in new window"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Browser Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Live browser surface area */}
        <div className="flex-1 relative bg-white">
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

        {/* Side Panel - Task & Logs */}
        <div className="w-72 bg-gray-800 border-l border-gray-700 flex flex-col">
          {/* Current Task */}
          <div className="p-3 border-b border-gray-700">
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Current Task</h3>
            {pendingTask?.executionPrompt ? (
              <div className="p-2 bg-gray-700 rounded text-sm text-white">
                {pendingTask.executionPrompt}
              </div>
            ) : (
              <div className="text-sm text-gray-500 italic">No active task</div>
            )}
          </div>

          {/* Action Logs */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-700">
              <h3 className="text-xs font-semibold text-gray-400 uppercase">Action Logs</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {logs.length === 0 ? (
                <div className="text-xs text-gray-500 italic p-2">No actions yet</div>
              ) : (
                logs.map((log, index) => (
                  <div
                    key={index}
                    className={`text-xs p-2 rounded ${
                      log.level === 'error'
                        ? 'bg-red-900/30 text-red-300'
                        : log.level === 'success'
                        ? 'bg-green-900/30 text-green-300'
                        : log.level === 'thinking'
                        ? 'bg-blue-900/30 text-blue-300'
                        : 'bg-gray-700/50 text-gray-300'
                    }`}
                  >
                    <span className="text-gray-500 mr-2">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    {log.message}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Site Info Footer */}
          <div className="p-3 border-t border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{getSiteName()}</span>
              <span className="text-xs text-gray-500">
                {currentUrl ? new URL(currentUrl).protocol.replace(':', '') : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BrowserSurfaceHost;
