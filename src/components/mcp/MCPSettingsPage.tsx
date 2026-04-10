import { useState, useEffect } from 'react';
import { useMCPStore } from '@/store/mcpStore';
import { MCPServerCard } from './MCPServerCard';
import { MCPToolList } from './MCPToolList';
import { MCPAddDialog } from './MCPAddDialog';
import type { MCPServer } from '@/services/mcp/types';

interface MCPSettingsPageProps {
  onBack: () => void;
}

type View = 'list' | 'tools';

export function MCPSettingsPage({ onBack }: MCPSettingsPageProps) {
  const { servers, runtimes, loadServers, refreshRuntimes, connectServer, disconnectServer, removeServer } = useMCPStore();
  const [view, setView] = useState<View>('list');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editServer, setEditServer] = useState<MCPServer | undefined>();

  useEffect(() => {
    loadServers();
    refreshRuntimes();
  }, []);

  const handleViewTools = (serverId: string) => {
    setSelectedServerId(serverId);
    setView('tools');
  };

  const handleDelete = async (serverId: string) => {
    await removeServer(serverId);
  };

  const handleEdit = (server: MCPServer) => {
    setEditServer(server);
    setAddDialogOpen(true);
  };

  if (view === 'tools' && selectedServerId) {
    const server = servers.find(s => s.id === selectedServerId);
    return (
      <MCPToolList
        serverId={selectedServerId}
        serverName={server?.display_name || server?.name || selectedServerId}
        onBack={() => setView('list')}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <button
          className="text-gray-400 hover:text-white text-sm"
          onClick={onBack}
        >
          ← Back
        </button>
        <span className="text-sm font-medium text-gray-200">MCP Settings</span>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
          Configured Servers
        </div>

        {servers.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">
            No MCP servers configured. Add one below.
          </p>
        )}

        {servers.map(server => (
          <MCPServerCard
            key={server.id}
            server={server}
            runtime={runtimes.find(r => r.id === server.id)}
            onConnect={() => connectServer(server.id)}
            onDisconnect={() => disconnectServer(server.id)}
            onViewTools={() => handleViewTools(server.id)}
            onEdit={() => handleEdit(server)}
            onDelete={() => handleDelete(server.id)}
          />
        ))}
      </div>

      {/* Add buttons */}
      <div className="border-t border-gray-700 p-4 flex gap-2">
        <button
          className="flex-1 px-3 py-2 text-sm bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/30"
          onClick={() => {
            setEditServer(undefined);
            setAddDialogOpen(true);
          }}
        >
          + Add Server
        </button>
      </div>

      <MCPAddDialog
        open={addDialogOpen}
        onClose={() => {
          setAddDialogOpen(false);
          setEditServer(undefined);
        }}
        editServer={editServer}
      />
    </div>
  );
}
