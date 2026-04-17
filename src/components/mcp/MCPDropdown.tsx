import { useMCPStore } from '@/store/mcpStore';
import { MCPStatusIndicator } from './MCPStatusIndicator';
import type { ServerRuntime } from '@/services/mcp/types';

interface MCPDropdownProps {
  onOpenSettings?: () => void;
}

/**
 * Dropdown panel showing MCP server status, triggered by MCPChatButton.
 */
export function MCPDropdown({ onOpenSettings }: MCPDropdownProps) {
  const { servers, runtimes, dropdownOpen, setDropdownOpen, connectServer, disconnectServer } = useMCPStore();

  if (!dropdownOpen) return null;

  const getRuntimeForServer = (serverId: string): ServerRuntime | undefined =>
    runtimes.find(r => r.id === serverId);

  return (
    <div className="absolute bottom-full mb-2 left-0 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-800">MCP Servers</span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            onClick={() => {
              setDropdownOpen(false);
              onOpenSettings?.();
            }}
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            onClick={() => setDropdownOpen(false)}
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Server list */}
      <div className="max-h-60 overflow-y-auto p-2 space-y-1">
        {servers.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-5">No servers configured</p>
        )}
        {servers.map(server => {
          const runtime = getRuntimeForServer(server.id);
          const status = runtime?.status ?? 'disconnected';
          const isConnected = status === 'connected';

          return (
            <div key={server.id} className="rounded-lg px-3 py-2.5 hover:bg-gray-50 transition-colors group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <MCPStatusIndicator status={status} />
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {server.display_name || server.name}
                  </span>
                </div>
                <button
                  className={`shrink-0 text-xs px-2 py-0.5 rounded-md font-medium transition-colors ${
                    isConnected
                      ? 'text-red-500 hover:bg-red-50'
                      : 'text-blue-600 hover:bg-blue-50'
                  }`}
                  onClick={() =>
                    isConnected ? disconnectServer(server.id) : connectServer(server.id)
                  }
                >
                  {isConnected ? 'Disconnect' : 'Connect'}
                </button>
              </div>
              {server.description && (
                <p className="text-xs text-gray-400 mt-0.5 pl-5 truncate">{server.description}</p>
              )}
              {runtime && runtime.tool_count > 0 && (
                <p className="text-xs text-gray-400 mt-0.5 pl-5">{runtime.tool_count} tools</p>
              )}
              {runtime?.error_message && (
                <p className="text-xs text-red-500 mt-0.5 pl-5">{runtime.error_message}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 p-2">
        <button
          className="w-full text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50 py-1.5 rounded-lg transition-colors"
          onClick={() => {
            setDropdownOpen(false);
            onOpenSettings?.();
          }}
        >
          + Add Server
        </button>
      </div>
    </div>
  );
}
