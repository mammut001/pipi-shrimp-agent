/**
 * BrowserMiniPreview - Compact live browser surface in right panel browser tab
 *
 * This component hosts the same embedded browser surface used by the expanded view.
 * The actual webview is positioned by the backend into the preview viewport bounds,
 * so the user can interact with the real browser session directly in mini mode.
 *
 * It includes:
 * 1. Screenshot-based preview (NOT real webview)
 * 2. Natural Language Task Area - current task from chat
 * 3. Action Logs - timeline of browser actions
 *
 * See chat-driven-browser-ui-spec.md for design details.
 */

import { useEffect, useRef, useState } from 'react';
import { useBrowserAgentStore, useUIStore } from '@/store';
import { showBrowserWindow } from '@/utils/browserCommands';
import { BrowserSurfaceViewport } from './BrowserSurfaceViewport';

/**
 * BrowserMiniPreview component
 */
export function BrowserMiniPreview() {
  // Initialize event listeners for browser events (new UI path)
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        cleanup = await useBrowserAgentStore.getState().setupEventListeners();
      } catch {
        // ignore
      }
    })();
    return () => {
      cleanup?.();
    };
  }, []);
  // Browser runtime state
  const {
    currentUrl,
    status,
    authState,
    logs,
    pendingTask,
    isWindowOpen,
    presentationMode,
    executeTaskEnvelope,
    stopTask,
    clearLogs,
    addLog,
    inspectCurrentPage,
    confirmLoginAndResume,
    expandBrowser,
    collapseBrowser,
  } = useBrowserAgentStore();

  // UI dock state
  const {
    openBrowserExternal,
    closeBrowserDock,
  } = useUIStore();

  // Local state for task input (editable)
  const [taskInput, setTaskInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Sync task input with pending task
  useEffect(() => {
    if (pendingTask?.executionPrompt) {
      setTaskInput(pendingTask.executionPrompt);
    }
  }, [pendingTask?.executionPrompt]);

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

  // Get status display text
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
      case 'waiting_user_resume': return 'Waiting';
      case 'blocked_auth': return 'Blocked';
      case 'blocked_captcha': return 'CAPTCHA';
      case 'blocked_manual_step': return 'Blocked';
      default: return status || 'Unknown';
    }
  };

  // Get status badge color
  const getStatusBadgeColor = () => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'running':
      case 'opening':
      case 'inspecting': return 'bg-blue-500 animate-pulse';
      case 'needs_login':
      case 'waiting_user_resume':
      case 'blocked_auth':
      case 'blocked_captcha':
      case 'blocked_manual_step': return 'bg-yellow-500';
      default: return 'bg-gray-400';
    }
  };

  // Get auth badge color
  const getAuthBadgeColor = () => {
    switch (authState) {
      case 'authenticated': return 'bg-green-100 text-green-700';
      case 'unauthenticated': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  // Get log color
  const getLogColor = (level: string) => {
    switch (level) {
      case 'success': return 'text-green-400';
      case 'error': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      case 'thinking': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      default: return 'text-gray-300';
    }
  };

  // Format timestamp (timestamp is a string in format "HH:MM:SS" or ISO string)
  const formatTime = (timestamp: string) => {
    // If it's already in HH:MM:SS format, return as is
    if (timestamp.includes(':') && timestamp.length <= 8) {
      return timestamp;
    }
    // Otherwise parse as date
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  // Handle task execution
  // NOTE: Rerun must always preserve browser-task envelope semantics.
  // We do NOT allow raw executeTask() fallback - it bypasses the envelope contract
  // and loses critical context (targetUrl, siteProfileId, requiresLogin, authPolicy).
  // If no pendingTask exists, show an error to prevent silent context loss.
  const handleRunTask = async () => {
    if (!taskInput.trim() || isExecuting) return;
    setIsExecuting(true);
    try {
      if (pendingTask) {
        // Rerun with existing envelope - preserve all envelope context
        await executeTaskEnvelope({
          ...pendingTask,
          id: crypto.randomUUID(),
          userIntent: taskInput.trim(),
          executionPrompt: taskInput.trim(),
        });
      } else {
        // CRITICAL: No envelope context available - cannot run raw task
        // This would lose: targetUrl, siteProfileId, requiresLogin, authPolicy
        // The user must initiate from chat to create proper envelope context
        setIsExecuting(false);
        // Show inline error in logs instead of browser alert
        addLog?.('error', '无法运行：缺少任务上下文。请从聊天中发起任务以创建浏览器任务信封。');
        return;
      }
    } finally {
      setIsExecuting(false);
    }
  };

  // Handle stop task
  const handleStopTask = () => {
    stopTask();
    setIsExecuting(false);
  };

  // Handle key down in task input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRunTask();
    }
  };

  // Check if should show login prompt
  const showLoginPrompt = status === 'waiting_user_resume' || status === 'needs_login';
  const canExecute = status === 'ready_for_agent' && !showLoginPrompt;

  const handleOpenLiveWindow = async () => {
    try {
      await showBrowserWindow();
    } catch (error) {
      console.error('Failed to show browser window:', error);
    }
  };

  const handleRefreshCheck = async () => {
    await inspectCurrentPage();
  };

  const handleConfirmLogin = async () => {
    await confirmLoginAndResume();
  };
  const isExpanded = presentationMode === 'expanded';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 1. Live Browser Surface / Compact Header */}
      <div className="p-3 space-y-3 flex-shrink-0">
        {/* Preview Card - only show in mini mode (in expanded, browser is in center pane) */}
        {!isExpanded ? (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" style={{ position: 'relative' }}>
            <BrowserSurfaceViewport
              mode="mini"
              className="aspect-video bg-gray-100 relative"
              emptyState={
                <div className="flex items-center justify-center h-full text-gray-500">
                  <span>No browser surface yet</span>
                </div>
              }
            />

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
                <span className={`px-1.5 py-0.5 text-xs font-medium text-white rounded ${getStatusBadgeColor()}`}>
                  {getStatusText()}
                </span>
                <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${getAuthBadgeColor()}`}>
                  {authState === 'authenticated' ? 'Logged In' : authState === 'unauthenticated' ? 'Not Logged In' : 'Unknown'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* Compact header in expanded mode */
          <div className="bg-white rounded-lg border border-gray-200 p-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {getSiteName()}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {currentUrl || 'No URL'}
                </p>
              </div>
              <span className={`px-1.5 py-0.5 text-xs font-medium text-white rounded ${getStatusBadgeColor()}`}>
                {getStatusText()}
              </span>
              <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${getAuthBadgeColor()}`}>
                {authState === 'authenticated' ? 'Logged In' : authState === 'unauthenticated' ? 'Not Logged In' : 'Unknown'}
              </span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          {/* Expand / Collapse */}
          <button
            onClick={() => {
              if (presentationMode === 'expanded') {
                 collapseBrowser();
              } else {
                 expandBrowser();
              }
            }}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {presentationMode === 'expanded' ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 14h6v6m10-10h-6V4m0 6l7-7M10 14l-7 7" />
                </svg>
                Collapse
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                Expand
              </>
            )}
          </button>

          {/* Open Window */}
          <button
            onClick={async () => {
              openBrowserExternal();
              await handleOpenLiveWindow();
            }}
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

      {/* 2. Natural Language Task Area */}
      <div className="px-3 py-2 border-t border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Current Task</span>
          {showLoginPrompt && (
            <span className="text-[10px] text-yellow-600 font-medium">Login Required</span>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isWindowOpen ? "Enter task (e.g., click login)" : "Open browser first"}
            disabled={!isWindowOpen || showLoginPrompt}
            className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          {isExecuting ? (
            <button
              onClick={handleStopTask}
              className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleRunTask}
              disabled={!taskInput.trim() || !isWindowOpen || showLoginPrompt || !canExecute}
              className="px-3 py-2 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Run
            </button>
          )}
        </div>

        {showLoginPrompt && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={handleOpenLiveWindow}
              className="px-3 py-1.5 text-[11px] font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition-colors"
            >
              在窗口中登录
            </button>
            <button
              onClick={handleRefreshCheck}
              className="px-3 py-1.5 text-[11px] font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100 transition-colors"
            >
              刷新检查
            </button>
            <button
              onClick={handleConfirmLogin}
              className="px-3 py-1.5 text-[11px] font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              我已登录
            </button>
          </div>
        )}
      </div>

      {/* 3. Action Logs */}
      <div className="flex-1 flex flex-col min-h-0 border-t border-gray-200">
        <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Action Logs</span>
          <button onClick={clearLogs} className="text-[10px] text-gray-400 hover:text-gray-600">
            Clear
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 bg-gray-900">
          {logs.length === 0 ? (
            <p className="text-xs text-gray-600">Waiting for actions...</p>
          ) : (
            <div className="space-y-0.5">
              {logs.map((log, index) => (
                <p
                  key={index}
                  className={`text-[10px] font-mono leading-relaxed ${getLogColor(log.level)}`}
                >
                  [{formatTime(log.timestamp)}] {log.message}
                </p>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BrowserMiniPreview;
