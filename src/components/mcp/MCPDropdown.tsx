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
    <div className="absolute bottom-full mb-2 left-0 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-200">MCP Servers</span>
        <button
          className="text-gray-400 hover:text-white text-sm"
          onClick={() => {
            setDropdownOpen(false);
            onOpenSettings?.();
          }}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Server list */}
      <div className="max-h-64 overflow-y-auto p-2 space-y-2">
        {servers.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">No servers configured</p>
        )}
        {servers.map(server => {
          const runtime = getRuntimeForServer(server.id);
          const status = runtime?.status ?? 'disconnected';
          const isConnected = status === 'connected';

          return (
            <div key={server.id} className="bg-gray-750 rounded-lg p-2.5 border border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{server.display_name || server.name}</span>
                  <MCPStatusIndicator status={status} />
                </div>
              </div>
              {server.description && (
                <p className="text-xs text-gray-500 mt-1">{server.description}</p>
              )}
              <div className="flex items-center justify-between mt-2">
                {runtime && (
                  <span className="text-xs text-gray-500">
                    Tools: {runtime.tool_count}
                  </span>
                )}
                <button
                  className={`text-xs px-2 py-0.5 rounded ${
                    isConnected
                      ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                      : 'bg-blue-900/30 text-blue-400 hover:bg-blue-900/50'
                  }`}
                  onClick={() =>
                    isConnected
                      ? disconnectServer(server.id)
                      : connectServer(server.id)
                  }
                >
                  {isConnected ? 'Disconnect' : 'Connect'}
                </button>
              </div>
              {runtime?.error_message && (
                <p className="text-xs text-red-400 mt-1">{runtime.error_message}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-700 p-2">
        <button
          className="w-full text-xs text-blue-400 hover:text-blue-300 py-1"
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
