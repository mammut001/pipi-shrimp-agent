import type { ServerStatus } from '@/services/mcp/types';

interface MCPStatusIndicatorProps {
  status: ServerStatus;
  size?: 'sm' | 'md';
}

const statusColors: Record<ServerStatus, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-gray-400',
  error: 'bg-red-500',
};

const statusLabels: Record<ServerStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  disconnected: 'Disconnected',
  error: 'Error',
};

export function MCPStatusIndicator({ status, size = 'sm' }: MCPStatusIndicatorProps) {
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3';
  return (
    <span className="inline-flex items-center gap-1.5" title={statusLabels[status]}>
      <span className={`${sizeClass} rounded-full ${statusColors[status]}`} />
      {size === 'md' && (
        <span className="text-xs text-gray-500">{statusLabels[status]}</span>
      )}
    </span>
  );
}
