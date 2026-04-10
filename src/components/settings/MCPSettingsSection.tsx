import { useEffect, useState } from 'react';
import { useMCPStore } from '@/store/mcpStore';
import { MCPStatusIndicator } from '@/components/mcp/MCPStatusIndicator';
import { MCPAddDialog } from '@/components/mcp/MCPAddDialog';
import type { ServerRuntime } from '@/services/mcp/types';

/**
 * Inline MCP settings section rendered inside the Settings page.
 * Displays configured servers with connect/disconnect controls and an "Add Server" button.
 */
export function MCPSettingsSection() {
  const {
    servers,
    runtimes,
    loading,
    loadServers,
    refreshRuntimes,
    connectServer,
    disconnectServer,
  } = useMCPStore();

  const [showAddDialog, setShowAddDialog] = useState(false);

  useEffect(() => {
    loadServers();
    refreshRuntimes();
  }, [loadServers, refreshRuntimes]);

  const getRuntimeForServer = (serverId: string): ServerRuntime | undefined =>
    runtimes.find(r => r.id === serverId);

  const connectedCount = runtimes.filter(r => r.status === 'connected').length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            MCP Servers
            {connectedCount > 0 && (
              <span className="ml-2 text-xs font-normal text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">
                {connectedCount} connected
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Model Context Protocol servers extend the agent with additional tools.
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          + Add Server
        </button>
      </div>

      {/* Server list */}
      {loading && (
        <p className="text-xs text-gray-400 text-center py-6">Loading…</p>
      )}

      {!loading && servers.length === 0 && (
        <div className="border border-dashed border-gray-200 rounded-lg py-6 text-center">
          <p className="text-xs text-gray-400">No MCP servers configured.</p>
          <button
            onClick={() => setShowAddDialog(true)}
            className="mt-2 text-xs text-blue-600 hover:underline"
          >
            Add your first server
          </button>
        </div>
      )}

      {!loading && servers.length > 0 && (
        <div className="space-y-2">
          {servers.map(server => {
            const runtime = getRuntimeForServer(server.id);
            const status = runtime?.status ?? 'disconnected';
            const isConnected = status === 'connected';

            return (
              <div
                key={server.id}
                className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MCPStatusIndicator status={status} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">
                      {server.display_name || server.name}
                    </p>
                    {server.description && (
                      <p className="text-xs text-gray-400 truncate">{server.description}</p>
                    )}
                    {runtime && (
                      <p className="text-xs text-gray-400">{runtime.tool_count} tools</p>
                    )}
                    {runtime?.error_message && (
                      <p className="text-xs text-red-500 mt-0.5">{runtime.error_message}</p>
                    )}
                  </div>
                </div>

                <button
                  onClick={() =>
                    isConnected ? disconnectServer(server.id) : connectServer(server.id)
                  }
                  disabled={status === 'connecting'}
                  className={`ml-4 shrink-0 text-xs px-2.5 py-1 rounded-md transition-colors disabled:opacity-50 ${
                    isConnected
                      ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                      : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                  }`}
                >
                  {status === 'connecting'
                    ? 'Connecting…'
                    : isConnected
                    ? 'Disconnect'
                    : 'Connect'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showAddDialog && (
        <MCPAddDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} />
      )}
    </div>
  );
}
