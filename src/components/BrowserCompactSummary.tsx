/**
 * BrowserCompactSummary - Compact browser summary for expanded/split mode
 *
 * This component shows a compact view of browser state, current task,
 * and action logs when the browser is in expanded mode.
 *
 * This follows the architecture requirement:
 * "The right panel remains visible and continues to show:
 *  - compact browser summary
 *  - current task
 *  - logs"
 */

import { useEffect, useRef, useState } from 'react';
import { useBrowserAgentStore, useUIStore } from '@/store';

/**
 * BrowserCompactSummary component
 */
export function BrowserCompactSummary() {
  const {
    currentUrl,
    status,
    authState,
    logs,
    pendingTask,
    clearLogs,
    confirmLoginAndResume,
    forceResumeWithoutAuth,
    inspectCurrentPage,
    collapseBrowser,
  } = useBrowserAgentStore();

  const {
    focusChatPane,
  } = useUIStore();

  const [copiedLogs, setCopiedLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Copy all logs to clipboard
  const handleCopyLogs = async () => {
    if (logs.length === 0) return;
    const logText = logs
      .map(log => `[${formatTime(log.timestamp)}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');

    try {
      // Try modern clipboard API first
      await navigator.clipboard.writeText(logText);
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch (err) {
      // Fallback for older browsers or secure contexts
      try {
        const textarea = document.createElement('textarea');
        textarea.value = logText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopiedLogs(true);
        setTimeout(() => setCopiedLogs(false), 2000);
      } catch (fallbackErr) {
        console.error('Failed to copy logs:', fallbackErr);
        setCopiedLogs(false);
      }
    }
  };

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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

  // Format timestamp
  const formatTime = (timestamp: string) => {
    if (timestamp.includes(':') && timestamp.length <= 8) {
      return timestamp;
    }
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

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

  // Check if should show login prompt
  const showLoginPrompt = status === 'waiting_user_resume' || status === 'needs_login';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header with compact browser info */}
      <div className="p-3 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-700">Browser Console</h3>
          <div className="flex items-center gap-1">
            {/* Back to Chat */}
            <button
              onClick={focusChatPane}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              title="Back to Chat"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>

            {/* Collapse */}
            <button
              onClick={collapseBrowser}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              title="Collapse to mini"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>
          </div>
        </div>

        {/* Compact URL & Status */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-800 truncate">{getSiteName()}</p>
            <p className="text-gray-400 truncate">{currentUrl || 'No URL'}</p>
          </div>
          <span className={`px-2 py-0.5 text-[10px] font-medium text-white rounded ${getStatusBadgeColor()}`}>
            {getStatusText()}
          </span>
        </div>

        {/* Auth Status */}
        <div className="mt-2">
          <span className={`px-2 py-0.5 text-[10px] font-medium rounded ${getAuthBadgeColor()}`}>
            {authState === 'authenticated' ? 'Logged In' : authState === 'unauthenticated' ? 'Not Logged In' : 'Unknown'}
          </span>
        </div>
      </div>

      {/* Current Task */}
      <div className="px-3 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Current Task</span>
          {showLoginPrompt && (
            <span className="text-[10px] text-yellow-600 font-medium">Login Required</span>
          )}
        </div>

        {pendingTask?.executionPrompt ? (
          <div className="p-2 bg-gray-50 rounded text-xs text-gray-700">
            {pendingTask.executionPrompt}
          </div>
        ) : (
          <div className="text-xs text-gray-400 italic">No active task</div>
        )}

        {/* Login buttons */}
        {showLoginPrompt && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={inspectCurrentPage}
              className="px-3 py-1.5 text-[11px] font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100 transition-colors"
            >
              刷新检查
            </button>
            <button
              onClick={confirmLoginAndResume}
              className="px-3 py-1.5 text-[11px] font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              我已登录
            </button>
            <button
              onClick={forceResumeWithoutAuth}
              className="px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              title="跳过验证，直接继续执行"
            >
              强制继续
            </button>
          </div>
        )}
      </div>

      {/* Action Logs - fills remaining space */}
      <div className="flex-1 flex flex-col min-h-0 border-t border-gray-200">
        <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Action Logs</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLogs}
              disabled={logs.length === 0}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                copiedLogs
                  ? 'text-green-600 bg-green-50'
                  : logs.length === 0
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
              }`}
            >
              {copiedLogs ? '✓ Copied!' : 'Copy All'}
            </button>
            <button onClick={clearLogs} className="text-[10px] text-gray-400 hover:text-gray-600">
              Clear
            </button>
          </div>
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

export default BrowserCompactSummary;
