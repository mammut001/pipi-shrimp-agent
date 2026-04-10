import { useEffect, useCallback } from 'react';
import { useMCPStore } from '@/store/mcpStore';

/**
 * MCP button displayed next to the chat input.
 * Shows overall MCP connection status.
 */
export function MCPChatButton() {
  const { runtimes, dropdownOpen, setDropdownOpen, refreshRuntimes, loadServers } = useMCPStore();

  const init = useCallback(() => {
    loadServers();
    refreshRuntimes();
  }, [loadServers, refreshRuntimes]);

  useEffect(() => {
    init();
    // Refresh runtimes periodically to catch status changes
    const interval = setInterval(refreshRuntimes, 10_000);
    return () => clearInterval(interval);
  }, [init, refreshRuntimes]);

  const connectedCount = runtimes.filter(r => r.status === 'connected').length;
  const hasError = runtimes.some(r => r.status === 'error');
  const isConnecting = runtimes.some(r => r.status === 'connecting');

  let statusIcon = '🔗';
  let statusClass = 'text-gray-400 hover:text-gray-300';
  let suffix = '';

  if (connectedCount > 0) {
    statusClass = 'text-green-400 hover:text-green-300';
    suffix = ` ${connectedCount}`;
  }
  if (isConnecting) {
    statusClass = 'text-yellow-400 hover:text-yellow-300 animate-pulse';
    suffix = '...';
  }
  if (hasError) {
    statusIcon = '⚠';
    statusClass = 'text-red-400 hover:text-red-300';
  }

  return (
    <button
      className={`px-2 py-1 rounded text-sm transition-colors ${statusClass}`}
      onClick={() => setDropdownOpen(!dropdownOpen)}
      title="MCP Servers"
    >
      {statusIcon} MCP{suffix}
    </button>
  );
}
