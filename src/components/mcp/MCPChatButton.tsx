import { useEffect } from 'react';
import { useMCPStore } from '@/store/mcpStore';
import { usePolling } from '@/hooks/usePolling';

/**
 * MCP button displayed next to the chat input.
 * Shows overall MCP connection status.
 *
 * Visual: matches the ExecutionModeDropdown trigger (border + bg + small
 * text) so the action row reads as a single coherent control strip instead
 * of "bordered button + naked chip + naked icon" that fights the eye.
 */
export function MCPChatButton() {
  const { runtimes, dropdownOpen, setDropdownOpen, refreshRuntimes, loadServers } = useMCPStore();

  useEffect(() => {
    loadServers();
    refreshRuntimes();
  }, [loadServers, refreshRuntimes]);

  // Refresh runtimes periodically (pauses when tab is hidden)
  usePolling(refreshRuntimes, 10_000);

  const connectedCount = runtimes.filter(r => r.status === 'connected').length;
  const hasError = runtimes.some(r => r.status === 'error');
  const isConnecting = runtimes.some(r => r.status === 'connecting');

  let dotClass = 'bg-gray-300';
  let labelClass = 'text-gray-700 hover:bg-gray-50';

  if (connectedCount > 0) {
    dotClass = 'bg-green-500';
    labelClass = 'text-gray-700 hover:bg-gray-50';
  }
  if (isConnecting) {
    dotClass = 'bg-yellow-400 animate-pulse';
    labelClass = 'text-gray-600 hover:bg-gray-50';
  }
  if (hasError) {
    dotClass = 'bg-red-500';
    labelClass = 'text-red-600 hover:bg-red-50';
  }

  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={dropdownOpen}
      className={`inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium transition-colors ${labelClass}`}
      onClick={() => setDropdownOpen(!dropdownOpen)}
      title="MCP Servers"
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
      <span>MCP{connectedCount > 0 ? ` ${connectedCount}` : ''}</span>
      <svg
        className="h-3 w-3 opacity-60"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}
