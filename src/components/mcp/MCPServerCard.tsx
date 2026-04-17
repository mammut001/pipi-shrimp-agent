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
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">
            {server.display_name || server.name}
          </span>
          <MCPStatusIndicator status={status} size="md" />
        </div>
      </div>

      {/* Details */}
      <div className="mt-2 space-y-0.5 text-xs text-gray-500">
        <div>Type: {transportLabel}</div>
        <div className="truncate" title={connectionInfo}>
          {server.config.transport === 'stdio' ? 'Command' : 'URL'}: {connectionInfo}
        </div>
        {runtime && (
          <div>Tools: {runtime.tool_count} · Resources: {runtime.resource_count}</div>
        )}
        {runtime?.error_message && (
          <div className="text-red-500">Error: {runtime.error_message}</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 mt-3">
        {isConnected ? (
          <>
            <button
              className="text-xs px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              onClick={onViewTools}
            >
              View Tools
            </button>
            <button
              className="text-xs px-2.5 py-1 rounded-md text-red-500 hover:bg-red-50 transition-colors"
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            className="text-xs px-2.5 py-1 rounded-md text-blue-600 hover:bg-blue-50 transition-colors"
            onClick={onConnect}
          >
            Connect
          </button>
        )}
        <button
          className="text-xs px-2.5 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          className="text-xs px-2.5 py-1 rounded-md text-red-400 hover:bg-red-50 transition-colors"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
