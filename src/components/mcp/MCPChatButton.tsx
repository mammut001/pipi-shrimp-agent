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

  let dotClass = 'bg-gray-300';
  let labelClass = 'text-gray-500 hover:text-gray-700 hover:bg-gray-100';

  if (connectedCount > 0) {
    dotClass = 'bg-green-500';
    labelClass = 'text-gray-700 hover:text-gray-900 hover:bg-gray-100';
  }
  if (isConnecting) {
    dotClass = 'bg-yellow-400 animate-pulse';
    labelClass = 'text-gray-600 hover:bg-gray-100';
  }
  if (hasError) {
    dotClass = 'bg-red-500';
    labelClass = 'text-red-500 hover:bg-red-50';
  }

  return (
    <button
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${labelClass}`}
      onClick={() => setDropdownOpen(!dropdownOpen)}
      title="MCP Servers"
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
      <span>MCP{connectedCount > 0 ? ` ${connectedCount}` : ''}</span>
    </button>
  );
}
