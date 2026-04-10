import { MCPStatusIndicator } from './MCPStatusIndicator';
import type { MCPServer, ServerRuntime } from '@/services/mcp/types';

interface MCPServerCardProps {
  server: MCPServer;
  runtime?: ServerRuntime;
  onConnect: () => void;
  onDisconnect: () => void;
  onViewTools: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MCPServerCard({
  server,
  runtime,
  onConnect,
  onDisconnect,
  onViewTools,
  onEdit,
  onDelete,
}: MCPServerCardProps) {
  const status = runtime?.status ?? 'disconnected';
  const isConnected = status === 'connected';

  const transportLabel =
    server.config.transport === 'stdio'
      ? 'Stdio'
      : server.config.transport === 'http'
      ? 'HTTP'
      : 'SSE';

  const connectionInfo =
    server.config.transport === 'stdio'
      ? `${server.config.command} ${(server.config.args ?? []).join(' ')}`
      : server.config.url;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium text-gray-200">
            {server.display_name || server.name}
          </span>
          <MCPStatusIndicator status={status} size="md" />
        </div>
      </div>

      {/* Details */}
      <div className="mt-3 space-y-1 text-xs text-gray-400">
        <div>Type: {transportLabel}</div>
        <div className="truncate" title={connectionInfo}>
          {server.config.transport === 'stdio' ? 'Command' : 'URL'}: {connectionInfo}
        </div>
        {runtime && (
          <div>Tools: {runtime.tool_count} | Resources: {runtime.resource_count}</div>
        )}
        {runtime?.error_message && (
          <div className="text-red-400">Error: {runtime.error_message}</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3">
        {isConnected ? (
          <>
            <button
              className="text-xs px-2.5 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
              onClick={onViewTools}
            >
              View Tools
            </button>
            <button
              className="text-xs px-2.5 py-1 rounded bg-red-900/30 text-red-400 hover:bg-red-900/50"
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            className="text-xs px-2.5 py-1 rounded bg-blue-900/30 text-blue-400 hover:bg-blue-900/50"
            onClick={onConnect}
          >
            Connect
          </button>
        )}
        <button
          className="text-xs px-2.5 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          className="text-xs px-2.5 py-1 rounded bg-gray-700 text-red-400 hover:bg-red-900/30"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
